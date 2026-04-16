import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AuthProvider, UserStatus } from '@prisma/client';
import { IsBoolean, IsString } from 'class-validator';

export enum AuthProviderResponse {
  EMAIL = 'email',
  APPLE = 'apple',
  GOOGLE = 'google',
}

export const SUPPORTED_AUTH_PROVIDERS = [
  AuthProvider.EMAIL,
  AuthProvider.APPLE,
  AuthProvider.GOOGLE,
] as const;

export const toAuthProviderResponse = (
  provider?: AuthProvider | null,
): AuthProviderResponse | null => {
  if (!provider) {
    return null;
  }

  if (provider === AuthProvider.EMAIL) {
    return AuthProviderResponse.EMAIL;
  }
  if (provider === AuthProvider.APPLE) {
    return AuthProviderResponse.APPLE;
  }
  return AuthProviderResponse.GOOGLE;
};

export const normalizeAuthProviders = (
  providers: Iterable<AuthProvider>,
): AuthProvider[] => {
  const available = new Set<AuthProvider>(providers);
  return SUPPORTED_AUTH_PROVIDERS.filter((provider) => available.has(provider));
};

export class EmailSignupDto {
  @ApiProperty()
  @IsString()
  email!: string;

  @ApiProperty()
  @IsString()
  password!: string;

  @ApiProperty()
  @IsString()
  nickname!: string;

  @ApiProperty()
  @IsBoolean()
  agreedToTerms!: boolean;

  @ApiProperty()
  @IsBoolean()
  agreedToPrivacy!: boolean;

  @ApiProperty()
  @IsBoolean()
  agreedToMarketing!: boolean;
}

export class EmailLoginDto {
  @ApiProperty()
  @IsString()
  email!: string;

  @ApiProperty()
  @IsString()
  password!: string;
}

export class AppleLoginDto {
  @ApiProperty()
  @IsString()
  identityToken!: string;
}

export class GoogleLoginDto {
  @ApiProperty()
  @IsString()
  identityToken!: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  refreshToken!: string;
}

export class LogoutResponseDto {
  @ApiProperty()
  success!: true;
}

export class AuthUserResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  nickname!: string;

  @ApiProperty({ enum: AuthProviderResponse, nullable: true })
  provider!: AuthProviderResponse | null;

  @ApiProperty({ enum: UserStatus })
  status!: UserStatus;
}

export class AuthTokensResponseDto {
  @ApiProperty({ type: AuthUserResponseDto })
  user!: AuthUserResponseDto;

  @ApiProperty()
  accessToken!: string;

  @ApiProperty()
  refreshToken!: string;
}

export class DisabledAuthResponseDto {
  @ApiProperty()
  success!: false;

  @ApiProperty()
  code!: string;

  @ApiPropertyOptional()
  message?: string;

  @ApiPropertyOptional({ enum: AuthProviderResponse, nullable: true })
  provider!: AuthProviderResponse | null;
}
