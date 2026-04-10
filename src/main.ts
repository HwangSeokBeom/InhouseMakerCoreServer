import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const configService = app.get(ConfigService);
  const prismaService = app.get(PrismaService);

  app.use(helmet());
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const allowSwagger = configService.get<boolean>('ALLOW_SWAGGER');
  if (allowSwagger) {
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
  await app.listen(port);

  Logger.log(`Server listening on port ${port}`, 'Bootstrap');
}

bootstrap();
