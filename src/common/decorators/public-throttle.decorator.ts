import { SetMetadata } from '@nestjs/common';

export interface PublicThrottleOptions {
  scope: string;
  limit: number;
  windowSeconds: number;
}

export const PUBLIC_THROTTLE_METADATA_KEY = 'publicThrottleOptions';

export const PublicThrottle = (options: PublicThrottleOptions) =>
  SetMetadata(PUBLIC_THROTTLE_METADATA_KEY, options);
