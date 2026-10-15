export type TenantStatus = "ACTIVE" | "INACTIVE" | "SUSPENDED" | "MIGRATING" | "READ_ONLY" | "DELETED";

export interface TenantMeta {
  readonly id: string;
  readonly name: string;
  readonly slug?: string | null;
  readonly shardId: string;
  readonly status: TenantStatus;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
