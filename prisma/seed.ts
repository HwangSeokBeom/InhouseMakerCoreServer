import { PrismaClient } from '@prisma/client';

import { seedDevelopmentFixtures } from './dev-fixtures';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  await seedDevelopmentFixtures(prisma);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
