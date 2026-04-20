import { existsSync } from 'node:fs';

import { defineConfig } from 'prisma/config';

import { resolveEnvFilePath } from './src/config/runtime-env';

const envFilePath = resolveEnvFilePath();

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
