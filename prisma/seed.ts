import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

// ─── Fixed UUIDs for deterministic, idempotent seeding ──────────────────────

// Jobs
const JOB_SE = '00000000-0000-0000-0000-000000001001'; // Senior Software Engineer — open
const JOB_PM = '00000000-0000-0000-0000-000000001002'; // Product Manager — open
const JOB_DS = '00000000-0000-0000-0000-000000001003'; // Data Scientist — open

// Candidate
const C_YAEL = '00000000-0000-0000-0000-000000000101';

// Application
const APP_YAEL = '20000000-0000-0000-0000-000000000001';

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Seeding database...\n');

  // ── 1. Tenant ─────────────────────────────────────────────────────────
  await prisma.tenant.upsert({
    where: { id: TENANT_ID },
    update: {},
    create: { id: TENANT_ID, name: 'Triolla' },
  });
  console.log('✓ Tenant');

  // ── 2. Jobs ───────────────────────────────────────────────────────────
  const jobs = [
    {
      id: JOB_SE,
      title: 'Senior Software Engineer',
      department: 'Engineering',
      location: 'Tel Aviv, Israel',
      jobType: 'full_time',
      status: 'open',
      description:
        'We are looking for a Senior Software Engineer to join our core platform team and help build the next generation of our product. You will work on scalable backend systems, design APIs, and mentor junior developers.',
      requirements: ['5+ years backend experience', 'PostgreSQL', 'TypeScript'],
      salaryRange: '150,000 - 200,000 ILS/month',
      hiringManager: 'Jane Smith',
      roleSummary: 'Lead engineer for platform infrastructure and backend systems.',
      responsibilities:
        'Design and implement backend services, conduct code reviews, mentor team members, collaborate with product and design teams.',
      whatWeOffer:
        'Competitive salary, health insurance, remote flexibility, professional development budget, stock options.',
      mustHaveSkills: ['TypeScript', 'Node.js', 'PostgreSQL'],
      niceToHaveSkills: ['Docker', 'Kubernetes', 'AWS'],
      expYearsMin: 5,
      expYearsMax: 10,
      preferredOrgTypes: ['Agency', 'Startup', 'Corporate / Enterprise'],
    },
    {
      id: JOB_PM,
      title: 'Product Manager',
      department: 'Product',
      location: 'Tel Aviv, Israel',
      jobType: 'full_time',
      status: 'open',
      description:
        'Join our Product team to define roadmap, work with engineering, and drive user engagement across our B2B SaaS platform. You will own the hiring experience and work closely with our core team.',
      requirements: ['3+ years PM experience', 'B2B SaaS', 'User research'],
      salaryRange: '120,000 - 160,000 ILS/month',
      hiringManager: 'Admin Cohen',
      roleSummary: 'Drive product strategy and roadmap for recruiting platform.',
      responsibilities:
        'Define product vision and roadmap, conduct user interviews, prioritize features, work with engineering and design, analyze metrics.',
      whatWeOffer: 'Competitive salary, health insurance, equity, professional development, flexible hours.',
      mustHaveSkills: ['Product Strategy', 'SQL', 'User Research'],
      niceToHaveSkills: ['Figma', 'Data Analysis'],
      expYearsMin: 3,
      expYearsMax: 7,
      preferredOrgTypes: ['Startup', 'Corporate / Enterprise'],
    },
    {
      id: JOB_DS,
      title: 'Data Scientist',
      department: 'Engineering',
      location: 'Haifa, Israel',
      jobType: 'full_time',
      status: 'open',
      description:
        'Build ML models and data pipelines to power our AI-driven candidate matching and scoring features. Work with our platform team to integrate models into production systems.',
      requirements: ['2+ years ML experience', 'Python', 'Machine learning models'],
      salaryRange: '130,000 - 180,000 ILS/month',
      hiringManager: 'Jane Smith',
      roleSummary: 'Build ML models for intelligent candidate-job matching.',
      responsibilities:
        'Develop ML models for scoring and matching, design data pipelines, evaluate model performance, experiment with new approaches, document findings.',
      whatWeOffer:
        'Competitive salary, health insurance, remote flexibility, GPU access for experiments, research time.',
      mustHaveSkills: ['Python', 'Machine Learning', 'SQL'],
      niceToHaveSkills: ['PyTorch', 'Spark', 'dbt'],
      expYearsMin: 2,
      expYearsMax: 6,
      preferredOrgTypes: ['Corporate / Enterprise', 'Non-profit'],
    },
  ];

  for (const j of jobs) {
    await prisma.job.upsert({
      where: { id: j.id },
      update: {},
      create: {
        id: j.id,
        tenantId: TENANT_ID,
        title: j.title,
        department: j.department,
        location: j.location,
        jobType: j.jobType,
        status: j.status,
        description: j.description,
        requirements: j.requirements,
        salaryRange: j.salaryRange,
        hiringManager: j.hiringManager,
        roleSummary: j.roleSummary,
        responsibilities: j.responsibilities,
        whatWeOffer: j.whatWeOffer,
        mustHaveSkills: j.mustHaveSkills,
        niceToHaveSkills: j.niceToHaveSkills,
        expYearsMin: j.expYearsMin,
        expYearsMax: j.expYearsMax,
        preferredOrgTypes: j.preferredOrgTypes,
      },
    });
  }
  console.log('✓ Jobs (3 open)');

  // ── 3. Candidate ──────────────────────────────────────────────────────
  await prisma.candidate.upsert({
    where: { id: C_YAEL },
    update: {},
    create: {
      id: C_YAEL,
      tenantId: TENANT_ID,
      jobId: JOB_SE,
      fullName: 'Yael Cohen',
      email: 'yael.cohen@example.com',
      phone: '+972-50-111-2222',
      currentRole: 'Senior Software Engineer',
      location: 'Tel Aviv, Israel',
      yearsExperience: 7,
      skills: ['TypeScript', 'Node.js', 'React', 'PostgreSQL', 'Docker'],
      source: 'direct',
      aiSummary:
        'Senior fullstack engineer with 7 years experience. Strong TypeScript and React skills with production PostgreSQL experience. Excellent fit for senior role.',
    },
  });
  console.log('✓ Candidate (1)');

  // ── 4. Application ────────────────────────────────────────────────────
  await prisma.application.upsert({
    where: { id: APP_YAEL },
    update: {},
    create: {
      id: APP_YAEL,
      tenantId: TENANT_ID,
      candidateId: C_YAEL,
      jobId: JOB_SE,
      stage: 'new',
      appliedAt: new Date(),
    },
  });
  console.log('✓ Application (1)');

  console.log('\n✅ Seed complete!');
  console.log('');
  console.log('Summary:');
  console.log('  Jobs:        3 open positions (SE, PM, DS)');
  console.log('  Candidate:   Yael Cohen (Senior Software Engineer)');
  console.log('  Application: Yael → Senior Software Engineer job');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
