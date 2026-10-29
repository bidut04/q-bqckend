import { TenantContext } from "../../core/tenant/tenant-context";
import { FormRepository } from "../../repository/form.repository";
import { getTenantDb } from "../../common/base.repository";
import { Authorizer } from "../../core/authorization/authorizer";
import { Permission } from "../../core/authorization/permissions";
import { BaseSecurityError, TenantAccessDeniedError } from "../../core/errors/security.errors";

export type FormStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

const defaultFormRepo = new FormRepository();

/**
 * Publishes a new immutable version of a dynamic form for a tenant branch.
 */
export const publishFormVersion = async (
  context: TenantContext,
  formId: string,
  versionNumber: number,
  fields: Array<{ name: string; label: string; type: string; required: boolean }>,
  formRepo: FormRepository = defaultFormRepo
) => {
  Authorizer.authorize(context, Permission.FORM_PUBLISH);

  const form = await formRepo.findFormById(context, formId);
  if (form.tenantId !== context.tenantId) {
    throw new TenantAccessDeniedError("Cannot modify form belonging to another tenant");
  }

  const db = await getTenantDb(context);

  // Create published immutable version
  return (db as any).formVersion.create({
    data: {
      tenantId: context.tenantId,
      formId,
      versionNumber,
      isPublished: true,
      publishedAt: new Date(),
      fields: {
        createMany: {
          data: fields.map((f) => ({
            tenantId: context.tenantId,
            name: f.name,
            label: f.label,
            type: f.type,
            required: f.required,
          })),
        },
      },
    },
  });
};

/**
 * Validates customer form submission payload against the exact published form version.
 */
export const validateSubmission = (
  publishedFields: Array<{ name: string; required: boolean }>,
  submissionData: Record<string, unknown>
): void => {
  for (const field of publishedFields) {
    if (field.required && (submissionData[field.name] === undefined || submissionData[field.name] === null)) {
      throw new BaseSecurityError(`Form submission missing required field '${field.name}'`, 400, "FORM_VALIDATION_FAILED");
    }
  }
};

export const formService = {
  publishFormVersion,
  validateSubmission,
};

export const FormService = function (this: unknown) {
  return formService;
} as unknown as {
  new (): typeof formService;
  publishFormVersion: typeof publishFormVersion;
  validateSubmission: typeof validateSubmission;
};

