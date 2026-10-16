import { TenantType, TenantStatus, Role, ReviewAction } from "@prisma/client";
import { OrganizationRepository, CreateOrganizationInput, OrganizationView } from "../../repository/organization.repository";
import { BrevoEmailService, emailService as defaultEmailService } from "../../service/email.service";
import { OtpService } from "../../service/otp.service";
import { AuthUser } from "../../common/types";
import { AppError } from "../../../utils/app-error";

export interface RegisterOrganizationInput extends Omit<CreateOrganizationInput, "status" | "statusReason"> {
  name: string;
  type: TenantType;
  Administrator: string;
  Assigned_TenantRole: Role;
  email: string;
  AdministratorEmail?: string | null;
  sendOtp?: boolean;
}

export interface OrganizationServiceDeps {
  organizationRepo: OrganizationRepository;
  emailService?: BrevoEmailService;
  otpService?: OtpService;
}

export const createOrganizationService = (deps: OrganizationServiceDeps) => {
  const emailService = deps.emailService ?? defaultEmailService;

  /**
   * Registers a new organization submitted by an organization admin/creator.
   * - Automatically marks status as PROVISIONING (Pending Approval).
   * - Immediately sends confirmation email to the Admin Email.
   */
  const registerOrganization = async (
    input: RegisterOrganizationInput,
    actor?: AuthUser
  ): Promise<{
    organization: OrganizationView;
    mailSent: boolean;
    adminEmail: string;
    message: string;
    otpSent?: boolean;
    previewOtp?: string;
  }> => {
    const orgEmail = (input.email || "").trim().toLowerCase();
    const adminEmail = (input.AdministratorEmail || actor?.email || orgEmail).trim().toLowerCase();

    if (!adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
      throw new AppError("Valid administrator email is required for registration", 400, "INVALID_ADMIN_EMAIL");
    }

    // 1. Create Organization in Database via Repository (forces PROVISIONING if actor is not super-admin)
    const organization = await deps.organizationRepo.create(
      {
        ...input,
        email: orgEmail || adminEmail,
        AdministratorEmail: adminEmail,
      },
      actor
    );

    // 2. Dispatch Confirmation Email to Admin Email
    const messageHtml = `
      <p style="font-size: 15px; color: #334155;">Dear <strong>${input.Administrator || "Admin"}</strong>,</p>
      <p style="font-size: 15px; color: #334155;">Your organization <strong>${input.name}</strong> has been successfully registered and submitted for platform review.</p>
      
      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <p style="margin: 6px 0; color: #475569;"><strong>Organization ID:</strong> <code style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px;">${organization.id}</code></p>
        <p style="margin: 6px 0; color: #475569;"><strong>Organization Name:</strong> ${input.name}</p>
        <p style="margin: 6px 0; color: #475569;"><strong>Type:</strong> ${input.type}</p>
        <p style="margin: 6px 0; color: #475569;"><strong>Status:</strong> <span style="background-color: #fef3c7; color: #92400e; padding: 3px 8px; border-radius: 6px; font-weight: 600; font-size: 13px;">Pending Approval (PROVISIONING)</span></p>
        <p style="margin: 6px 0; color: #475569;"><strong>Admin Email:</strong> ${adminEmail}</p>
      </div>

      <p style="font-size: 14px; color: #64748b; line-height: 1.6;">Our platform administrators will review your organization details. Once verified and approved, you will receive an activation email with your dashboard access.</p>
    `.trim();

    const emailResult = await emailService.sendNotificationEmail({
      toEmail: adminEmail,
      recipientName: input.Administrator || input.name,
      subject: `Organization Registration Received: ${input.name}`,
      title: "Organization Registration Submitted",
      messageHtml,
    });

    let otpSent = false;
    let previewOtp: string | undefined;

    if (input.sendOtp && deps.otpService) {
      const otpRes = await deps.otpService.sendOtp({
        email: adminEmail,
        purpose: "Organization Verification",
        recipientName: input.name,
      });
      otpSent = otpRes.success;
      previewOtp = (otpRes as any).previewOtp;
    }

    return {
      organization,
      mailSent: emailResult.success,
      adminEmail,
      message: `Organization created. Confirmation email sent to admin at ${adminEmail}.`,
      ...(otpSent ? { otpSent, previewOtp } : {}),
    };
  };

  /**
   * Approves a pending organization registration.
   * Exclusively accessible by Platform / Super Administrators.
   * Atomically transitions status: PROVISIONING -> ACTIVE.
   * Dispatches branded approval confirmation email to the administrator.
   */
  const approveOrganization = async (
    organizationId: string,
    actor: AuthUser,
    notes?: string
  ): Promise<{
    organization: OrganizationView;
    status: TenantStatus;
    mailSent: boolean;
    adminEmail: string;
    message: string;
  }> => {
    if (!deps.organizationRepo.isSuperAdmin(actor)) {
      throw new AppError("Only platform administrators can approve organizations", 403, "FORBIDDEN");
    }

    const org = await deps.organizationRepo.findById(organizationId);
    if (!org) {
      throw new AppError("Organization not found", 404, "ORGANIZATION_NOT_FOUND");
    }

    if (org.status === TenantStatus.ACTIVE) {
      throw new AppError("Organization is already approved and active", 400, "ORGANIZATION_ALREADY_ACTIVE");
    }

    if (org.status !== TenantStatus.PROVISIONING) {
      throw new AppError(`Cannot approve organization in ${org.status} status`, 400, "INVALID_STATE_TRANSITION");
    }

    const approvalReason = notes ? `Approved by Platform Admin: ${notes}` : "Approved by Platform Administrator";

    const transitioned = await deps.organizationRepo.transition(
      organizationId,
      TenantStatus.PROVISIONING,
      {
        status: TenantStatus.ACTIVE,
        statusReason: approvalReason,
      }
    );

    if (!transitioned) {
      throw new AppError("Failed to approve organization (possible concurrent modification)", 409, "CONCURRENT_UPDATE");
    }

    // Append to immutable audit ledger (Pattern 3: Compliance & Legal Traceability)
    if (deps.organizationRepo.recordReviewLog) {
      await deps.organizationRepo.recordReviewLog({
        tenantId: organizationId,
        reviewerId: actor.id,
        action: ReviewAction.APPROVED,
        fromStatus: TenantStatus.PROVISIONING,
        toStatus: TenantStatus.ACTIVE,
        reason: approvalReason,
      });
    }

    const updatedOrg = await deps.organizationRepo.findById(organizationId);
    if (!updatedOrg) {
      throw new AppError("Organization could not be loaded after approval", 500, "ORGANIZATION_LOAD_FAILED");
    }

    const adminEmail = (updatedOrg.AdministratorEmail || updatedOrg.email || "").trim().toLowerCase();
    const adminName = updatedOrg.Administrator || updatedOrg.name;

    const messageHtml = `
      <p style="font-size: 16px; color: #1e293b;">Dear <strong>${adminName}</strong>,</p>
      <p style="font-size: 15px; color: #334155; line-height: 1.6;">
        Great news! Your organization <strong>${updatedOrg.name}</strong> has been <strong>approved</strong> by the platform administrator.
      </p>
      
      <div style="background-color: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 18px; margin: 20px 0;">
        <p style="margin: 6px 0; color: #065f46;"><strong>Status:</strong> <span style="background-color: #10b981; color: #ffffff; padding: 3px 8px; border-radius: 6px; font-weight: 600; font-size: 13px;">ACTIVE / APPROVED</span></p>
        <p style="margin: 6px 0; color: #065f46;"><strong>Organization ID:</strong> <code style="background: #d1fae5; padding: 2px 6px; border-radius: 4px;">${updatedOrg.id}</code></p>
        <p style="margin: 6px 0; color: #065f46;"><strong>Organization Name:</strong> ${updatedOrg.name}</p>
        <p style="margin: 6px 0; color: #065f46;"><strong>Type:</strong> ${updatedOrg.type}</p>
        <p style="margin: 6px 0; color: #065f46;"><strong>Admin Email:</strong> ${adminEmail}</p>
        ${notes ? `<p style="margin: 6px 0; color: #065f46;"><strong>Reviewer Notes:</strong> ${notes}</p>` : ""}
      </div>

      <p style="font-size: 14px; color: #475569; line-height: 1.6;">
        Your organization is now live and operational on our platform. You can now access your administrative dashboard to configure branches, services, counters, and digital queues.
      </p>
    `.trim();

    const emailResult = await emailService.sendNotificationEmail({
      toEmail: adminEmail,
      recipientName: adminName,
      subject: `Organization Approved: ${updatedOrg.name}`,
      title: "Organization Registration Approved",
      messageHtml,
    });

    return {
      organization: updatedOrg,
      status: TenantStatus.ACTIVE,
      mailSent: emailResult.success,
      adminEmail,
      message: `Organization ${updatedOrg.name} has been approved. Confirmation email sent to ${adminEmail}.`,
    };
  };

  /**
   * Rejects a pending organization registration with a specified reason.
   * Exclusively accessible by Platform / Super Administrators.
   * Atomically transitions status: PROVISIONING -> SUSPENDED.
   * Dispatches branded rejection notification email to the administrator.
   */
  const rejectOrganization = async (
    organizationId: string,
    actor: AuthUser,
    reason: string
  ): Promise<{
    organization: OrganizationView;
    status: TenantStatus;
    mailSent: boolean;
    adminEmail: string;
    reason: string;
    message: string;
  }> => {
    if (!deps.organizationRepo.isSuperAdmin(actor)) {
      throw new AppError("Only platform administrators can reject organizations", 403, "FORBIDDEN");
    }

    if (!reason || !reason.trim()) {
      throw new AppError("Rejection reason is required", 400, "REJECTION_REASON_REQUIRED");
    }

    const org = await deps.organizationRepo.findById(organizationId);
    if (!org) {
      throw new AppError("Organization not found", 404, "ORGANIZATION_NOT_FOUND");
    }

    if (org.status !== TenantStatus.PROVISIONING) {
      throw new AppError(`Cannot reject organization in ${org.status} status`, 400, "INVALID_STATE_TRANSITION");
    }

    const rejectionReason = reason.trim();

    const transitioned = await deps.organizationRepo.transition(
      organizationId,
      TenantStatus.PROVISIONING,
      {
        status: TenantStatus.SUSPENDED,
        statusReason: rejectionReason,
      }
    );

    if (!transitioned) {
      throw new AppError("Failed to reject organization (possible concurrent modification)", 409, "CONCURRENT_UPDATE");
    }

    // Append to immutable audit ledger (Pattern 3: Compliance & Legal Traceability)
    if (deps.organizationRepo.recordReviewLog) {
      await deps.organizationRepo.recordReviewLog({
        tenantId: organizationId,
        reviewerId: actor.id,
        action: ReviewAction.REJECTED,
        fromStatus: TenantStatus.PROVISIONING,
        toStatus: TenantStatus.SUSPENDED,
        reason: rejectionReason,
      });
    }

    const updatedOrg = await deps.organizationRepo.findById(organizationId);
    if (!updatedOrg) {
      throw new AppError("Organization could not be loaded after rejection", 500, "ORGANIZATION_LOAD_FAILED");
    }

    const adminEmail = (updatedOrg.AdministratorEmail || updatedOrg.email || "").trim().toLowerCase();
    const adminName = updatedOrg.Administrator || updatedOrg.name;

    const messageHtml = `
      <p style="font-size: 16px; color: #1e293b;">Dear <strong>${adminName}</strong>,</p>
      <p style="font-size: 15px; color: #334155; line-height: 1.6;">
        Thank you for your interest in registering <strong>${updatedOrg.name}</strong> on our platform. After careful review by our platform administration team, your registration request has <strong>not been approved</strong> at this time.
      </p>
      
      <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 18px; margin: 20px 0;">
        <p style="margin: 6px 0; color: #991b1b;"><strong>Status:</strong> <span style="background-color: #ef4444; color: #ffffff; padding: 3px 8px; border-radius: 6px; font-weight: 600; font-size: 13px;">NOT APPROVED / SUSPENDED</span></p>
        <p style="margin: 6px 0; color: #991b1b;"><strong>Organization ID:</strong> <code style="background: #fee2e2; padding: 2px 6px; border-radius: 4px;">${updatedOrg.id}</code></p>
        <p style="margin: 6px 0; color: #991b1b;"><strong>Organization Name:</strong> ${updatedOrg.name}</p>
        <p style="margin: 6px 0; color: #991b1b;"><strong>Rejection Reason:</strong> ${rejectionReason}</p>
      </div>

      <p style="font-size: 14px; color: #475569; line-height: 1.6;">
        If you have questions or would like to submit rectified documentation, please contact our support team or submit a new registration with the necessary corrections.
      </p>
    `.trim();

    const emailResult = await emailService.sendNotificationEmail({
      toEmail: adminEmail,
      recipientName: adminName,
      subject: `Organization Registration Not Approved: ${updatedOrg.name}`,
      title: "Organization Registration Not Approved",
      messageHtml,
    });

    return {
      organization: updatedOrg,
      status: TenantStatus.SUSPENDED,
      mailSent: emailResult.success,
      adminEmail,
      reason: rejectionReason,
      message: `Organization ${updatedOrg.name} registration was rejected. Notification email sent to ${adminEmail}.`,
    };
  };

  /**
   * Lists organizations currently in PROVISIONING status awaiting approval.
   * Exclusively accessible by Platform / Super Administrators.
   */
  const listPendingOrganizations = async (
    actor: AuthUser,
    params?: { limit?: number; cursor?: string }
  ) => {
    if (!deps.organizationRepo.isSuperAdmin(actor)) {
      throw new AppError("Only platform administrators can review pending organizations", 403, "FORBIDDEN");
    }

    const page = await deps.organizationRepo.list({
      actor,
      status: TenantStatus.PROVISIONING,
      limit: params?.limit || 20,
      cursor: params?.cursor,
    });

    return page;
  };

  /**
   * Verifies the OTP sent to the organization email address.
   */
  const verifyOrganizationEmail = async (input: {
    organizationId: string;
    email: string;
    otp: string;
  }): Promise<{ success: boolean; message: string; organizationId: string }> => {
    const email = input.email.trim().toLowerCase();
    
    // Verify OTP code
    if (!deps.otpService) {
      throw new AppError("OTP service is not enabled", 501, "OTP_SERVICE_UNAVAILABLE");
    }

    await deps.otpService.verifyOtp({
      email,
      otp: input.otp,
    });

    return {
      success: true,
      message: `Organization email ${email} verified successfully.`,
      organizationId: input.organizationId,
    };
  };

  const getOrganizationById = async (id: string, actor: AuthUser) => {
    const org = await deps.organizationRepo.findVisible(id, actor);
    if (!org) {
      throw new AppError("Organization not found or access denied", 404, "ORGANIZATION_NOT_FOUND");
    }
    return org;
  };

  /**
   * Retrieves the immutable audit log history for an organization.
   * Exclusively accessible by Super Administrators and the verified organization creator.
   */
  const getOrganizationReviewLogs = async (organizationId: string, actor: AuthUser) => {
    const isSuper = deps.organizationRepo.isSuperAdmin(actor);
    if (!isSuper) {
      const org = await deps.organizationRepo.findVisible(organizationId, actor);
      if (!org) {
        throw new AppError("Access denied to organization review history", 403, "FORBIDDEN");
      }
    }

    return deps.organizationRepo.getReviewLogs(organizationId);
  };

  return {
    registerOrganization,
    approveOrganization,
    rejectOrganization,
    listPendingOrganizations,
    verifyOrganizationEmail,
    getOrganizationById,
    getOrganizationReviewLogs,
  };
};

export type OrganizationService = ReturnType<typeof createOrganizationService>;
export const OrganizationService = createOrganizationService;
