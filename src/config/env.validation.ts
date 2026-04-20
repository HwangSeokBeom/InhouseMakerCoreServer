import * as Joi from 'joi';

export interface AppConfig {
  PORT: number;
  NODE_ENV: string;
  APP_ENV?: string;
  DATABASE_URL: string;
  REDIS_URL: string;
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
  JWT_ACCESS_EXPIRES_IN: string;
  JWT_REFRESH_EXPIRES_IN: string;
  RIOT_APP_ID: string;
  RIOT_API_KEY: string;
  RIOT_ACCOUNT_REGION: string;
  RIOT_PLATFORM_REGION: string;
  RIOT_SYNC_MAX_RETRIES: number;
  RIOT_SYNC_BACKOFF_MS: number;
  RIOT_INITIAL_SYNC_MATCH_COUNT: number;
  RIOT_MATCH_HISTORY_PAGE_SIZE: number;
  RIOT_MATCH_HISTORY_EXTRA_PAGES_PER_SYNC: number;
  RIOT_MATCH_DETAIL_BATCH_SIZE: number;
  RIOT_SYNC_STALE_MS: number;
  APPLE_CLIENT_ID?: string;
  APPLE_AUDIENCE?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_AUDIENCE?: string;
  ALLOW_SWAGGER: boolean;
}

export const envValidationSchema = Joi.object<AppConfig>({
  PORT: Joi.number().default(3000),
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  APP_ENV: Joi.string()
    .valid('local', 'development', 'test', 'staging', 'production')
    .optional(),
  DATABASE_URL: Joi.string().uri({ scheme: ['postgresql', 'postgres'] }).required(),
  REDIS_URL: Joi.string().uri({ scheme: ['redis', 'rediss'] }).required(),
  JWT_ACCESS_SECRET: Joi.string().min(8).required(),
  JWT_REFRESH_SECRET: Joi.string().min(8).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().required(),
  RIOT_APP_ID: Joi.string().required(),
  RIOT_API_KEY: Joi.string().required(),
  RIOT_ACCOUNT_REGION: Joi.string().required(),
  RIOT_PLATFORM_REGION: Joi.string().required(),
  RIOT_SYNC_MAX_RETRIES: Joi.number().integer().min(1).default(5),
  RIOT_SYNC_BACKOFF_MS: Joi.number().integer().min(100).default(2000),
  RIOT_INITIAL_SYNC_MATCH_COUNT: Joi.number().integer().min(10).max(50).default(25),
  RIOT_MATCH_HISTORY_PAGE_SIZE: Joi.number().integer().min(20).max(100).default(100),
  RIOT_MATCH_HISTORY_EXTRA_PAGES_PER_SYNC: Joi.number().integer().min(0).max(5).default(1),
  RIOT_MATCH_DETAIL_BATCH_SIZE: Joi.number().integer().min(1).max(20).default(5),
  RIOT_SYNC_STALE_MS: Joi.number().integer().min(60_000).default(900_000),
  APPLE_CLIENT_ID: Joi.string().optional(),
  APPLE_AUDIENCE: Joi.string().optional(),
  GOOGLE_CLIENT_ID: Joi.string().optional(),
  GOOGLE_AUDIENCE: Joi.string().optional(),
  ALLOW_SWAGGER: Joi.boolean().truthy('true').truthy('1').falsy('false').falsy('0').default(true),
});
