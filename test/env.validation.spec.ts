import { envValidationSchema } from '../src/config/env.validation';

describe('envValidationSchema', () => {
  const baseEnv = {
    PORT: 3000,
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://localhost:5432/inhousemaker',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: 'access-secret',
    JWT_REFRESH_SECRET: 'refresh-secret',
    JWT_ACCESS_EXPIRES_IN: '1h',
    JWT_REFRESH_EXPIRES_IN: '30d',
    RIOT_APP_ID: 'riot-app-id',
    RIOT_API_KEY: 'riot-api-key',
    RIOT_ACCOUNT_REGION: 'asia',
    RIOT_PLATFORM_REGION: 'kr',
    RIOT_SYNC_MAX_RETRIES: 5,
    RIOT_SYNC_BACKOFF_MS: 2000,
    RIOT_INITIAL_SYNC_MATCH_COUNT: 25,
    RIOT_MATCH_HISTORY_PAGE_SIZE: 100,
    RIOT_MATCH_HISTORY_EXTRA_PAGES_PER_SYNC: 1,
    RIOT_MATCH_DETAIL_BATCH_SIZE: 5,
    RIOT_SYNC_STALE_MS: 900000,
    APPLE_CLIENT_ID: 'apple-client-id',
    GOOGLE_CLIENT_ID: 'google-client-id',
    ALLOW_SWAGGER: false,
  };

  it('fails validation when GOOGLE_CLIENT_ID is missing', () => {
    const { error } = envValidationSchema.validate(
      { ...baseEnv, GOOGLE_CLIENT_ID: undefined },
      { abortEarly: false },
    );

    expect(error).toBeDefined();
    expect(error?.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ['GOOGLE_CLIENT_ID'],
          message: '"GOOGLE_CLIENT_ID" is required',
        }),
      ]),
    );
  });
});
