import { ApiPropertyOptional } from '@nestjs/swagger';

export class PublicAppConfigResponseDto {
  @ApiPropertyOptional({ nullable: true })
  privacyPolicyUrl!: string | null;

  @ApiPropertyOptional({ nullable: true })
  termsOfServiceUrl!: string | null;

  @ApiPropertyOptional({ nullable: true })
  supportEmail!: string | null;

  @ApiPropertyOptional({ nullable: true })
  appMinimumVersion!: string | null;
}
