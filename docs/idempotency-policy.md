# QueueFlow Enterprise Idempotency Policy & Architecture Specification

## 1. Overview
In multi-tenant, sharded architectures, client retries caused by network drops, mobile app restarts, or user double-clicks must not result in duplicate state mutations (such as double bookings, double charges, duplicate token generation, or duplicate webhook executions).

QueueFlow guarantees **Strict Exactly-Once Mutation Semantics** using a multi-tiered distributed locking and persistence strategy.

---

## 2. Response Caching Policy Matrix

| HTTP Status Code Class | Caching Policy | TTL Duration | Rationale |
| :--- | :--- | :--- | :--- |
| **`2xx Success`** (200, 201, 204) | **Cached & Persisted** | **24 Hours (86,400s)** | State mutation was committed. Retries must replay the identical result with `X-Cache-Lookup: HIT-IDEMPOTENT`. |
| **`4xx Deterministic Client Errors`** (400, 422) | **Cached Short-Term** | **5 Minutes (300s)** | The input payload was invalid or unprocessable. Retries with the same invalid payload immediately receive the same error. |
| **`401 Unauthorized / 403 Forbidden`** | **NEVER Cached** | 0s (Immediate Lock Release) | Auth credentials or token permissions may be refreshed on subsequent calls. |
| **`429 Too Many Requests`** | **NEVER Cached** | 0s (Immediate Lock Release) | Rate limiting is temporal; client should be allowed to retry once rate limit resets. |
| **`5xx Server Errors`** (500, 502, 503, 504) | **NEVER CACHED** | **0s (Immediate Lock Release)** | **Transient infrastructure or connection failures must be retryable immediately.** Caching a 500 would lock the client out of completing their action. |
| **Unhandled Exception / Crash / Network Drop** | **NEVER CACHED** | **0s (Released or Expired)** | In-flight lock is released on error, connection close, or auto-expires after 30s lease. |

---

## 3. Core Architectural Guarantees

### 3.1 Lock Ownership Tokens & Request Deadline Alignment
- Every request that acquires an in-flight lock generates a cryptographic UUIDv4 `lockOwnerToken`.
- The lock is leased with a `lockTtlMs` of **30,000ms** (aligned with the 30-second gateway / Node HTTP request deadline).
- Lock release and completion updates verify ownership:
  $$\text{releaseIf}(\text{storedToken} == \text{currentRequestToken})$$
  This prevents a slow or timed-out request from releasing a newer lock acquired by a subsequent retry.

### 3.2 Canonical JSON Request Hashing
- Request payload verification is sensitive to key ordering in standard JSON serializers.
- QueueFlow uses **recursive key-sorted canonicalization**:
  ```json
  {"serviceId": "s1", "branchId": "b1"} ≡ {"branchId": "b1", "serviceId": "s1"}
  ```
  Both yield the identical SHA-256 hash. If a client attempts to reuse an idempotency key with a mutated payload, the server returns:
  `422 Unprocessable Entity` (`IDEMPOTENCY_PAYLOAD_MISMATCH`).

### 3.3 Compound Isolation (Tenant + Scope + Actor + Key)
Unique constraints are enforced at the database layer:
$$\text{Unique}(\text{tenantId}, \text{scope}, \text{actorId}, \text{key})$$
- **Tenant Isolation**: Keys in `tenant_a` never conflict with `tenant_b`.
- **Scope Isolation**: `BOOKING_CREATE` does not collide with `PAYMENT_CHARGE` or `WEBHOOK_INBOUND`.
- **Actor Isolation**: Two users within the same tenant using key `"123"` will not collide or hijack each other's sessions.
- **Key Length Limit**: Max 128 characters (RFC/Stripe standard). Keys $> 128$ characters are rejected with `400 Bad Request` (`IDEMPOTENCY_KEY_TOO_LONG`).

### 3.4 Multi-Instance DB-Backed Locking (Fail-Closed)
- Primary Lock Store: **Redis** (atomic `SET key token NX PX 30000`).
- Secondary Lock Store: **MySQL Catalog / Shard DB (`IdempotencyKey`)** with row-level locks and `lockedUntil` timestamp.
- **Zero Local Memory Fallback**: In-memory `Map` caching is dangerous in distributed or multi-container deployments. If both Redis and Database fail, the middleware **FAILS CLOSED** with `503 Service Unavailable` (`IDEMPOTENCY_STORE_UNAVAILABLE`), protecting against double execution.

### 3.5 Atomic Business & Idempotency Transactions
For critical operations like booking appointments:
$$\text{BEGIN TRANSACTION} \longrightarrow \text{INSERT Booking} \longrightarrow \text{INSERT IdempotencyRecord} \longrightarrow \text{COMMIT}$$
Both the domain entity and the idempotency response are persisted in the **same database transaction**. A crash mid-operation safely rolls back both without orphaned records.

