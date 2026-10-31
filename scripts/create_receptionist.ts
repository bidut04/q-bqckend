import { PrismaClient, EmployeeStatus, ScopeType } from '@prisma/client';

const prisma = new PrismaClient();

const RECEPTIONIST_PERMISSIONS = [
  'TICKET_CREATE',
  'QUEUE_CALL',
  'QUEUE_VIEW',
  'BOOKING_READ',
  'BOOKING_CREATE',
];

const RECEPTIONIST_MATRIX_MODULES = [
  {
    id: 'tickets',
    module: 'Live Tickets',
    description: 'Real-time ticket tokens, counter call orders and stages',
    create: true,
    read: true,
    update: true,
    delete: false,
    copy: true,
    excel: false,
    print: true,
    pdf: false,
  },
  {
    id: 'queue',
    module: 'Queue Management',
    description: 'Live token calls, serving, transfers and waiting queue states',
    create: true,
    read: true,
    update: true,
    delete: false,
    copy: true,
    excel: false,
    print: true,
    pdf: false,
  },
  {
    id: 'bookings',
    module: 'Bookings & Appointments',
    description: 'Customer scheduled bookings, dates, timeslots and status',
    create: true,
    read: true,
    update: false,
    delete: false,
    copy: true,
    excel: true,
    print: true,
    pdf: false,
  },
  {
    id: 'dashboard',
    module: 'Dashboard',
    description: 'KPI summary, queue velocity and live waiting metrics',
    create: false,
    read: true,
    update: false,
    delete: false,
    copy: false,
    excel: false,
    print: false,
    pdf: false,
  },
  {
    id: 'queue-portal',
    module: 'Queue & Booking Portal',
    description: 'Self-service customer kiosk and ticket booking interface',
    create: true,
    read: true,
    update: false,
    delete: false,
    copy: true,
    excel: false,
    print: true,
    pdf: false,
  },
  {
    id: 'master-booking-form',
    module: 'Master Booking Form',
    description: 'Master appointment intake form configuration and fields',
    create: false,
    read: true,
    update: false,
    delete: false,
    copy: false,
    excel: false,
    print: false,
    pdf: false,
  },
  // Revoked Administrative Modules
  {
    id: 'roles',
    module: 'Roles & Designations',
    description: 'Security designations, privileges and permissions matrix',
    create: false,
    read: false,
    update: false,
    delete: false,
    copy: false,
    excel: false,
    print: false,
    pdf: false,
  },
  {
    id: 'permissions',
    module: 'Permissions Matrix',
    description: 'Decider access control, module visibility and action grants',
    create: false,
    read: false,
    update: false,
    delete: false,
    copy: false,
    excel: false,
    print: false,
    pdf: false,
  },
  {
    id: 'settings',
    module: 'Company Settings',
    description: 'Tenant organization branding, logo and operating hours',
    create: false,
    read: false,
    update: false,
    delete: false,
    copy: false,
    excel: false,
    print: false,
    pdf: false,
  },
  {
    id: 'form-builder',
    module: 'Dynamic Form Builder',
    description: 'Custom intake questions, conditional logic and layout editor',
    create: false,
    read: false,
    update: false,
    delete: false,
    copy: false,
    excel: false,
    print: false,
    pdf: false,
  },
];

