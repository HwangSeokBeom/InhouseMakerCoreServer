import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { AuthService } from './auth.service';
import {
  AppleLoginDto,
  AuthTokensResponseDto,
  RefreshTokenDto,
  SignupDto,
} from './dto/signup.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  @ApiOperation({ summary: 'Create a local app account and issue tokens.' })
  @ApiCreatedResponse({ type: AuthTokensResponseDto })
  signup(@Body() dto: SignupDto): Promise<AuthTokensResponseDto> {
    return this.authService.signup(dto);
  }

  @Post('login/apple')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with Apple identity token.' })
  @ApiOkResponse({ type: AuthTokensResponseDto })
  loginApple(@Body() dto: AppleLoginDto): Promise<AuthTokensResponseDto> {
    return this.authService.loginWithApple(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access and refresh tokens.' })
  @ApiOkResponse({ type: AuthTokensResponseDto })
  refresh(@Body() dto: RefreshTokenDto): Promise<AuthTokensResponseDto> {
    return this.authService.refresh(dto.refreshToken);
  }
}

