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

export class RealtimeCacheService {
  // Resilient in-memory fallback store when Redis is offline or during testing
  private memoryCache = new Map<string, { value: string; expiresAt: number }>();

  private branchQueueKey(tenantId: string, branchId: string): string {
    return `tenant:${tenantId}:branch:${branchId}:queue`;
  }

  private branchCallingKey(tenantId: string, branchId: string): string {
    return `tenant:${tenantId}:branch:${branchId}:calling`;
  }

  private bookingKey(tenantId: string, bookingId: string): string {
    return `tenant:${tenantId}:booking:${bookingId}`;
  }

  private isRedisReady(): boolean {
    return redisClient.status === "ready";
  }

  // ============================================================================
  // BRANCH ACTIVE QUEUE CACHE
  // ============================================================================

  public async cacheBranchQueue<T = unknown>(
    tenantId: string,
    branchId: string,
    entries: T[],
    ttlSeconds = 300
  ): Promise<void> {
    const key = this.branchQueueKey(tenantId, branchId);
    const serialized = JSON.stringify(entries);

    if (this.isRedisReady()) {
      try {
        await redisClient.set(key, serialized, "EX", ttlSeconds);
        return;
      } catch (err) {
        console.warn(`[RealtimeCache] Redis set error for ${key}:`, (err as Error).message);
      }
    }

    this.memoryCache.set(key, {
      value: serialized,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  public async getCachedBranchQueue<T = unknown>(
    tenantId: string,
    branchId: string
  ): Promise<T[] | null> {
    const key = this.branchQueueKey(tenantId, branchId);

    if (this.isRedisReady()) {
      try {
        const raw = await redisClient.get(key);
        if (raw) return JSON.parse(raw) as T[];
      } catch (err) {
        console.warn(`[RealtimeCache] Redis get error for ${key}:`, (err as Error).message);
      }
    }

    const item = this.memoryCache.get(key);
    if (item) {
      if (Date.now() > item.expiresAt) {
        this.memoryCache.delete(key);
        return null;
      }
      return JSON.parse(item.value) as T[];
    }

    return null;
  }

  public async invalidateBranchQueue(tenantId: string, branchId: string): Promise<void> {
    const key = this.branchQueueKey(tenantId, branchId);

    if (this.isRedisReady()) {
      try {
        await redisClient.del(key);
      } catch (err) {
        console.warn(`[RealtimeCache] Redis del error for ${key}:`, (err as Error).message);
      }
    }

    this.memoryCache.delete(key);
  }

  // ============================================================================
  // CALLING DISPLAY STATE CACHE
  // ============================================================================

  public async setCallingDisplay(
    tenantId: string,
    branchId: string,
    counterId: string,
    displayItem: CallingDisplayItem,
    ttlSeconds = 3600
  ): Promise<void> {
    const key = this.branchCallingKey(tenantId, branchId);
    let currentMap: Record<string, CallingDisplayItem> = {};

    if (this.isRedisReady()) {
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

    const item = this.memoryCache.get(key);
    if (item && Date.now() <= item.expiresAt) {
      try {
        currentMap = JSON.parse(item.value) as Record<string, CallingDisplayItem>;
      } catch {}
    }
    currentMap[counterId] = displayItem;
    this.memoryCache.set(key, {
      value: JSON.stringify(currentMap),
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  public async getCallingDisplay(
    tenantId: string,
    branchId: string
  ): Promise<Record<string, CallingDisplayItem>> {
    const key = this.branchCallingKey(tenantId, branchId);

    if (this.isRedisReady()) {
      try {
        const raw = await redisClient.get(key);
        if (raw) return JSON.parse(raw) as Record<string, CallingDisplayItem>;
      } catch (err) {
        console.warn(`[RealtimeCache] Redis calling state get error:`, (err as Error).message);
      }
    }

    const item = this.memoryCache.get(key);
    if (item && Date.now() <= item.expiresAt) {
      return JSON.parse(item.value) as Record<string, CallingDisplayItem>;
    }

    return {};
  }

  public async clearCallingDisplay(
    tenantId: string,
    branchId: string,
    counterId: string
  ): Promise<void> {
    const key = this.branchCallingKey(tenantId, branchId);

    if (this.isRedisReady()) {
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

    const item = this.memoryCache.get(key);
    if (item && Date.now() <= item.expiresAt) {
      const map = JSON.parse(item.value) as Record<string, CallingDisplayItem>;
      delete map[counterId];
      this.memoryCache.set(key, {
        value: JSON.stringify(map),
        expiresAt: item.expiresAt,
      });
    }
  }

  // ============================================================================
  // BOOKING CACHE
  // ============================================================================

  public async cacheBooking<T = unknown>(
    tenantId: string,
    bookingId: string,
    bookingData: T,
    ttlSeconds = 600
  ): Promise<void> {
    const key = this.bookingKey(tenantId, bookingId);
    const serialized = JSON.stringify(bookingData);

    if (this.isRedisReady()) {
      try {
        await redisClient.set(key, serialized, "EX", ttlSeconds);
        return;
      } catch (err) {
        console.warn(`[RealtimeCache] Redis booking set error:`, (err as Error).message);
      }
    }

    this.memoryCache.set(key, {
      value: serialized,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  public async getCachedBooking<T = unknown>(
    tenantId: string,
    bookingId: string
  ): Promise<T | null> {
    const key = this.bookingKey(tenantId, bookingId);

    if (this.isRedisReady()) {
      try {
        const raw = await redisClient.get(key);
        if (raw) return JSON.parse(raw) as T;
      } catch (err) {
        console.warn(`[RealtimeCache] Redis booking get error:`, (err as Error).message);
      }
    }

    const item = this.memoryCache.get(key);
    if (item && Date.now() <= item.expiresAt) {
      return JSON.parse(item.value) as T;
    }

    return null;
  }

  public async invalidateBooking(tenantId: string, bookingId: string): Promise<void> {
    const key = this.bookingKey(tenantId, bookingId);

    if (this.isRedisReady()) {
      try {
        await redisClient.del(key);
      } catch (err) {
        console.warn(`[RealtimeCache] Redis booking del error:`, (err as Error).message);
      }
    }

    this.memoryCache.delete(key);
  }
}

export const realtimeCacheService = new RealtimeCacheService();
