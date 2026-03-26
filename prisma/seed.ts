import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

const defaultStages = [
  { name: 'Application Review', order: 1, isCustom: false, color: 'bg-zinc-400', isEnabled: true },
  { name: 'Screening', order: 2, isCustom: false, color: 'bg-blue-500', isEnabled: true },
  { name: 'Interview', order: 3, isCustom: false, color: 'bg-indigo-400', isEnabled: true },
  { name: 'Offer', order: 4, isCustom: false, color: 'bg-emerald-500', isEnabled: true },
  { name: 'Hired', order: 5, isCustom: false, color: 'bg-green-600', isEnabled: false },
  { name: 'Rejected', order: 6, isCustom: false, color: 'bg-red-500', isEnabled: false },
  { name: 'Pending Decision', order: 7, isCustom: false, color: 'bg-yellow-400', isEnabled: false },
  { name: 'On Hold', order: 8, isCustom: false, color: 'bg-gray-500', isEnabled: false },
];

async function seedJobStages(jobId: string) {
  const existingStagesCount = await prisma.jobStage.count({ where: { jobId } });

  // Create stages only if they don't exist yet for this job
  if (existingStagesCount === 0) {
    await prisma.jobStage.createMany({
      data: defaultStages.map((stage) => ({
        ...stage,
        jobId,
        tenantId: TENANT_ID,
      })),
    });
    console.log(`Seeded default hiring stages for job: ${jobId}`);
  }
}

async function main() {
  // Upsert the single dev tenant
  const tenant = await prisma.tenant.upsert({
    where: { id: TENANT_ID },
    update: {},
    create: {
      id: TENANT_ID,
      name: 'Triolla',
    },
  });
  console.log('Upserted tenant:', tenant.id);

  // Seed jobs first
  const job1Id = '00000000-0000-0000-0000-000000001001';
  const job1 = await prisma.job.upsert({
    where: { id: job1Id },
    update: {},
    create: {
      id: job1Id,
      tenantId: TENANT_ID,
      title: 'Senior Software Engineer',
      department: 'Engineering',
      status: 'open',
    },
  });
  console.log('Upserted job:', job1.id);
  await seedJobStages(job1.id);

  // Seed candidate 1
  const candidate1 = await prisma.candidate.upsert({
    where: { id: '00000000-0000-0000-0000-000000000101' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000101',
      tenantId: TENANT_ID,
      jobId: job1.id,
      fullName: 'Yael Cohen',
      email: 'yael.cohen@example.com',
      phone: '+972-50-111-2222',
      currentRole: 'Senior Software Engineer',
      location: 'Tel Aviv, Israel',
      yearsExperience: 7,
      skills: ['TypeScript', 'Node.js', 'React', 'PostgreSQL', 'Docker'],
      source: 'direct',
      aiSummary:
        'Senior fullstack engineer with 7 years experience. Strong TypeScript and React skills with production PostgreSQL experience.',
    },
  });
  console.log('Upserted candidate:', candidate1.id);

  // Seed job for candidate 2
  const job2Id = '00000000-0000-0000-0000-000000001002';
  const job2 = await prisma.job.upsert({
    where: { id: job2Id },
    update: {},
    create: {
      id: job2Id,
      tenantId: TENANT_ID,
      title: 'Product Manager',
      department: 'Product',
      status: 'open',
    },
  });
  console.log('Upserted job:', job2.id);
  await seedJobStages(job2.id); // <--- יצירת השלבים למשרה 2

  // Seed candidate 2
  const candidate2 = await prisma.candidate.upsert({
    where: { id: '00000000-0000-0000-0000-000000000102' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000102',
      tenantId: TENANT_ID,
      jobId: job2.id,
      fullName: 'Noam Levy',
      email: 'noam.levy@example.com',
      phone: '+972-52-333-4444',
      currentRole: 'Product Manager',
      location: 'Haifa, Israel',
      yearsExperience: 2,
      skills: ['Product Strategy', 'Roadmapping', 'SQL', 'Figma'],
      source: 'direct',
      aiSummary:
        'Junior PM with 2 years in B2B SaaS. Experience with roadmap planning and cross-functional stakeholder management.',
    },
  });
  console.log('Upserted candidate:', candidate2.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
