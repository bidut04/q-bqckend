export enum Permission {
  TENANT_READ = "tenant:read",
  TENANT_UPDATE = "tenant:update",

  BRANCH_READ = "branch:read",
  BRANCH_CREATE = "branch:create",
  BRANCH_UPDATE = "branch:update",
  BRANCH_DELETE = "branch:delete",

  EMPLOYEE_READ = "employee:read",
  EMPLOYEE_CREATE = "employee:create",
  EMPLOYEE_UPDATE = "employee:update",

  CUSTOMER_READ = "customer:read",
  CUSTOMER_UPDATE = "customer:update",

  BOOKING_READ = "booking:read",
  BOOKING_CREATE = "booking:create",
  BOOKING_UPDATE = "booking:update",

  QUEUE_READ = "queue:read",
  QUEUE_CREATE = "queue:create",
  QUEUE_UPDATE = "queue:update",
  QUEUE_TRANSFER = "queue:transfer",

  FORM_READ = "form:read",
  FORM_CREATE = "form:create",
  FORM_UPDATE = "form:update",
  FORM_PUBLISH = "form:publish",

  COUNTER_READ = "counter:read",
  COUNTER_UPDATE = "counter:update",

  AUDIT_READ = "audit:read",

  // Platform Control Plane Permissions
  PLATFORM_TENANT_READ = "platform:tenant:read",
  PLATFORM_TENANT_UPDATE = "platform:tenant:update",
  PLATFORM_SHARD_READ = "platform:shard:read",
  PLATFORM_MIGRATION_EXECUTE = "platform:migration:execute",
}
