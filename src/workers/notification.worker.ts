import { KafkaEventEnvelope } from "../lib/kafka/kafka.envelope";
import { TenantContext } from "../core/tenant/tenant-context";
import { runWithTenantContext } from "../core/tenant/tenant-context.store";
import { CustomerRepository } from "../repository/customer.repository";
import { Role } from "../core/authorization/roles";
import { Permission } from "../core/authorization/permissions";

export interface NotificationJobPayload {
  customerId: string;
  message: string;
}

const customerRepository = new CustomerRepository();

export const processNotificationEvent = async (
  envelope: KafkaEventEnvelope<NotificationJobPayload>
): Promise<void> => {
  const trustedTenantId = envelope.tenantId;

  const workerContext: TenantContext = Object.freeze({
    userId: `worker_notification_${envelope.eventId}`,
    tenantId: trustedTenantId,
    roleIds: Object.freeze([Role.PLATFORM_ADMIN]),
    permissions: Object.freeze([Permission.CUSTOMER_READ]),
    branchIds: Object.freeze([]),
    sessionId: `worker_sess_${envelope.correlationId}`,
    securityVersion: 0,
  });

  await runWithTenantContext(workerContext, async () => {
    const { customerId, message } = envelope.payload;

    // Safe lookup verifying customer belongs to tenant
    const customer = await customerRepository.findById(workerContext, customerId);

    console.log(`[NotificationWorker] Notification sent to customer ${customer.id} (${customer.phone || customer.email}) for tenant ${trustedTenantId}: "${message}"`);
  });
};

export const notificationWorker = {
  processEvent: processNotificationEvent,
};

export const NotificationWorker = function (this: unknown) {
  return notificationWorker;
} as unknown as {
  new (): typeof notificationWorker;
  processEvent: typeof processNotificationEvent;
};

