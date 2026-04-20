import { of } from 'rxjs';
import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';

import { GoogleIdentityTokenVerifierService } from '../src/auth/google-identity-token-verifier.service';

describe('GoogleIdentityTokenVerifierService', () => {
  const issuer = 'https://accounts.google.com';
  const audience = '742162085445-example.apps.googleusercontent.com';
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

  const createService = (overrides: Record<string, string | undefined> = {}) =>
    new GoogleIdentityTokenVerifierService(
      {
        get: jest.fn().mockReturnValue(
          of({
            data: {
              'google-kid': publicKeyPem,
            },
            headers: {
              'cache-control': 'public, max-age=3600',
            },
          }),
        ),
      } as any,
      {
        get: jest.fn((key: string) => {
          const config = {
            GOOGLE_CLIENT_ID: audience,
            GOOGLE_AUDIENCE: 'replace_me',
            ...overrides,
          };
          return config[key as keyof typeof config];
        }),
        getOrThrow: jest.fn((key: string) => {
          const config = {
            GOOGLE_CLIENT_ID: audience,
            GOOGLE_AUDIENCE: 'replace_me',
            ...overrides,
          };
          const value = config[key as keyof typeof config];
          if (value === undefined) {
            throw new Error(`Missing config ${key}`);
          }
          return value;
        }),
      } as any,
    );

  it('verifies a valid Google identity token via the configured client id', async () => {
    const service = createService();
    const token = jwt.sign(
      {
        sub: 'google-user-1',
        email: 'google@example.com',
        email_verified: true,
      },
      privateKey,
      {
        algorithm: 'RS256',
        keyid: 'google-kid',
        issuer,
        audience,
        expiresIn: '1h',
      },
    );

    await expect(service.verifyIdentityToken(token)).resolves.toEqual({
      sub: 'google-user-1',
      email: 'google@example.com',
      emailVerified: true,
    });
  });

  it('rejects a token when the configured client id does not match the audience', async () => {
    const service = createService({ GOOGLE_CLIENT_ID: 'other-client-id' });
    const token = jwt.sign(
      {
        sub: 'google-user-1',
      },
      privateKey,
      {
        algorithm: 'RS256',
        keyid: 'google-kid',
        issuer,
        audience,
        expiresIn: '1h',
      },
    );

    await expect(service.verifyIdentityToken(token)).rejects.toThrow(
      'Google identity token audience is invalid.',
    );
  });

  it('uses GOOGLE_CLIENT_ID as the authoritative audience even when GOOGLE_AUDIENCE differs', async () => {
    const service = createService({ GOOGLE_AUDIENCE: 'legacy-google-audience' });
    const officialToken = jwt.sign(
      {
        sub: 'google-user-1',
      },
      privateKey,
      {
        algorithm: 'RS256',
        keyid: 'google-kid',
        issuer,
        audience,
        expiresIn: '1h',
      },
    );
    const legacyAudienceToken = jwt.sign(
      {
        sub: 'google-user-1',
      },
      privateKey,
      {
        algorithm: 'RS256',
        keyid: 'google-kid',
        issuer,
        audience: 'legacy-google-audience',
        expiresIn: '1h',
      },
    );

    await expect(service.verifyIdentityToken(officialToken)).resolves.toMatchObject({
      sub: 'google-user-1',
    });
    await expect(service.verifyIdentityToken(legacyAudienceToken)).rejects.toThrow(
      'Google identity token audience is invalid.',
    );
  });
});
