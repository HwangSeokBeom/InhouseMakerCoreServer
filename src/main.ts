import {
  BadRequestException,
  INestApplication,
  Logger,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import express from 'express';
import helmet from 'helmet';
import path from 'node:path';

import { AppModule } from './app.module';
import { AppErrorCode } from './common/app.exception';
import { serializeLogPayload, serializeUnknown } from './common/request-debug.util';
import { PrismaService } from './prisma/prisma.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  registerProcessDebugHandlers(app);

  const configService = app.get(ConfigService);
  const prismaService = app.get(PrismaService);

  app.use(helmet());
  const uploadDir = configService.get<string>('UPLOAD_DIR', 'uploads');
  const uploadRoot = path.isAbsolute(uploadDir)
    ? uploadDir
    : path.resolve(process.cwd(), uploadDir);
  app.use('/uploads', express.static(uploadRoot, { immutable: true, maxAge: '7d' }));
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      exceptionFactory: (errors: ValidationError[]) =>
        new BadRequestException({
          success: false,
          code: AppErrorCode.VALIDATION_ERROR,
          message: 'Payload is invalid.',
          details: {
            validationErrors: errors.flatMap((error) =>
              Object.values(error.constraints ?? {}).map((constraint) => ({
                field: error.property,
                message: constraint,
              })),
            ),
          },
        }),
    }),
  );

  const allowSwagger = configService.get<boolean>('ALLOW_SWAGGER');
  if (allowSwagger) {
    const { DocumentBuilder, SwaggerModule } = await import('@nestjs/swagger');
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Inhouse Maker Core Server')
      .setDescription('LoL 5v5 inhouse balancing platform backend MVP')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  await prismaService.enableShutdownHooks(app);

  const port = configService.get<number>('PORT', 3000);
  const bindHost = configService.get<string>('BIND_HOST', '127.0.0.1');
  await app.listen(port, bindHost);

  Logger.log('[TestDataCleanup] feature=test_member_injection removed=true', 'TestDataCleanup');
  Logger.log(`Server listening on ${bindHost}:${port}`, 'Bootstrap');
}

function registerProcessDebugHandlers(app: INestApplication): void {
  const logger = new Logger('ProcessDebug');
  let shuttingDown = false;

  const closeForSignal = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      logger.warn(
        serializeLogPayload({
          event: signal,
          received: true,
          shuttingDown,
          duplicate: true,
        }),
      );
      return;
    }

    shuttingDown = true;
    logger.warn(
      serializeLogPayload({
        event: signal,
        received: true,
        shuttingDown,
      }),
    );

    try {
      await app.close();
      logger.warn(
        serializeLogPayload({
          event: signal,
          appClosed: true,
          shuttingDown,
        }),
      );
    } catch (error) {
      logger.error(
        serializeLogPayload({
          event: signal,
          appClosed: false,
          shuttingDown,
          error: serializeUnknown(error),
        }),
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      process.exit(signal === 'SIGINT' ? 130 : 143);
    }
  };

  process.once('SIGTERM', () => {
    void closeForSignal('SIGTERM');
  });
  process.once('SIGINT', () => {
    void closeForSignal('SIGINT');
  });
  process.on('unhandledRejection', (reason: unknown) => {
    logger.error(
      serializeLogPayload({
        event: 'unhandledRejection',
        reason: serializeUnknown(reason),
      }),
    );

    setImmediate(() => {
      throw reason instanceof Error
        ? reason
        : new Error(`Unhandled rejection: ${serializeUnknown(reason)}`);
    });
  });
  process.on('uncaughtExceptionMonitor', (error: Error, origin: string) => {
    logger.error(
      serializeLogPayload({
        event: 'uncaughtException',
        message: error.message,
        origin,
      }),
      error.stack,
    );
  });
}

bootstrap().catch((error: unknown) => {
  Logger.error(
    serializeLogPayload({
      event: 'bootstrapFailure',
      error: serializeUnknown(error),
    }),
    error instanceof Error ? error.stack : undefined,
    'ProcessDebug',
  );
  process.exit(1);
});
