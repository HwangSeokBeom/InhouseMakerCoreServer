import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { PublicThrottleGuard } from '../common/guards/public-throttle.guard';
import { AppleIdentityTokenVerifierService } from './apple-identity-token-verifier.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleIdentityTokenVerifierService } from './google-identity-token-verifier.service';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [HttpModule, PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    PublicThrottleGuard,
    AppleIdentityTokenVerifierService,
    GoogleIdentityTokenVerifierService,
  ],
  exports: [
    AuthService,
    JwtStrategy,
    AppleIdentityTokenVerifierService,
    GoogleIdentityTokenVerifierService,
    PassportModule,
    JwtModule,
  ],
})
export class AuthModule {}
