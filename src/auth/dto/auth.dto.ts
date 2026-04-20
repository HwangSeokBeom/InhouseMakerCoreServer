import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AuthProvider, UserStatus } from '@prisma/client';
import {
  IsBoolean,
  IsDefined,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

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
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @ApiProperty({ minLength: 2, maxLength: 24 })
  @IsString()
  @MinLength(2)
  @MaxLength(24)
  nickname!: string;

  @ApiProperty({ description: 'Required terms consent. Must be true for signup.' })
  @IsDefined({ message: 'agreedToTerms is required.' })
  @IsBoolean({ message: 'agreedToTerms must be a boolean value.' })
  agreedToTerms!: boolean;

  @ApiProperty({ description: 'Required privacy consent. Must be true for signup.' })
  @IsDefined({ message: 'agreedToPrivacy is required.' })
  @IsBoolean({ message: 'agreedToPrivacy must be a boolean value.' })
  agreedToPrivacy!: boolean;

  @ApiPropertyOptional({
    description: 'Optional marketing consent flag. Omit or set false when the user does not opt in.',
  })
  @IsOptional()
  @IsBoolean({ message: 'agreedToMarketing must be a boolean value.' })
  agreedToMarketing?: boolean;
}

export class EmailLoginDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  password!: string;
}

export class AppleLoginDto {
  @ApiProperty()
  @IsDefined({ message: 'identityToken is required.' })
  @IsString({ message: 'identityToken must be a string.' })
  @MinLength(1, { message: 'identityToken must not be empty.' })
  identityToken!: string;
}

export class GoogleLoginDto {
  @ApiProperty()
  @IsDefined({ message: 'identityToken is required.' })
  @IsString({ message: 'identityToken must be a string.' })
  @MinLength(1, { message: 'identityToken must not be empty.' })
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
