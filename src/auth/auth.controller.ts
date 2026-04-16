import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiGoneResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PublicThrottle } from '../common/decorators/public-throttle.decorator';
import { PublicThrottleGuard } from '../common/guards/public-throttle.guard';
import { AuthenticatedUser } from '../common/interfaces/authenticated-request.interface';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import {
  AppleLoginDto,
  EmailLoginDto,
  EmailSignupDto,
  AuthTokensResponseDto,
  DisabledAuthResponseDto,
  GoogleLoginDto,
  LogoutResponseDto,
  RefreshTokenDto,
} from './dto/auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('email/status')
  @HttpCode(HttpStatus.GONE)
  @ApiOperation({ summary: 'Deprecated email auth status endpoint.', deprecated: true })
  @ApiGoneResponse({ type: DisabledAuthResponseDto })
  emailStatus(@Body() _body: unknown): Promise<never> {
    return this.authService.rejectEmailAuthDisabled();
  }

  @Post('email/verification/request')
  @HttpCode(HttpStatus.GONE)
  @ApiOperation({ summary: 'Deprecated email verification request endpoint.', deprecated: true })
  @ApiGoneResponse({ type: DisabledAuthResponseDto })
  verificationRequest(@Body() _body: unknown): Promise<never> {
    return this.authService.rejectEmailAuthDisabled();
  }

  @Post('email/send-verification')
  @HttpCode(HttpStatus.GONE)
  @ApiOperation({ summary: 'Legacy deprecated email verification request alias.', deprecated: true })
  @ApiGoneResponse({ type: DisabledAuthResponseDto })
  verificationRequestLegacy(@Body() _body: unknown): Promise<never> {
    return this.authService.rejectEmailAuthDisabled();
  }

  @Post('email/verification/confirm')
  @HttpCode(HttpStatus.GONE)
  @ApiOperation({ summary: 'Deprecated email verification confirm endpoint.', deprecated: true })
  @ApiGoneResponse({ type: DisabledAuthResponseDto })
  verificationConfirm(@Body() _body: unknown): Promise<never> {
    return this.authService.rejectEmailAuthDisabled();
  }

  @Post('email/verify-code')
  @HttpCode(HttpStatus.GONE)
  @ApiOperation({ summary: 'Legacy deprecated email verification confirm alias.', deprecated: true })
  @ApiGoneResponse({ type: DisabledAuthResponseDto })
  verificationConfirmLegacy(@Body() _body: unknown): Promise<never> {
    return this.authService.rejectEmailAuthDisabled();
  }

  @Post('signup/email')
  @UseGuards(PublicThrottleGuard)
  @PublicThrottle({ scope: 'auth-signup-email', limit: 10, windowSeconds: 60 })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create an email account and return auth tokens.' })
  @ApiOkResponse({ type: AuthTokensResponseDto })
  signupEmail(@Body() dto: EmailSignupDto): Promise<AuthTokensResponseDto> {
    return this.authService.signupWithEmail(dto);
  }

  @Post('signup')
  @HttpCode(HttpStatus.GONE)
  @ApiOperation({ summary: 'Deprecated signup endpoint.', deprecated: true })
  @ApiGoneResponse({ type: DisabledAuthResponseDto })
  signup(@Body() _body: unknown): Promise<never> {
    return this.authService.rejectEmailAuthDisabled();
  }

  @Post('login/email')
  @UseGuards(PublicThrottleGuard)
  @PublicThrottle({ scope: 'auth-login-email', limit: 10, windowSeconds: 60 })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password.' })
  @ApiOkResponse({ type: AuthTokensResponseDto })
  loginEmail(@Body() dto: EmailLoginDto): Promise<AuthTokensResponseDto> {
    return this.authService.loginWithEmail(dto);
  }

  @Post('login/apple')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with Apple identity token.' })
  @ApiOkResponse({ type: AuthTokensResponseDto })
  loginApple(@Body() dto: AppleLoginDto): Promise<AuthTokensResponseDto> {
    return this.authService.loginWithApple(dto);
  }

  @Post('login/google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with Google identity token.' })
  @ApiOkResponse({ type: AuthTokensResponseDto })
  loginGoogle(@Body() dto: GoogleLoginDto): Promise<AuthTokensResponseDto> {
    return this.authService.loginWithGoogle(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access and refresh tokens.' })
  @ApiOkResponse({ type: AuthTokensResponseDto })
  refresh(@Body() dto: RefreshTokenDto): Promise<AuthTokensResponseDto> {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout the current user by invalidating the refresh token.' })
  @ApiOkResponse({ type: LogoutResponseDto })
  async logout(@CurrentUser() user: AuthenticatedUser): Promise<LogoutResponseDto> {
    await this.authService.logout(user.userId);
    return { success: true };
  }
}
