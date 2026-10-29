import { redis as redisClient } from "../../redis/redis";

export interface CallingDisplayItem {
  queueEntryId: string;
  tokenNumber: number;
  tokenLabel: string;
  counterId: string;
  counterNumber?: string;
  serviceName?: string;
  calledAt: string;
}

// Resilient in-memory fallback store when Redis is offline or during testing
const memoryCache = new Map<string, { value: string; expiresAt: number }>();

const branchQueueKey = (tenantId: string, branchId: string): string =>
  `tenant:${tenantId}:branch:${branchId}:queue`;

const branchCallingKey = (tenantId: string, branchId: string): string =>
  `tenant:${tenantId}:branch:${branchId}:calling`;

const bookingKey = (tenantId: string, bookingId: string): string =>
  `tenant:${tenantId}:booking:${bookingId}`;

const branchEventsKey = (tenantId: string, branchId: string): string =>
  `tenant:${tenantId}:branch:${branchId}:events`;

const isRedisReady = (): boolean => redisClient.status === "ready";

// ============================================================================
// BRANCH ACTIVE QUEUE CACHE
// ============================================================================

export const cacheBranchQueue = async <T = unknown>(
  tenantId: string,
  branchId: string,
  entries: T[],
  ttlSeconds = 300
): Promise<void> => {
  const key = branchQueueKey(tenantId, branchId);
  const serialized = JSON.stringify(entries);

  if (isRedisReady()) {
    try {
      await redisClient.set(key, serialized, "EX", ttlSeconds);
      return;
    } catch (err) {
      console.warn(`[RealtimeCache] Redis set error for ${key}:`, (err as Error).message);
    }
  }

  memoryCache.set(key, {
    value: serialized,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
};

export const getCachedBranchQueue = async <T = unknown>(
  tenantId: string,
  branchId: string
): Promise<T[] | null> => {
  const key = branchQueueKey(tenantId, branchId);

  if (isRedisReady()) {
    try {
      const raw = await redisClient.get(key);
      if (raw) return JSON.parse(raw) as T[];
    } catch (err) {
      console.warn(`[RealtimeCache] Redis get error for ${key}:`, (err as Error).message);
    }
  }

  const item = memoryCache.get(key);
  if (item) {
    if (Date.now() > item.expiresAt) {
      memoryCache.delete(key);
      return null;
    }
    return JSON.parse(item.value) as T[];
  }

  return null;
};

export const invalidateBranchQueue = async (tenantId: string, branchId: string): Promise<void> => {
  const key = branchQueueKey(tenantId, branchId);

  if (isRedisReady()) {
    try {
      await redisClient.del(key);
    } catch (err) {
      console.warn(`[RealtimeCache] Redis del error for ${key}:`, (err as Error).message);
    }
  }

  memoryCache.delete(key);
};

// ============================================================================
// CALLING DISPLAY STATE CACHE
// ============================================================================

export const setCallingDisplay = async (
  tenantId: string,
  branchId: string,
  counterId: string,
  displayItem: CallingDisplayItem,
  ttlSeconds = 3600
): Promise<void> => {
  const key = branchCallingKey(tenantId, branchId);
  let currentMap: Record<string, CallingDisplayItem> = {};

  if (isRedisReady()) {
    try {
      const raw = await redisClient.get(key);
      if (raw) currentMap = JSON.parse(raw) as Record<string, CallingDisplayItem>;
      currentMap[counterId] = displayItem;
      await redisClient.set(key, JSON.stringify(currentMap), "EX", ttlSeconds);
      return;
    } catch (err) {
      console.warn(`[RealtimeCache] Redis calling state set error:`, (err as Error).message);
    }
  }

  const item = memoryCache.get(key);
  if (item && Date.now() <= item.expiresAt) {
    try {
      currentMap = JSON.parse(item.value) as Record<string, CallingDisplayItem>;
    } catch {}
  }
  currentMap[counterId] = displayItem;
  memoryCache.set(key, {
    value: JSON.stringify(currentMap),
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
};

export const getCallingDisplay = async (
  tenantId: string,
  branchId: string
): Promise<Record<string, CallingDisplayItem>> => {
  const key = branchCallingKey(tenantId, branchId);

  if (isRedisReady()) {
    try {
      const raw = await redisClient.get(key);
      if (raw) return JSON.parse(raw) as Record<string, CallingDisplayItem>;
    } catch (err) {
      console.warn(`[RealtimeCache] Redis calling state get error:`, (err as Error).message);
    }
  }

  const item = memoryCache.get(key);
  if (item && Date.now() <= item.expiresAt) {
    return JSON.parse(item.value) as Record<string, CallingDisplayItem>;
  }

  return {};
};

export const clearCallingDisplay = async (
  tenantId: string,
  branchId: string,
  counterId: string
): Promise<void> => {
  const key = branchCallingKey(tenantId, branchId);

  if (isRedisReady()) {
    try {
      const raw = await redisClient.get(key);
      if (raw) {
        const map = JSON.parse(raw) as Record<string, CallingDisplayItem>;
        delete map[counterId];
        await redisClient.set(key, JSON.stringify(map), "EX", 3600);
      }
      return;
    } catch (err) {
      console.warn(`[RealtimeCache] Redis clear calling display error:`, (err as Error).message);
    }
  }

  const item = memoryCache.get(key);
  if (item && Date.now() <= item.expiresAt) {
    const map = JSON.parse(item.value) as Record<string, CallingDisplayItem>;
    delete map[counterId];
    memoryCache.set(key, {
      value: JSON.stringify(map),
      expiresAt: item.expiresAt,
    });
  }
};

// ============================================================================
// BOOKING CACHE
// ============================================================================

export const cacheBooking = async <T = unknown>(
  tenantId: string,
  bookingId: string,
  bookingData: T,
  ttlSeconds = 600
): Promise<void> => {
  const key = bookingKey(tenantId, bookingId);
  const serialized = JSON.stringify(bookingData);

  if (isRedisReady()) {
    try {
      await redisClient.set(key, serialized, "EX", ttlSeconds);
      return;
    } catch (err) {
      console.warn(`[RealtimeCache] Redis booking set error:`, (err as Error).message);
    }
  }

  memoryCache.set(key, {
    value: serialized,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
};

export const getCachedBooking = async <T = unknown>(
  tenantId: string,
  bookingId: string
): Promise<T | null> => {
  const key = bookingKey(tenantId, bookingId);

  if (isRedisReady()) {
    try {
      const raw = await redisClient.get(key);
      if (raw) return JSON.parse(raw) as T;
    } catch (err) {
      console.warn(`[RealtimeCache] Redis booking get error:`, (err as Error).message);
    }
  }

  const item = memoryCache.get(key);
  if (item && Date.now() <= item.expiresAt) {
    return JSON.parse(item.value) as T;
  }

  return null;
};

export const invalidateBooking = async (tenantId: string, bookingId: string): Promise<void> => {
  const key = bookingKey(tenantId, bookingId);

  if (isRedisReady()) {
    try {
      await redisClient.del(key);
    } catch (err) {
      console.warn(`[RealtimeCache] Redis booking del error:`, (err as Error).message);
    }
  }

  memoryCache.delete(key);
};

// ============================================================================
// RECENT EVENTS RING BUFFER (HEARTBEAT GAP / RECONNECTION CATCH-UP)
// ============================================================================

export const recordRecentEvent = async (
  tenantId: string,
  branchId: string,
  envelope: Record<string, unknown>
): Promise<void> => {
  const key = branchEventsKey(tenantId, branchId);
  const serialized = JSON.stringify(envelope);

  if (isRedisReady()) {
    try {
      await redisClient.lpush(key, serialized);
      await redisClient.ltrim(key, 0, 49);
      await redisClient.expire(key, 3600);
      return;
    } catch (err) {
      console.warn(`[RealtimeCache] Redis event buffer error:`, (err as Error).message);
    }
  }

  // In-memory fallback ring buffer (last 50 items)
  let list: Array<Record<string, unknown>> = [];
  const item = memoryCache.get(key);
  if (item && Date.now() <= item.expiresAt) {
    try {
      list = JSON.parse(item.value) as Array<Record<string, unknown>>;
    } catch {}
  }
  list.unshift(envelope);
  if (list.length > 50) list = list.slice(0, 50);

  memoryCache.set(key, {
    value: JSON.stringify(list),
    expiresAt: Date.now() + 3600 * 1000,
  });
};

export const getMissedEvents = async (
  tenantId: string,
  branchId: string,
  sinceTimestamp: string
): Promise<Array<Record<string, unknown>>> => {
  const key = branchEventsKey(tenantId, branchId);
  const sinceMs = new Date(sinceTimestamp).getTime();
  let events: Array<Record<string, unknown>> = [];

  if (isRedisReady()) {
    try {
      const rawList = await redisClient.lrange(key, 0, 49);
      if (Array.isArray(rawList)) {
        events = rawList
          .map((item) => {
            try { return JSON.parse(item); } catch { return null; }
          })
          .filter(Boolean);
      }
    } catch (err) {
      console.warn(`[RealtimeCache] Redis get missed events error:`, (err as Error).message);
    }
  } else {
    const item = memoryCache.get(key);
    if (item && Date.now() <= item.expiresAt) {
      try {
        events = JSON.parse(item.value) as Array<Record<string, unknown>>;
      } catch {}
    }
  }

  // Filter events strictly occurring after sinceTimestamp, sort chronologically ascending
  return events
    .filter((ev) => {
      const occurredMs = new Date(String(ev.occurredAt || "")).getTime();
      return !isNaN(occurredMs) && occurredMs > sinceMs;
    })
    .sort((a, b) => new Date(String(a.occurredAt)).getTime() - new Date(String(b.occurredAt)).getTime());
};

export const realtimeCacheService = {
  cacheBranchQueue,
  getCachedBranchQueue,
  invalidateBranchQueue,
  setCallingDisplay,
  getCallingDisplay,
  clearCallingDisplay,
  cacheBooking,
  getCachedBooking,
  invalidateBooking,
  recordRecentEvent,
  getMissedEvents,
};

export const RealtimeCacheService = function (this: unknown) {
  return realtimeCacheService;
} as unknown as {
  new (): typeof realtimeCacheService;
};

export type RealtimeCacheService = typeof realtimeCacheService;


