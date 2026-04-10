import { existsSync } from 'node:fs';

import { defineConfig } from 'prisma/config';

const nodeEnv = process.env.NODE_ENV ?? 'development';
const envFilePath = `.env.${nodeEnv}`;

if (existsSync(envFilePath)) {
  process.loadEnvFile(envFilePath);
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node --project tsconfig.json prisma/seed.ts',
  },
});
