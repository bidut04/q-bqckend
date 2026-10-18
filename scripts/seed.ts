import { PrismaClient, Role, PlatformRoleType, MemberStatus, TenantAdminRole, TenantType, TenantStatus } from "@prisma/client";
import bcrypt from "bcrypt";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();

async function seed() {
  console.log("🌱 Starting seed for Super Admin and Initial Setup...");

  const adminEmail = "admin@gmail.com".toLowerCase().trim();
  const plainPassword = "admin123";
  const passwordHash = await bcrypt.hash(plainPassword, 10);

  // 1. Upsert Super Admin User in Catalog DB
  console.log(`👤 Creating/updating Super Admin user: ${adminEmail}`);
  const user = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      passwordHash,
      role: Role.ADMIN,
      isActive: true,
      isVerified: true,
      mfaEnabled: false,
      failedLoginAttempts: 0,
      lockoutUntil: null,
    },
    create: {
      email: adminEmail,
      passwordHash,
      role: Role.ADMIN,
      isActive: true,
      isVerified: true,
      mfaEnabled: false,
    },
  });

  console.log(`✅ Super Admin User ready (ID: ${user.id})`);

  // 2. Upsert PlatformMember as PLATFORM_OWNER (Super Admin)
  console.log("🛡️ Assigning PlatformMember (PLATFORM_OWNER)...");
  await prisma.platformMember.upsert({
    where: { userId: user.id },
    update: {
      role: PlatformRoleType.PLATFORM_OWNER,
      status: MemberStatus.ACTIVE,
      mfaRequired: false,
    },
    create: {
      userId: user.id,
      role: PlatformRoleType.PLATFORM_OWNER,
      status: MemberStatus.ACTIVE,
      mfaRequired: false,
    },
  });
  console.log("✅ PlatformMember assigned.");

  // 3. Ensure Region and Shard exist for Catalog/Sharding
  try {
    const region = await prisma.region.upsert({
      where: { code: "ap-south-1" },
      update: {},
      create: {
        code: "ap-south-1",
        name: "Asia Pacific (Mumbai)",
        isActive: true,
      },
    });

    await prisma.shard.upsert({
      where: { code: "shard_01" },
      update: {
        status: "ACTIVE",
        dbHealth: "HEALTHY",
      },
      create: {
        code: "shard_01",
        regionId: region.id,
        connectionRef: "DATABASE_URL",
        status: "ACTIVE",
        dbHealth: "HEALTHY",
        weight: 100,
        tenantCapacity: 500,
      },
    });
    console.log("✅ Region & Shard shard_01 configured.");
  } catch (err: any) {
    console.warn("⚠️ Region/Shard note:", err.message);
  }

  // 4. Ensure default Tenant (tenant_bank_a) exists
  const defaultTenantId = "tenant_bank_a";
  console.log(`🏢 Ensuring default tenant: ${defaultTenantId}`);
  try {
    const tenant = await prisma.tenant.upsert({
      where: { id: defaultTenantId },
      update: {
        status: TenantStatus.ACTIVE,
        Administrator: "Super Admin",
        AdministratorEmail: adminEmail,
        Assigned_TenantRole: Role.ADMIN,
      },
      create: {
        id: defaultTenantId,
        name: "Global QueueFlow Enterprise Hub",
        slug: "enterprise-hub",
        type: TenantType.BANK,
        status: TenantStatus.ACTIVE,
        shardId: "shard_01",
        Administrator: "Super Admin",
        AdministratorEmail: adminEmail,
        Assigned_TenantRole: Role.ADMIN,
      },
    });

    // 5. Link Super Admin to Default Tenant as TENANT_OWNER
    await prisma.tenantMember.upsert({
      where: {
        tenantId_userId: {
          tenantId: tenant.id,
          userId: user.id,
        },
      },
      update: {
        adminRole: TenantAdminRole.TENANT_OWNER,
        status: MemberStatus.ACTIVE,
      },
      create: {
        tenantId: tenant.id,
        userId: user.id,
        adminRole: TenantAdminRole.TENANT_OWNER,
        status: MemberStatus.ACTIVE,
      },
    });
    console.log("✅ Tenant & TenantMember configured.");
  } catch (err: any) {
    console.warn("⚠️ Tenant note:", err.message);
  }

  console.log("\n=======================================================");
  console.log("🎉 SUPER ADMIN SEED COMPLETED SUCCESSFULLY!");
  console.log(`   Email:    ${adminEmail}`);
  console.log(`   Password: ${plainPassword}`);
  console.log(`   Role:     ADMIN / PLATFORM_OWNER`);
  console.log("=======================================================\n");
}

seed()
  .catch((e) => {
    console.error("❌ Seed failed with error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
