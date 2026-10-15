import { TenantType, Role } from "@prisma/client";
import { OrganizationRepository, CreateOrganizationInput, OrganizationView } from "../../repository/organization.repository";
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
}

export interface OrganizationServiceDeps {
  organizationRepo: OrganizationRepository;
  otpService: OtpService;
}

export const createOrganizationService = (deps: OrganizationServiceDeps) => {
  /**
   * Registers a new organization submitted by an organization admin/creator.
   * - Automatically marks status as PROVISIONING (Pending Approval).
   * - Immediately dispatches an OTP to the organization's email address.
   */
  const registerOrganization = async (
    input: RegisterOrganizationInput,
    actor?: AuthUser
  ): Promise<{
    organization: OrganizationView;
    otpSent: boolean;
    expiresInSeconds: number;
    previewOtp?: string;
  }> => {
    const targetEmail = (input.email || input.AdministratorEmail || "").trim().toLowerCase();
    if (!targetEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
      throw new AppError("Valid organization email is required for registration", 400, "INVALID_ORG_EMAIL");
    }

    // 1. Create Organization in Database via Repository (forces PROVISIONING if actor is not super-admin)
    const organization = await deps.organizationRepo.create(
      {
        ...input,
        email: targetEmail,
      },
      actor
    );

    // 2. Dispatch OTP to the organization email address
    const otpResult = await deps.otpService.sendOtp({
      email: targetEmail,
      purpose: "Organization Registration Verification",
      recipientName: input.name,
    });

    return {
      organization,
      otpSent: otpResult.success,
      expiresInSeconds: otpResult.expiresInSeconds,
      ...(otpResult as any).previewOtp ? { previewOtp: (otpResult as any).previewOtp } : {},
    };
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

  return {
    registerOrganization,
    verifyOrganizationEmail,
    getOrganizationById,
  };
};

export type OrganizationService = ReturnType<typeof createOrganizationService>;
export const OrganizationService = createOrganizationService;
