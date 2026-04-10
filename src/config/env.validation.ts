import * as Joi from 'joi';

export interface AppConfig {
  PORT: number;
  NODE_ENV: string;
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
  ALLOW_SWAGGER: boolean;
}

export const envValidationSchema = Joi.object<AppConfig>({
  PORT: Joi.number().default(3000),
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
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
  ALLOW_SWAGGER: Joi.boolean().truthy('true').truthy('1').falsy('false').falsy('0').default(true),
});

