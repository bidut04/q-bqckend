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
          name: 'VIP Road Branch',
          code: 'HDFC-VIP-01',
          address: {
            street: 'Ground Floor, Sagar Jyoti Apartment, VIP Road',
            locality: 'Baguiati',
            city: 'Kolkata',
            district: 'North 24 Parganas',
            state: 'West Bengal',
            postalCode: '700059',
            latitude: 22.6171,
            longitude: 88.4279,
          },
          phone: '+91 33 2570 3000',
          waitMinutes: 10,
          activeCounters: 4,
        },
        {
          name: 'Joramandir Branch',
          code: 'HDFC-JOR-02',
          address: {
            street: 'H/J2, Rajarhat Main Road, Joramandir',
            locality: 'Baguiati',
            city: 'Kolkata',
            district: 'North 24 Parganas',
            state: 'West Bengal',
            postalCode: '700059',
            latitude: 22.6152,
            longitude: 88.4298,
          },
          phone: '+91 33 2570 4500',
          waitMinutes: 12,
          activeCounters: 3,
        },
        {
          name: 'Narkeldanga Branch',
          code: 'HDFC-NRK-03',
          address: {
            street: '74/1, Ground Floor, Narkeldanga Main Road, near Subhas Sarobar Park',
            locality: 'Phoolbagan',
            city: 'Kolkata',
            district: 'Kolkata',
            state: 'West Bengal',
            postalCode: '700010',
            latitude: 22.5684,
            longitude: 88.3912,
          },
          phone: '+91 33 2363 8000',
          waitMinutes: 14,
          activeCounters: 3,
        },
        {
          name: 'CIT Road, Scheme 6M Branch',
          code: 'HDFC-CIT-04',
          address: {
            street: 'P/341, CIT Road, Scheme 6M, Kankurgachi/Phoolbagan',
            locality: 'Phoolbagan',
            city: 'Kolkata',
            district: 'Kolkata',
            state: 'West Bengal',
            postalCode: '700054',
            ifsc: 'HDFC0001224',
            latitude: 22.5710,
            longitude: 88.3975,
          },
          phone: '+91 33 2364 7700',
          waitMinutes: 11,
          activeCounters: 4,
        },
      ],
      services: [
        { name: 'Account Servicing & Management', code: 'HDFC-ACC', description: 'Savings, salary, current accounts and priority banking setup.', durationSec: 600 },
        { name: 'Cash & Cheque Transactions', code: 'HDFC-CASH', description: 'Counter deposit, high-value withdrawals, and cheque clearing.', durationSec: 480 },
        { name: 'Debit & Credit Cards Desk', code: 'HDFC-CARD', description: 'Instant card issuance, upgrade, blocking and reward queries.', durationSec: 420 },
        { name: 'Fund Transfers & Remittance', code: 'HDFC-TRF', description: 'Domestic NEFT/RTGS and international wire transfers.', durationSec: 480 },
        { name: 'Loans & Personal Lending', code: 'HDFC-LOAN', description: 'Personal, auto, home loan assistance and document verification.', durationSec: 900 },
        { name: 'Customer Support Desk', code: 'HDFC-SUPP', description: 'NetBanking, mobile app, and general customer grievance resolution.', durationSec: 360 },
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
          name: 'Phoolbagan Sub Post Office',
          code: 'POST-PHL-01',
          address: {
            street: 'P-284, CIT Road, Scheme 6M, Phoolbagan/Beleghata',
            locality: 'Phoolbagan',
            city: 'Kolkata',
            district: 'Kolkata',
            state: 'West Bengal',
            postalCode: '700085',
            latitude: 22.5690,
            longitude: 88.3960,
          },
          phone: '+91 33 2363 1100',
          waitMinutes: 9,
          activeCounters: 3,
        },
        {
          name: 'Ram Krishna Samadhi Road Post Office',
          code: 'POST-RKS-02',
          address: {
            street: 'B-328, CIT Road, Scheme VI-M, Kankurgachi',
            locality: 'Phoolbagan',
            city: 'Kolkata',
            district: 'Kolkata',
            state: 'West Bengal',
            postalCode: '700054',
            latitude: 22.5721,
            longitude: 88.3948,
          },
          phone: '+91 33 2364 2200',
          waitMinutes: 12,
          activeCounters: 2,
        },
      ],
      services: [
        { name: 'Letters & Speed Post Booking', code: 'POST-SPEED', description: 'Express domestic speed post and registered mail articles.', durationSec: 300 },
        { name: 'Parcel & Logistics Counter', code: 'POST-PCL', description: 'Domestic & international parcel booking with digital barcoding.', durationSec: 420 },
        { name: 'Post Office Savings Bank (POSB)', code: 'POST-SAV', description: 'Savings deposits, Senior Citizen Schemes, Sukanya Samriddhi and PPF.', durationSec: 600 },
        { name: 'Postal Certificates & Counter Services', code: 'POST-CERT', description: 'KVP, NSC certificates purchase, encashment and pension services.', durationSec: 480 },
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
      id: 'tenant-pnb',
      name: 'Punjab National Bank',
      legalName: 'Punjab National Bank Ltd',
      slug: 'pnb-india',
      type: TenantType.BANK,
      status: TenantStatus.ACTIVE,
      branches: [
        {
          name: 'Baguiati Branch',
          code: 'PNB-BAG-01',
          address: {
            street: '1st Floor, Baguiati AC Market, Baguiati Road',
            locality: 'Baguiati',
            city: 'Kolkata',
            district: 'North 24 Parganas',
            state: 'West Bengal',
            postalCode: '700059',
            ifsc: 'PUNB0012620',
            latitude: 22.6182,
            longitude: 88.4291,
          },
          phone: '+91 33 2570 1200',
          waitMinutes: 14,
          activeCounters: 4,
        },
      ],
      services: [
        { name: 'Account Opening & KYC', code: 'PNB-ACC', description: 'Savings, current, fixed deposit and digital account onboarding.', durationSec: 720 },
        { name: 'Cash Deposits & Withdrawals', code: 'PNB-CASH', description: 'High-value and routine counter cash transactions.', durationSec: 480 },
        { name: 'Cheque Services & Clearing', code: 'PNB-CHQ', description: 'Cheque deposit, collection clearance and demand draft issuance.', durationSec: 360 },
        { name: 'Fund Transfers (NEFT/RTGS)', code: 'PNB-TRF', description: 'Inter-bank fund transfers and inward/outward remittances.', durationSec: 480 },
        { name: 'Retail & SME Loans', code: 'PNB-LOAN', description: 'Housing loans, vehicle loans, and MSME business credit consultations.', durationSec: 1200 },
        { name: 'Customer Support & Helpdesk', code: 'PNB-SUPP', description: 'Passbook updating, card services, mobile banking and grievance support.', durationSec: 420 },
      ],
    },
    {
      id: 'tenant-bandhan',
      name: 'Bandhan Bank',
      legalName: 'Bandhan Bank Limited',
      slug: 'bandhan-bank',
      type: TenantType.BANK,
      status: TenantStatus.ACTIVE,
      branches: [
        {
          name: 'Baguiati Branch',
          code: 'BDBL-BAG-01',
          address: {
            street: 'DC-114/1, Narayantala (West), P.O. Deshbandhu Nagar',
            locality: 'Baguiati',
            city: 'Kolkata',
            district: 'North 24 Parganas',
            state: 'West Bengal',
            postalCode: '700059',
            latitude: 22.6165,
            longitude: 88.4268,
          },
          phone: '+91 33 2570 8820',
          waitMinutes: 11,
          activeCounters: 3,
        },
      ],
      services: [
        { name: 'Savings & Current Accounts', code: 'BDBL-ACC', description: 'Open new high-interest savings and business current accounts.', durationSec: 600 },
        { name: 'Cash Deposits & Counter Service', code: 'BDBL-DEP', description: 'Cash deposit and receipt counter transactions.', durationSec: 360 },
        { name: 'Cash Withdrawals & Cheque Drop', code: 'BDBL-WDL', description: 'Counter withdrawals and bulk cheque drop box verification.', durationSec: 360 },
        { name: 'Loan-Related Assistance', code: 'BDBL-LOAN', description: 'Micro-banking loans, housing loans and gold loan advisory.', durationSec: 900 },
        { name: 'Account Servicing & Support', code: 'BDBL-SRV', description: 'Address changes, mobile link, statements and customer servicing.', durationSec: 480 },
      ],
    },
    {
      id: 'tenant-axis',
      name: 'Axis Bank',
      legalName: 'Axis Bank Limited',
      slug: 'axis-bank',
      type: TenantType.BANK,
      status: TenantStatus.ACTIVE,
      branches: [
        {
          name: 'Baguiati Branch',
          code: 'AXIS-BAG-01',
          address: {
            street: 'Mangalik, H.H. 19/1, VIP Road',
            locality: 'Baguiati',
            city: 'Kolkata',
            district: 'North 24 Parganas',
            state: 'West Bengal',
            postalCode: '700059',
            ifsc: 'UTIB0000026',
            latitude: 22.6178,
            longitude: 88.4282,
          },
          phone: '+91 33 2570 0026',
          waitMinutes: 15,
          activeCounters: 4,
        },
        {
          name: 'Phoolbagan Branch',
          code: 'AXIS-PHL-02',
          address: {
            street: 'P-336, Swami Swarupananda Sarani',
            locality: 'Phoolbagan',
            city: 'Kolkata',
            district: 'Kolkata',
            state: 'West Bengal',
            postalCode: '700054',
            latitude: 22.5695,
            longitude: 88.3962,
          },
          phone: '+91 33 2363 4500',
          waitMinutes: 12,
          activeCounters: 3,
        },
      ],
      services: [
        { name: 'General Banking & Accounts', code: 'AXIS-BNK', description: 'Account opening, priority banking and debit card re-issuance.', durationSec: 600 },
        { name: 'Forex & Travel Card Services', code: 'AXIS-FRX', description: 'Foreign currency exchange, multi-currency forex card reload.', durationSec: 540 },
        { name: 'Safe Deposit Lockers Desk', code: 'AXIS-LCK', description: 'Locker operations, locker allotment and surrender processing.', durationSec: 420 },
        { name: 'NSDL & Demat Related Services', code: 'AXIS-DEM', description: 'Demat account opening, shares remat, and wealth advisory.', durationSec: 720 },
      ],
    },
    {
      id: 'tenant-iob',
      name: 'Indian Overseas Bank',
      legalName: 'Indian Overseas Bank',
      slug: 'iob-bank',
      type: TenantType.BANK,
      status: TenantStatus.ACTIVE,
      branches: [
        {
          name: 'Phoolbagan Branch',
          code: 'IOB-PHL-01',
          address: {
            street: '132/A/1/B, Raja Rajendra Lal Mitra Road',
            locality: 'Phoolbagan',
            city: 'Kolkata',
            district: 'Kolkata',
            state: 'West Bengal',
            postalCode: '700010',
            latitude: 22.5678,
            longitude: 88.3951,
          },
          phone: '+91 33 2370 4210',
          waitMinutes: 13,
          activeCounters: 3,
        },
      ],
      services: [
        { name: 'Account Servicing & Maintenance', code: 'IOB-ACC', description: 'New account opening, passbook update, and KYC verification.', durationSec: 600 },
        { name: 'Deposits & Cash Counter', code: 'IOB-DEP', description: 'Cash deposit, utility bills and fixed deposit creation.', durationSec: 480 },
        { name: 'Withdrawals & Remittances', code: 'IOB-WDL', description: 'Cheque clearance, counter withdrawals, and DD issue.', durationSec: 420 },
        { name: 'Fund Transfers & NEFT/RTGS', code: 'IOB-TRF', description: 'Domestic fund remittances and government pension transfers.', durationSec: 480 },
        { name: 'Customer Requests & Support', code: 'IOB-REQ', description: 'Locker queries, debit cards and customer inquiries.', durationSec: 360 },
      ],
    },
    {
      id: 'tenant-karnatakabank',
      name: 'Karnataka Bank',
      legalName: 'Karnataka Bank Limited',
      slug: 'karnataka-bank',
      type: TenantType.BANK,
      status: TenantStatus.ACTIVE,
      branches: [
        {
          name: 'Beliaghata Branch',
          code: 'KTKB-BEL-01',
          address: {
            street: '32, Hem Chandra Naskar Road, Sura Cross Lane',
            locality: 'Phoolbagan',
            city: 'Kolkata',
            district: 'Kolkata',
            state: 'West Bengal',
            postalCode: '700010',
            latitude: 22.5665,
            longitude: 88.3925,
          },
          phone: '+91 33 2372 1190',
          waitMinutes: 10,
          activeCounters: 3,
        },
      ],
      services: [
        { name: 'Retail Banking Services', code: 'KTKB-RET', description: 'Savings, current account opening, and retail banking support.', durationSec: 600 },
        { name: 'Deposits & Cash Desk', code: 'KTKB-DEP', description: 'Cash receipts, fixed deposit term investment and TD renewal.', durationSec: 420 },
        { name: 'Fund Transfers & Remittance', code: 'KTKB-TRF', description: 'NEFT, RTGS and demand draft collections.', durationSec: 480 },
        { name: 'Account Maintenance & KYC', code: 'KTKB-MAINT', description: 'KYC updates, signature modification, and statement generation.', durationSec: 360 },
        { name: 'Loan Assistance & Credit', code: 'KTKB-LOAN', description: 'Housing loans, gold loans, and retail credit consultation.', durationSec: 900 },
      ],
    },
    {
      id: 'tenant-wbscb',
      name: 'West Bengal State Co-operative Bank',
      legalName: 'The West Bengal State Co-operative Bank Ltd',
      slug: 'wbscb-bank',
      type: TenantType.BANK,
      status: TenantStatus.ACTIVE,
      branches: [
        {
          name: 'Beliaghata Branch',
          code: 'WBSCB-BEL-01',
          address: {
            street: '24A, CIT Road, Scheme 6M, Kadapara',
            locality: 'Phoolbagan',
            city: 'Kolkata',
            district: 'Kolkata',
            state: 'West Bengal',
            postalCode: '700054',
            latitude: 22.5702,
            longitude: 88.3980,
          },
          phone: '+91 33 2364 8900',
          waitMinutes: 12,
          activeCounters: 2,
        },
      ],
      services: [
        { name: 'Cooperative Banking Accounts', code: 'WBSCB-ACC', description: 'Cooperative savings accounts, Kisan credit card, and member deposits.', durationSec: 600 },
        { name: 'Account Servicing & Passbook', code: 'WBSCB-SRV', description: 'Passbook updating, certificate verification, and member inquiries.', durationSec: 420 },
        { name: 'Cash Transactions & Deposits', code: 'WBSCB-TXN', description: 'Cash deposit, withdrawal and recurring deposit payments.', durationSec: 480 },
      ],
    },
    {
      id: 'tenant-revive-hospital',
      name: 'REVIVE NURSING HOME',
      legalName: 'Revive Nursing Home & Healthcare Pvt Ltd',
      slug: 'revive-nursing-home',
      type: TenantType.HOSPITAL,
      status: TenantStatus.ACTIVE,
      branches: [
        {
          name: 'Baguiati Hospital Campus',
          code: 'REV-BAG-01',
          address: {
            street: 'Jyangra, behind SBI, Baguiati',
            locality: 'Baguiati',
            city: 'Kolkata',
            district: 'North 24 Parganas',
            state: 'West Bengal',
            postalCode: '700159',
            latitude: 22.6185,
            longitude: 88.4305,
          },
          phone: '+91 33 2570 7000',
          waitMinutes: 18,
          activeCounters: 4,
        },
      ],
      services: [
        { name: 'Outpatient Consultations (OPD)', code: 'REV-OPD', description: 'Specialist physicians, pediatricians, gynecologists and surgeons OPD queue.', durationSec: 900 },
        { name: 'Inpatient Admissions & Bed Booking', code: 'REV-ADM', description: 'Emergency bed intake, planned surgery admissions and insurance clearance.', durationSec: 720 },
        { name: 'General Surgery & OT Intake', code: 'REV-SURG', description: 'Pre-operative check, surgical consultation and OT booking.', durationSec: 1200 },
        { name: 'Intensive Care Unit (ICU) Desk', code: 'REV-ICU', description: 'Critical care coordination and family reporting desk.', durationSec: 600 },
        { name: 'Clinical Pathology & Diagnostics', code: 'REV-PATH', description: 'Blood tests, biochemistry, microbial culture and emergency lab reports.', durationSec: 480 },
        { name: '24/7 In-House Pharmacy', code: 'REV-PHARM', description: 'Prescription medicines and surgical consumables billing queue.', durationSec: 300 },
      ],
    },
    {
      id: 'tenant-apollo-baguiati',
      name: 'Apollo Clinic Baguiati',
      legalName: 'Apollo Health and Lifestyle Ltd - Apollo Clinic Baguiati',
      slug: 'apollo-clinic-baguiati',
      type: TenantType.CLINIC,
      status: TenantStatus.ACTIVE,
      branches: [
        {
          name: 'Baguiati Clinic',
          code: 'APL-BAG-01',
          address: {
            street: 'Narayantala West Lane, near College More',
            locality: 'Baguiati',
            city: 'Kolkata',
            district: 'North 24 Parganas',
            state: 'West Bengal',
            postalCode: '700101',
            latitude: 22.6160,
            longitude: 88.4255,
          },
          phone: '+91 33 4004 5500',
          waitMinutes: 12,
          activeCounters: 4,
        },
      ],
      services: [
        { name: 'Specialist Doctor Consultation', code: 'APL-DOC', description: 'Consultations with top doctors in cardiology, neurology, diabetes & pediatrics.', durationSec: 900 },
        { name: 'Laboratory Tests & Blood Collection', code: 'APL-LAB', description: 'NABL-accredited diagnostic tests with home and counter report delivery.', durationSec: 360 },
        { name: 'Ultrasound (USG) Imaging', code: 'APL-USG', description: 'Abdominal, pelvic and Doppler ultrasound scans by expert radiologists.', durationSec: 720 },
        { name: 'Digital X-Ray Counter', code: 'APL-XRAY', description: 'Chest, bone and joint radiography with instant digital film output.', durationSec: 480 },
        { name: 'ECG & Echocardiography', code: 'APL-CARD', description: 'Resting 12-lead ECG and 2D Echo cardiac evaluations.', durationSec: 600 },
        { name: 'Vaccination & Immunization Desk', code: 'APL-VAX', description: 'Adult, pediatric and travel immunizations with certificate issuance.', durationSec: 360 },
        { name: 'Dental Care & Consultation', code: 'APL-DENT', description: 'Comprehensive dental hygiene, tooth extraction and root canal queue.', durationSec: 1200 },
      ],
    },
    {
      id: 'tenant-spandan-diagnostics',
      name: 'Spandan Diagnostic Center',
      legalName: 'Spandan Diagnostic Centre Pvt Ltd',
      slug: 'spandan-diagnostics',
      type: TenantType.DIAGNOSTIC_CENTER,
      status: TenantStatus.ACTIVE,
      branches: [
        {
          name: 'Baguiati Joramandir Center',
          code: 'SPN-BAG-01',
          address: {
            street: 'DE-3, VIP Road, Joramandir, Deshbandhu Nagar',
            locality: 'Baguiati',
            city: 'Kolkata',
            district: 'North 24 Parganas',
            state: 'West Bengal',
            postalCode: '700059',
            latitude: 22.6158,
            longitude: 88.4288,
          },
          phone: '+91 33 2570 3344',
          waitMinutes: 16,
          activeCounters: 5,
        },
      ],
      services: [
        { name: 'Pathology & Routine Blood Tests', code: 'SPN-PATH', description: 'CBC, lipid profile, liver function and HbA1c automated lab diagnostics.', durationSec: 360 },
        { name: 'Digital Diagnostic Imaging', code: 'SPN-IMG', description: 'Digital X-ray and computed fluoroscopy imaging scans.', durationSec: 480 },
        { name: 'Ultrasound & Color Doppler', code: 'SPN-USG', description: 'Whole abdomen, obstetric and peripheral arterial/venous Doppler.', durationSec: 720 },
        { name: 'CT Scan & MRI Investigations', code: 'SPN-CTMRI', description: 'High-resolution multi-slice CT scans and MRI neuro/body imaging.', durationSec: 1200 },
        { name: 'ECG & Echocardiography (Echo)', code: 'SPN-ECHO', description: 'Computerized ECG recording and pediatric/adult echocardiograms.', durationSec: 600 },
        { name: 'Specialist Diagnostic Health Checkups', code: 'SPN-CHK', description: 'Master health check, cardiac wellness and diabetic screening packages.', durationSec: 900 },
      ],
    },
    {
      id: 'tenant-theism-diagnostics',
      name: 'Theism Diagnostics',
      legalName: 'Theism Diagnostics — Baguiati Joramandir',
      slug: 'theism-diagnostics',
      type: TenantType.DIAGNOSTIC_CENTER,
      status: TenantStatus.ACTIVE,
      branches: [
        {
          name: 'Baguiati Joramandir Branch',
          code: 'THM-BAG-01',
          address: {
            street: 'A7/1, Rajarhat Main Road, Jyangra',
            locality: 'Baguiati',
            city: 'Kolkata',
            district: 'North 24 Parganas',
            state: 'West Bengal',
            postalCode: '700059',
            latitude: 22.6162,
            longitude: 88.4310,
          },
          phone: '+91 33 2570 9911',
          waitMinutes: 14,
          activeCounters: 3,
        },
      ],
      services: [
        { name: 'Laboratory Tests & Blood Collection', code: 'THM-LAB', description: 'Automated clinical biochemistry, hematology, immunology and urine profile.', durationSec: 360 },
        { name: 'Medical Imaging & Radiography', code: 'THM-IMG', description: 'Digital radiography, high-resolution chest and abdominal imaging.', durationSec: 480 },
        { name: 'Specialist Diagnostic Investigations', code: 'THM-SPEC', description: 'Thyroid profile, cancer markers, vitamin screening and hormone analysis.', durationSec: 600 },
        { name: 'Preventive Health Packages', code: 'THM-PREV', description: 'Executive wellness checks, full body diagnostic packages with review.', durationSec: 900 },
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
