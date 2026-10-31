import { Router } from "express";
import { RoleController } from "./role.controller";

export const createRoleRouter = (controller: RoleController) => {
  const router = Router();

  router.get("/", controller.getRoles);
  router.post("/", controller.createRole);

  router.get("/permissions", controller.getAvailablePermissions);
  router.get("/effective-permissions", controller.getEffectivePermissions);

  // Permissions Matrix (Dynamic RBAC)
  router.get("/matrix", controller.getPermissionsMatrix);
  router.put("/matrix", controller.savePermissionsMatrix);

  // Scoped Role Assignments (Hybrid RBAC)
  router.get("/users/:userId/assignments", controller.getUserRoleAssignments);
  router.post("/assignments", controller.assignScopedRole);
  router.delete("/assignments/:assignmentId", controller.removeScopedRole);

  // Individual role routes
  router.get("/:id", controller.getRoleById);
  router.patch("/:id", controller.updateRole);
  router.delete("/:id", controller.deleteRole);

  // Role permissions
  router.post("/:id/permissions", controller.assignPermission);
  router.delete("/:id/permissions/:permissionKey", controller.removePermission);

  return router;
};