async function main() {
  console.log('🚀 [Receptionist RBAC] Initializing Provisioning...');

  // 1. Select Tenant
  let tenant = await prisma.tenant.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
  });

  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        id: 'tenant-default',
        name: 'QueueFlow Enterprise Hub',
        type: 'BANK',
        slug: 'queueflow-hub',
        status: 'ACTIVE',
      },
    });
  }

  console.log(`🏢 Active Tenant: ${tenant.name} (${tenant.id})`);

  // 2. Find or Create Role: Receptionist
  let receptionistRole = await prisma.tenantRole.findFirst({
    where: {
      tenantId: tenant.id,
      name: 'Receptionist',
    },
  });

  if (!receptionistRole) {
    receptionistRole = await prisma.tenantRole.create({
      data: {
        tenantId: tenant.id,
        name: 'Receptionist',
        description: 'Front desk reception, visitor token issuance, and queue check-in',
        maxScope: ScopeType.LOCATION,
        isSystem: false,
      },
    });
    console.log(`✅ Role Created: Receptionist (${receptionistRole.id})`);
  } else {
    console.log(`ℹ️ Role Already Exists: Receptionist (${receptionistRole.id})`);
  }

  // 3. Ensure Permissions exist and link to Receptionist Role
  for (const permKey of RECEPTIONIST_PERMISSIONS) {
    let permission = await prisma.permission.findFirst({
      where: {
        tenantId: tenant.id,
        key: permKey,
      },
    });

    if (!permission) {
      permission = await prisma.permission.create({
        data: {
          tenantId: tenant.id,
          key: permKey,
          description: `Permission for ${permKey}`,
        },
      });
    }

    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: receptionistRole.id,
          permissionId: permission.id,
        },
      },
      create: {
        roleId: receptionistRole.id,
        permissionId: permission.id,
      },
      update: {},
    });
  }
  console.log(`🔐 Assigned ${RECEPTIONIST_PERMISSIONS.length} Permissions to Receptionist: ${RECEPTIONIST_PERMISSIONS.join(', ')}`);

  // 4. Create or Update Employee: Pooja Verma (Receptionist)
  const employeeCode = 'EMP-REC-01';
  let employee = await prisma.employee.findFirst({
    where: {
      tenantId: tenant.id,
      employeeCode,
    },
  });

  if (!employee) {
    employee = await prisma.employee.create({
      data: {
        tenantId: tenant.id,
        employeeCode,
        name: 'Pooja Verma',
        email: 'pooja.receptionist@queflow.com',
        phone: '+91 9876543210',
        department: 'Front Desk & Reception',
        status: EmployeeStatus.ACTIVE,
      },
    });
    console.log(`👤 Employee Created: Pooja Verma [${employeeCode}] (${employee.id})`);
  } else {
    employee = await prisma.employee.update({
      where: { id: employee.id },
      data: {
        name: 'Pooja Verma',
        department: 'Front Desk & Reception',
        status: EmployeeStatus.ACTIVE,
      },
    });
    console.log(`ℹ️ Employee Updated: Pooja Verma [${employeeCode}] (${employee.id})`);
  }

  // 5. Associate Employee with Receptionist Role (EmployeeRole)
  await prisma.employeeRole.upsert({
    where: {
      employeeId_roleId: {
        employeeId: employee.id,
        roleId: receptionistRole.id,
      },
    },
    create: {
      employeeId: employee.id,
      roleId: receptionistRole.id,
    },
    update: {},
  });
  console.log(`🔗 Associated Employee ${employee.name} with Role: Receptionist`);

  // 6. Save Permissions Matrix for Receptionist in TenantSetting
  const matrixNamespace = ('pm_' + receptionistRole.id).slice(0, 40);
  await prisma.tenantSetting.upsert({
    where: {
      tenantId_namespace: {
        tenantId: tenant.id,
        namespace: matrixNamespace,
      },
    },
    create: {
      tenantId: tenant.id,
      namespace: matrixNamespace,
      value: RECEPTIONIST_MATRIX_MODULES,
      updatedBy: employee.id,
    },
    update: {
      value: RECEPTIONIST_MATRIX_MODULES,
      updatedBy: employee.id,
      version: { increment: 1 },
    },
  });
  console.log(`📊 Persisted Permissions Matrix in TenantSetting [${matrixNamespace}]`);

  // 7. Verify Association and Permissions
  const verification = await prisma.employee.findUnique({
    where: { id: employee.id },
    include: {
      roles: {
        include: {
          role: {
            include: {
              permissions: {
                include: { permission: true },
              },
            },
          },
        },
      },
    },
  });

  const verifiedRoleNames = verification?.roles.map((r) => r.role.name) || [];
  const verifiedPermissions = verification?.roles.flatMap((r) =>
    r.role.permissions.map((p) => p.permission.key)
  ) || [];

  console.log('\n=========================================');
  console.log('🎉 RECEPTIONIST RBAC PROVISIONING COMPLETE');
  console.log('=========================================');
  console.log(`👤 Employee Name:   ${verification?.name}`);
  console.log(`🏷️ Employee Code:   ${verification?.employeeCode}`);
  console.log(`🏢 Department:      ${verification?.department}`);
  console.log(`🛡️ Assigned Roles:  ${verifiedRoleNames.join(', ')}`);
  console.log(`🔑 Granted Perms:   ${verifiedPermissions.join(', ')}`);
  console.log('📊 Active Modules:   Tickets, Queue, Bookings, Dashboard, Queue Portal');
  console.log('🚫 Revoked Modules:  Roles, Permissions Matrix, Settings, Form Builder');
  console.log('=========================================\n');
}

main()
  .catch((err) => {
    console.error('❌ Provisioning Error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

