import { AppConfigService } from '../src/app-config/app-config.service';

describe('AppConfigService', () => {
  it('exposes supported auth providers alongside public config', () => {
    const configService = {
      get: jest.fn((key: string) => {
        const config = {
          PRIVACY_POLICY_URL: 'https://example.com/privacy',
          TERMS_OF_SERVICE_URL: 'https://example.com/terms',
          SUPPORT_EMAIL: 'support@example.com',
          APP_MINIMUM_VERSION: '1.2.3',
        } satisfies Record<string, string>;
        return config[key as keyof typeof config];
      }),
    };

    const service = new AppConfigService(configService as any);

    expect(service.getPublicConfig()).toEqual({
      privacyPolicyUrl: 'https://example.com/privacy',
      termsOfServiceUrl: 'https://example.com/terms',
      supportEmail: 'support@example.com',
      appMinimumVersion: '1.2.3',
      supportedAuthProviders: ['email', 'apple', 'google'],
    });
  });
});
