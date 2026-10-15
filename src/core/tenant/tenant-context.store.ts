import { AsyncLocalStorage } from "node:async_hooks";
import { TenantContext } from "./tenant-context";
import { TenantContextMissingError } from "../errors/security.errors";

const tenantAsyncLocalStorage = new AsyncLocalStorage<TenantContext>();

export const runWithTenantContext = <R>(
  context: TenantContext,
  fn: () => Promise<R> | R
): Promise<R> | R => {
  return tenantAsyncLocalStorage.run(Object.freeze(context), fn);
};

export const getTenantContext = (): TenantContext | undefined => {
  return tenantAsyncLocalStorage.getStore();
};

export const requireTenantContext = (): TenantContext => {
  const context = getTenantContext();
  if (!context) {
    throw new TenantContextMissingError("Active TenantContext is required for this operation.");
  }
  return context;
};

export const TenantContextStore = {
  run: runWithTenantContext,
  getStore: getTenantContext,
  requireStore: requireTenantContext,
};
