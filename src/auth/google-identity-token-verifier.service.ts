import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import jwt, {
  JsonWebTokenError,
  JwtHeader,
  JwtPayload,
  TokenExpiredError,
} from 'jsonwebtoken';
import { firstValueFrom } from 'rxjs';

interface GoogleCertsResponse {
  [kid: string]: string;
}

interface VerifiedGoogleIdentity {
  sub: string;
  email?: string;
  emailVerified: boolean;
}

@Injectable()
export class GoogleIdentityTokenVerifierService {
  private readonly issuers = ['accounts.google.com', 'https://accounts.google.com'] as const;
  private readonly defaultCacheTtlMs = 1000 * 60 * 60;
  private certCache = new Map<string, { cert: string; expiresAt: number }>();

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async verifyIdentityToken(identityToken: string): Promise<VerifiedGoogleIdentity> {
    const audience = this.configService.getOrThrow<string>('GOOGLE_CLIENT_ID');

    const decoded = jwt.decode(identityToken, { complete: true });
    if (!decoded || typeof decoded !== 'object' || !('header' in decoded)) {
      throw new BadRequestException('Google identity token is malformed.');
    }

    const header = decoded.header as JwtHeader;
    if (!header.kid) {
      throw new BadRequestException('Google identity token is missing key id.');
    }

    if (header.alg !== 'RS256') {
      throw new UnauthorizedException('Google identity token algorithm is invalid.');
    }

    const cert = await this.getGoogleCert(header.kid);

    try {
      const payload = jwt.verify(identityToken, cert, {
        algorithms: ['RS256'],
        issuer: [...this.issuers],
        audience,
      }) as JwtPayload;

      if (!payload.sub) {
        throw new BadRequestException('Google identity token subject is missing.');
      }

      return {
        sub: String(payload.sub),
        email: typeof payload.email === 'string' ? payload.email : undefined,
        emailVerified:
          typeof payload.email_verified === 'boolean'
            ? payload.email_verified
            : payload.email_verified === 'true',
      };
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        throw new UnauthorizedException('Google identity token expired.');
      }

      if (error instanceof JsonWebTokenError) {
        if (error.message.includes('jwt audience invalid')) {
          throw new UnauthorizedException('Google identity token audience is invalid.');
        }
        if (error.message.includes('jwt issuer invalid')) {
          throw new UnauthorizedException('Google identity token issuer is invalid.');
        }
        if (error.message.includes('invalid signature')) {
          throw new UnauthorizedException('Google identity token signature is invalid.');
        }

        throw new UnauthorizedException('Google identity token verification failed.');
      }

      throw error;
    }
  }

  private async getGoogleCert(kid: string): Promise<string> {
    const cached = this.certCache.get(kid);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.cert;
    }

    const response = await firstValueFrom(
      this.httpService.get<GoogleCertsResponse>('https://www.googleapis.com/oauth2/v1/certs', {
        timeout: 5000,
      }),
    ).catch(() => {
      throw new ServiceUnavailableException('Unable to fetch Google public certificates.');
    });

    const cacheControl = response.headers?.['cache-control'];
    const maxAgeMatch =
      typeof cacheControl === 'string' ? cacheControl.match(/max-age=(\d+)/) : null;
    const expiresAt =
      Date.now() +
      ((maxAgeMatch ? Number(maxAgeMatch[1]) : this.defaultCacheTtlMs / 1000) * 1000);

    for (const [responseKid, cert] of Object.entries(response.data ?? {})) {
      this.certCache.set(responseKid, { cert, expiresAt });
    }

    const matched = this.certCache.get(kid);
    if (!matched) {
      throw new UnauthorizedException('Google identity token key id is unknown.');
    }

    return matched.cert;
  }
}
