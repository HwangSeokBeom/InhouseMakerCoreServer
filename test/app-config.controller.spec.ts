import 'reflect-metadata';

import { INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';

import { AppConfigController } from '../src/app-config/app-config.controller';
import { AppConfigService } from '../src/app-config/app-config.service';

describe('AppConfigController HTTP contract', () => {
  let app: INestApplication;

  const appConfigService = {
    getPublicConfig: jest.fn(() => ({
      privacyPolicyUrl: 'https://example.com/privacy',
      termsOfServiceUrl: 'https://example.com/terms',
      supportEmail: 'support@example.com',
      appMinimumVersion: '1.2.3',
      supportedAuthProviders: ['email', 'apple', 'google'],
    })),
  };

  beforeAll(async () => {
    @Module({
      controllers: [AppConfigController],
      providers: [
        {
          provide: AppConfigService,
          useValue: appConfigService,
        },
      ],
    })
    class AppConfigControllerTestModule {}

    app = await NestFactory.create(AppConfigControllerTestModule, { logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns supportedAuthProviders for client feature availability checks', async () => {
    const response = await request(app.getHttpServer()).get('/app-config/public');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      supportedAuthProviders: ['email', 'apple', 'google'],
    });
    expect(appConfigService.getPublicConfig).toHaveBeenCalledTimes(1);
  });
});
