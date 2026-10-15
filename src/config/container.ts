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

// Services
import { createAuthService } from "../service/auth.service";
import { createBookingService } from "../modules/booking/booking.service";
import { QueueService } from "../modules/queue/queue.service";
import { createOrganizationService } from "../modules/organization/organization.service";
import { otpService } from "../service/otp.service";

// Controllers
import { createAuthController } from "../controllers/auth.controller";
import { otpController } from "../controllers/otp.controller";
import { createBookingController } from "../modules/booking/booking.controller";
import { createQueueController } from "../modules/queue/queue.controller";
import { createFormController } from "../modules/form/form.controller";
import { createOrganizationController } from "../modules/organization/organization.controller";

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

  // Controllers
  const authController = createAuthController(authService);
  const bookingController = createBookingController({ bookingService, bookingRepository });
  const queueController = createQueueController({ queueService, queueRepository });
  const formController = createFormController({ formRepository });
  const organizationController = createOrganizationController({
    organizationService,
    organizationRepository,
  });

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
    },
    services: {
      auth: authService,
      booking: bookingService,
      queue: queueService,
      organization: organizationService,
    },
    controllers: {
      auth: authController,
      otp: otpController,
      booking: bookingController,
      queue: queueController,
      form: formController,
      organization: organizationController,
    },
  };
};

export type Container = ReturnType<typeof createContainer>;
export const container = createContainer();
