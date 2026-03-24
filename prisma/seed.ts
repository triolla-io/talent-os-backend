import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Upsert the single dev tenant (hardcoded ID per D-04)
  const tenant = await prisma.tenant.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Triolla',
    },
  });
  console.log('Upserted tenant:', tenant.id);

  // Seed candidate 1 — senior software engineer
  const candidate1 = await prisma.candidate.upsert({
    where: { id: '00000000-0000-0000-0000-000000000101' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000101',
      tenantId: '00000000-0000-0000-0000-000000000001',
      fullName: 'Yael Cohen',
      email: 'yael.cohen@example.com',
      phone: '+972-50-111-2222',
      currentRole: 'Senior Software Engineer',
      location: 'Tel Aviv, Israel',
      yearsExperience: 7,
      skills: ['TypeScript', 'Node.js', 'React', 'PostgreSQL', 'Docker'],
      source: 'direct',
      aiSummary: 'Senior fullstack engineer with 7 years experience. Strong TypeScript and React skills with production PostgreSQL experience.',
    },
  });
  console.log('Upserted candidate:', candidate1.id);

  // Seed candidate 2 — junior product manager
  const candidate2 = await prisma.candidate.upsert({
    where: { id: '00000000-0000-0000-0000-000000000102' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000102',
      tenantId: '00000000-0000-0000-0000-000000000001',
      fullName: 'Noam Levy',
      email: 'noam.levy@example.com',
      phone: '+972-52-333-4444',
      currentRole: 'Product Manager',
      location: 'Haifa, Israel',
      yearsExperience: 2,
      skills: ['Product Strategy', 'Roadmapping', 'SQL', 'Figma'],
      source: 'direct',
      aiSummary: 'Junior PM with 2 years in B2B SaaS. Experience with roadmap planning and cross-functional stakeholder management.',
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
