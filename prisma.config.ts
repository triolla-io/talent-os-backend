import { defineConfig } from 'prisma/config';

export default defineConfig({
  migrations: {
    // In production, we assume the seed file is compiled to dist (if needed)
    seed: process.env.NODE_ENV === 'production' 
      ? 'node dist/prisma/seed.js' 
      : 'ts-node prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL!,
  },
});
