import { PrismaClient, Role, TenantType, TenantStatus, LocationStatus, ServiceStatus, QueueStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function seedPortalData() {
  console.log('Seeding Real Portal Organizations, Branches, and Services...');

  // 1. Ensure Region and Shard exist
  const region = await prisma.region.upsert({
    where: { code: 'ap-south-1' },
    update: {},
    create: {
      code: 'ap-south-1',
      name: 'Asia Pacific (Mumbai)',
      isActive: true,
    },
  });

  await prisma.shard.upsert({
    where: { code: 'shard_01' },
    update: {},
    create: {
      code: 'shard_01',
      regionId: region.id,
      connectionRef: 'DATABASE_URL',
      status: 'ACTIVE',
      dbHealth: 'HEALTHY',
      weight: 100,
      tenantCapacity: 500,
    },
  });

  const tenantsData = [
    {
      id: 'tenant-sbi',
      name: 'State Bank of India',
      legalName: 'State Bank of India Ltd',
      slug: 'sbi-bank',
      type: TenantType.BANK,
      status: TenantStatus.ACTIVE,
      branches: [
        {
          name: 'Daspur Main Branch',
          code: 'SBI-DSP-01',
          address: { street: 'Daspur Bazar, Near Post Office', city: 'Daspur', district: 'Paschim Medinipur', state: 'West Bengal', postalCode: '721129', latitude: 22.6042, longitude: 87.7212 },
          phone: '+91 3225 254201',
          waitMinutes: 8,
          activeCounters: 3,
        },
        {
          name: 'Midnapore Collectorate Branch',
          code: 'SBI-MID-02',
          address: { street: 'Collectorate Complex, Keranitola', city: 'Midnapore', district: 'Paschim Medinipur', state: 'West Bengal', postalCode: '721101', latitude: 22.4257, longitude: 87.3199 },
          phone: '+91 3222 275302',
          waitMinutes: 14,
          activeCounters: 4,
        },
        {
          name: 'Kharagpur Railway Settlement Branch',
          code: 'SBI-KGP-03',
          address: { street: 'Station Road, Railway Settlement', city: 'Kharagpur', district: 'Paschim Medinipur', state: 'West Bengal', postalCode: '721301', latitude: 22.3424, longitude: 87.3275 },
          phone: '+91 3222 220103',
          waitMinutes: 19,
          activeCounters: 2,
        },
        {
          name: 'Tamluk Link Road Branch',
          code: 'SBI-TMK-04',
          address: { street: 'Link Road, Maniktala', city: 'Tamluk', district: 'Purba Medinipur', state: 'West Bengal', postalCode: '721636', latitude: 22.2986, longitude: 87.9242 },
          phone: '+91 3228 266404',
          waitMinutes: 11,
          activeCounters: 3,
        },
      ],
      services: [
        { name: 'KYC Verification', code: 'SRV-KYC', description: 'Identity verification & biometric document validation with fast-track processing.', durationSec: 480 },
        { name: 'Account Opening', code: 'SRV-ACC', description: 'Open new savings, current or NRI account with instant debit card kit.', durationSec: 720 },
        { name: 'Cash Deposit & Withdrawal', code: 'SRV-CASH', description: 'Counter deposit, high-value withdrawals, and currency exchange.', durationSec: 600 },
        { name: 'Fund Transfer & RTGS/NEFT', code: 'SRV-TRF', description: 'Domestic & international outward remittances, draft issuance.', durationSec: 600 },
        { name: 'Personal & Home Loan Services', code: 'SRV-LOAN', description: 'Loan eligibility assessment, document submission and query resolution.', durationSec: 1200 },
        { name: 'General Enquiries & Support', code: 'SRV-GEN', description: 'Passbook printing, complaint registration, and banking support.', durationSec: 600 },
      ],
    },
    {
      id: 'tenant-hdfc',
      name: 'HDFC Bank Ltd',
      legalName: 'HDFC Bank Limited',
      slug: 'hdfc-bank',
      type: TenantType.BANK,
      status: TenantStatus.ACTIVE,
      branches: [
        {
          name: 'Ghatal Chowrasta Branch',
          code: 'HDFC-GHT-01',
          address: { street: 'Kushpata Chowrasta', city: 'Ghatal', district: 'Paschim Medinipur', state: 'West Bengal', postalCode: '721212', latitude: 22.6667, longitude: 87.7167 },
          phone: '+91 3225 255100',
          waitMinutes: 12,
          activeCounters: 3,
        },
        {
          name: 'Midnapore Sadar Branch',
          code: 'HDFC-MID-02',
          address: { street: 'Bidhannagar Main Road', city: 'Midnapore', district: 'Paschim Medinipur', state: 'West Bengal', postalCode: '721101', latitude: 22.4215, longitude: 87.3241 },
          phone: '+91 3222 267800',
          waitMinutes: 16,
          activeCounters: 2,
        },
      ],
      services: [
        { name: 'Premium Banking & Wealth', code: 'HDFC-WLTH', description: 'Priority desk for Classic and Imperia banking patrons.', durationSec: 900 },
        { name: 'Credit Card & Forex Services', code: 'HDFC-CARD', description: 'Forex reload, travel cards and instant credit line upgrade.', durationSec: 600 },
        { name: 'Cash Management & Cheque Drop', code: 'HDFC-CMS', description: 'Commercial bulk cash deposit and clearance verification.', durationSec: 480 },
      ],
    },
    {
      id: 'tenant-post',
      name: 'India Post Department',
      legalName: 'Department of Posts - Government of India',
      slug: 'india-post',
      type: TenantType.POST_OFFICE,
      status: TenantStatus.ACTIVE,
      branches: [
        {
          name: 'Daspur Sub Post Office',
          code: 'POST-DSP-01',
          address: { street: 'Thana Road, Daspur', city: 'Daspur', district: 'Paschim Medinipur', state: 'West Bengal', postalCode: '721129', latitude: 22.6035, longitude: 87.7228 },
          phone: '+91 3225 254100',
          waitMinutes: 9,
          activeCounters: 2,
        },
        {
          name: 'Ghatal Head Post Office',
          code: 'POST-GHT-02',
          address: { street: 'Kushpata Court Road', city: 'Ghatal', district: 'Paschim Medinipur', state: 'West Bengal', postalCode: '721212', latitude: 22.6645, longitude: 87.7188 },
          phone: '+91 3225 255200',
          waitMinutes: 15,
          activeCounters: 3,
        },
      ],
      services: [
        { name: 'Speed Post & Parcel Booking', code: 'POST-SPEED', description: 'Express domestic and international air parcel booking with live tracking.', durationSec: 360 },
        { name: 'Post Office Savings Bank (POSB)', code: 'POST-SAV', description: 'Senior citizen savings, Sukanya Samriddhi and PPF deposits.', durationSec: 600 },
        { name: 'Aadhaar Updation & Enrolment', code: 'POST-UIDAI', description: 'Biometric update, phone number link and fresh Aadhaar card registration.', durationSec: 720 },
      ],
    },
    {
      id: 'tenant-collectorate',
      name: 'District Collectorate Office',
      legalName: 'Office of the District Magistrate & Collector, Paschim Medinipur',
      slug: 'district-collectorate',
      type: TenantType.GOVERNMENT,
      status: TenantStatus.ACTIVE,
      branches: [
        {
          name: 'Paschim Medinipur Collectorate',
          code: 'GOV-MID-01',
          address: { street: 'Collectorate Building, Keranitola', city: 'Midnapore', district: 'Paschim Medinipur', state: 'West Bengal', postalCode: '721101', latitude: 22.4265, longitude: 87.3212 },
          phone: '+91 3222 275300',
          waitMinutes: 18,
          activeCounters: 4,
        },
      ],
      services: [
        { name: 'Land Records & Mutation (Banglarbhumi)', code: 'GOV-LAND', description: 'Porcha verification, land mutation applications, and hearing tokens.', durationSec: 900 },
        { name: 'Caste & Income Certificate Verification', code: 'GOV-CERT', description: 'Physical scrutiny and token issuance for SC/ST/OBC and income certificates.', durationSec: 600 },
        { name: 'Citizens Grievance Redressal Desk', code: 'GOV-GRV', description: 'Direct grievance token registration with District Magistrate officers.', durationSec: 720 },
      ],
    },
    {
      id: 'tenant-apollo',
      name: 'Apollo Health Clinic',
      legalName: 'Apollo Clinics Ltd',
      slug: 'apollo-clinic',
      type: TenantType.HOSPITAL,
      status: TenantStatus.ACTIVE,
      branches: [
        {
          name: 'Kharagpur Diagnostic Centre',
          code: 'APOLLO-KGP-01',
          address: { street: 'OT Road, Inda', city: 'Kharagpur', district: 'Paschim Medinipur', state: 'West Bengal', postalCode: '721305', latitude: 22.3512, longitude: 87.3321 },
          phone: '+91 3222 258900',
          waitMinutes: 10,
          activeCounters: 3,
        },
      ],
      services: [
        { name: 'Doctor Consultation Token', code: 'HLTH-DOC', description: 'Specialist physician, cardiologist and general medicine OPD queue token.', durationSec: 900 },
        { name: 'Blood Test & Pathology Diagnostics', code: 'HLTH-LAB', description: 'Fasting and routine blood sample collection with digital reports.', durationSec: 420 },
        { name: 'Pharmacy Fast-Track Dispenser', code: 'HLTH-PHARM', description: 'Prescription medicine dispatch with priority queue token.', durationSec: 300 },
      ],
    },
  ];

  for (const t of tenantsData) {
    const tenant = await prisma.tenant.upsert({
      where: { id: t.id },
      update: {
        name: t.name,
        legalName: t.legalName,
        slug: t.slug,
        type: t.type,
        status: t.status,
      },
      create: {
        id: t.id,
        name: t.name,
        legalName: t.legalName,
        slug: t.slug,
        type: t.type,
        status: t.status,
        shardId: 'shard_01',
        Administrator: `${t.name} Admin`,
        AdministratorEmail: `admin@${t.slug}.com`,
        Assigned_TenantRole: Role.ADMIN,
      },
    });

    console.log(`✅ Upserted tenant: ${tenant.name} (${tenant.id})`);

    // Upsert Services
    const createdServices: any[] = [];
    for (const s of t.services) {
      const srv = await prisma.service.upsert({
        where: {
          tenantId_name: {
            tenantId: tenant.id,
            name: s.name,
          },
        },
        update: {
          code: s.code,
          description: s.description,
          status: ServiceStatus.ACTIVE,
          estimatedDurationSec: s.durationSec,
        },
        create: {
          tenantId: tenant.id,
          name: s.name,
          code: s.code,
          description: s.description,
          status: ServiceStatus.ACTIVE,
          estimatedDurationSec: s.durationSec,
        },
      });
      createdServices.push(srv);
    }

    // Upsert Branches (Locations)
    for (const b of t.branches) {
      const loc = await prisma.location.upsert({
        where: {
          tenantId_code: {
            tenantId: tenant.id,
            code: b.code,
          },
        },
        update: {
          name: b.name,
          address: b.address,
          phone: b.phone,
          status: LocationStatus.ACTIVE,
        },
        create: {
          tenantId: tenant.id,
          name: b.name,
          code: b.code,
          address: b.address,
          phone: b.phone,
          status: LocationStatus.ACTIVE,
        },
      });

      // Link location with services and create queues
      for (const srv of createdServices) {
        await prisma.locationService.upsert({
          where: {
            locationId_serviceId: {
              locationId: loc.id,
              serviceId: srv.id,
            },
          },
          update: { enabled: true, bookingEnabled: true, queueEnabled: true },
          create: {
            locationId: loc.id,
            serviceId: srv.id,
            enabled: true,
            bookingEnabled: true,
            queueEnabled: true,
          },
        });

        const queueCode = `Q-${b.code}-${srv.code}`;
        await prisma.queue.upsert({
          where: {
            locationId_code: {
              locationId: loc.id,
              code: queueCode,
            },
          },
          update: {
            name: `${srv.name} Queue`,
            status: QueueStatus.OPEN,
          },
          create: {
            tenantId: tenant.id,
            locationId: loc.id,
            serviceId: srv.id,
            name: `${srv.name} Queue`,
            code: queueCode,
            status: QueueStatus.OPEN,
            tokenPrefix: srv.code?.slice(0, 2) || 'TK',
            tokenStart: 1,
            lastTokenNumber: 23,
          },
        });
      }
    }
  }

  console.log('🎉 Seeded all tenants, services, locations, and queues into MySQL!');
}

seedPortalData()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
