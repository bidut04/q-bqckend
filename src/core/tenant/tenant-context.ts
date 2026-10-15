export interface TenantContext {
  readonly userId: string;
  readonly tenantId: string;
  readonly roleIds: readonly string[];
  readonly permissions: readonly string[];
  readonly branchIds: readonly string[];
  readonly sessionId: string;
  readonly securityVersion: number;
  readonly isSupportSession?: boolean;
  readonly supportReason?: string;
  readonly shardId?: string;
}

export interface TenantResolutionRequest {
  readonly sessionToken?: string;
  readonly decodedJwt?: {
    readonly sub: string;
    readonly tenantId: string;
    readonly roles: readonly string[];
    readonly permissions: readonly string[];
    readonly branches: readonly string[];
    readonly sessionId: string;
    readonly securityVersion: number;
    readonly isSupportSession?: boolean;
    readonly supportReason?: string;
  };
}
