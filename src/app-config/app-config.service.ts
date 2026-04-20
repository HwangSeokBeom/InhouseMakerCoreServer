import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PublicAppConfigResponseDto } from './dto/app-config.dto';

@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService) {}

  getPublicConfig(): PublicAppConfigResponseDto {
    return {
      privacyPolicyUrl: this.configService.get<string>('PRIVACY_POLICY_URL') ?? null,
      termsOfServiceUrl: this.configService.get<string>('TERMS_OF_SERVICE_URL') ?? null,
      supportEmail: this.configService.get<string>('SUPPORT_EMAIL') ?? null,
      appMinimumVersion: this.configService.get<string>('APP_MINIMUM_VERSION') ?? null,
    };
  }
}
