import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { AuthProviderResponse } from '../../auth/dto/auth.dto';

export class PublicAppConfigResponseDto {
  @ApiPropertyOptional({ nullable: true })
  privacyPolicyUrl!: string | null;

  @ApiPropertyOptional({ nullable: true })
  termsOfServiceUrl!: string | null;

  @ApiPropertyOptional({ nullable: true })
  supportEmail!: string | null;

  @ApiPropertyOptional({ nullable: true })
  appMinimumVersion!: string | null;

  @ApiProperty({ enum: AuthProviderResponse, isArray: true })
  supportedAuthProviders!: AuthProviderResponse[];
}
