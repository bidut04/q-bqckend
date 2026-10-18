import { prisma } from "./prisma";
import { redis } from "../redis/redis";
import { redisSecurityCache } from "../service/redis.service";

// Repositories
import { createUserRepository } from "../repository/user.repository";
import { createAuthRepository } from "../repository/auth.repository";
import { createOrganizationRepository } from "../repository/organization.repository";
import { createBookingRepository } from "../repository/booking.repository";
import { createQueueRepository } from "../repository/queue.repository";
import { createCustomerRepository } from "../repository/customer.repository";
import { createBranchRepository } from "../repository/branch.repository";
import { createFormRepository } from "../repository/form.repository";
import { createPlatformRepository } from "../repository/platform.repository";
import { createEmployeeRepository } from "../repository/employee.repository";
import { createRoleRepository } from "../repository/role.repository";

// Services
import { createAuthService } from "../service/auth.service";
import { createBookingService } from "../modules/booking/booking.service";
import { QueueService } from "../modules/queue/queue.service";
import { createOrganizationService } from "../modules/organization/organization.service";
import { createPlatformService } from "../modules/platform/platform.service";
import { EmployeeService } from "../modules/employee/employee.service";
import { RoleService } from "../modules/role/role.service";
import { otpService } from "../service/otp.service";
import { realtimeEmitter } from "../lib/socket/socket.emitter";
import { realtimeCacheService } from "../lib/redis/realtime-cache.service";

// Controllers
import { createAuthController } from "../controllers/auth.controller";
import { otpController } from "../controllers/otp.controller";
import { createBookingController } from "../modules/booking/booking.controller";
import { createQueueController } from "../modules/queue/queue.controller";
import { createFormController } from "../modules/form/form.controller";
import { createOrganizationController } from "../modules/organization/organization.controller";
import { createPlatformController } from "../modules/platform/platform.controller";
import { createEmployeeController } from "../modules/employee/employee.controller";
import { createRoleController } from "../modules/role/role.controller";

export const createContainer = () => {
  // Repositories
  const userRepository = createUserRepository(prisma);
  const authRepository = createAuthRepository(prisma);
  const organizationRepository = createOrganizationRepository(prisma);
  const bookingRepository = createBookingRepository();
  const queueRepository = createQueueRepository();
  const customerRepository = createCustomerRepository();
  const branchRepository = createBranchRepository();
  const formRepository = createFormRepository();
  const platformRepository = createPlatformRepository(prisma);
  const employeeRepository = createEmployeeRepository();
  const roleRepository = createRoleRepository();

  // Services
  const authService = createAuthService({
    userRepository,
    authRepository,
    redis,
    securityCache: redisSecurityCache,
  });
  const bookingService = createBookingService({
    bookingRepo: bookingRepository,
    branchRepo: branchRepository,
    formRepo: formRepository,
    customerRepo: customerRepository,
  });
  const queueService = new QueueService();
  const organizationService = createOrganizationService({
    organizationRepo: organizationRepository,
    otpService,
  });
  const platformService = createPlatformService({
    platformRepo: platformRepository,
  });
  const employeeService = new EmployeeService(employeeRepository);
  const roleService = new RoleService(roleRepository);

  // Controllers
  const authController = createAuthController(authService);
  const bookingController = createBookingController({ bookingService, bookingRepository });
  const queueController = createQueueController({ queueService, queueRepository });
  const formController = createFormController({ formRepository });
  const organizationController = createOrganizationController({
    organizationService,
    organizationRepository,
  });
  const platformController = createPlatformController({
    platformService,
  });
  const employeeController = createEmployeeController(employeeService);
  const roleController = createRoleController(roleService);

  return {
    prisma,
    redis,
    repositories: {
      user: userRepository,
      auth: authRepository,
      organization: organizationRepository,
      booking: bookingRepository,
      queue: queueRepository,
      customer: customerRepository,
      branch: branchRepository,
      form: formRepository,
      platform: platformRepository,
      employee: employeeRepository,
      role: roleRepository,
    },
    services: {
      auth: authService,
      booking: bookingService,
      queue: queueService,
      organization: organizationService,
      platform: platformService,
      employee: employeeService,
      role: roleService,
      realtimeEmitter,
      realtimeCache: realtimeCacheService,
    },
    controllers: {
      auth: authController,
      otp: otpController,
      booking: bookingController,
      queue: queueController,
      form: formController,
      organization: organizationController,
      platform: platformController,
      employee: employeeController,
      role: roleController,
    },
  };
};

export type Container = ReturnType<typeof createContainer>;
export const container = createContainer();

