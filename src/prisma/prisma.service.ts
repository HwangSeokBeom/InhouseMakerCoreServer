import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { INestApplication, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { serializeLogPayload } from '../common/request-debug.util';
import { resolveNodeEnv } from '../config/runtime-env';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly migrationLogger = new Logger('PrismaMigrationDebug');

  async onModuleInit(): Promise<void> {
    await this.$connect();
    await this.logPendingMigrationStatus();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async enableShutdownHooks(app: INestApplication): Promise<void> {
    process.on('beforeExit', async () => {
      await app.close();
    });
  }

  private async logPendingMigrationStatus(): Promise<void> {
    if (resolveNodeEnv(process.env.NODE_ENV) === 'production') {
      return;
    }

    const localMigrations = await this.readLocalMigrationNames();
    if (localMigrations.length === 0) {
      return;
    }

    try {
      const rows = await this.$queryRaw<
        Array<{
          migration_name: string;
          finished_at: Date | null;
          rolled_back_at: Date | null;
        }>
      >`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name ASC`;
      const appliedMigrations = new Set(
        rows
          .filter((row) => row.finished_at !== null && row.rolled_back_at === null)
          .map((row) => row.migration_name),
      );
      const pendingMigrations = localMigrations.filter((name) => !appliedMigrations.has(name));
      const failedMigrations = rows
        .filter((row) => row.finished_at === null && row.rolled_back_at === null)
        .map((row) => row.migration_name);

      if (pendingMigrations.length === 0 && failedMigrations.length === 0) {
        return;
      }

      this.migrationLogger.warn(
        serializeLogPayload({
          event: 'startupMigrationCheck',
          pendingMigrations,
          failedMigrations,
          hint: 'Run `npx prisma migrate status` and apply pending migrations before relying on local API responses.',
        }),
      );
    } catch (error) {
      this.migrationLogger.warn(
        serializeLogPayload({
          event: 'startupMigrationCheckSkipped',
          reason: 'unable_to_read_prisma_migration_state',
          error: error instanceof Error ? error.message : String(error),
          hint: 'Run `npx prisma migrate status` manually if schema mismatch is suspected.',
        }),
      );
    }
  }

  private async readLocalMigrationNames(): Promise<string[]> {
    const migrationsDir = path.resolve(process.cwd(), 'prisma', 'migrations');

    try {
      const entries = await readdir(migrationsDir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));
    } catch (error) {
      this.logger.warn(
        serializeLogPayload({
          event: 'startupMigrationCheckSkipped',
          reason: 'unable_to_read_local_migration_files',
          error: error instanceof Error ? error.message : String(error),
          migrationsDir,
        }),
      );
      return [];
    }
  }
}
