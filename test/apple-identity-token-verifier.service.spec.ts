import { of } from 'rxjs';
import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';

import { AppleIdentityTokenVerifierService } from '../src/auth/apple-identity-token-verifier.service';

describe('AppleIdentityTokenVerifierService', () => {
  const issuer = 'https://appleid.apple.com';
  const audience = 'com.inhousemaker.server';
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: 'jwk' });

  const createService = (overrides: Record<string, string | undefined> = {}) =>
    new AppleIdentityTokenVerifierService(
      {
        get: jest.fn().mockReturnValue(
          of({
            data: {
              keys: [{ ...jwk, kid: 'apple-kid', alg: 'RS256', use: 'sig' }],
            },
          }),
        ),
      } as any,
      {
        get: jest.fn((key: string) => {
          const config = {
            APPLE_CLIENT_ID: audience,
            APPLE_AUDIENCE: 'replace_me',
            ...overrides,
          };
          return config[key as keyof typeof config];
        }),
      } as any,
    );

  it('verifies a valid Apple identity token via JWK', async () => {
    const service = createService();
    const token = jwt.sign(
      {
        sub: 'apple-user-1',
        email: 'apple@example.com',
        email_verified: 'true',
      },
      privateKey,
      {
        algorithm: 'RS256',
        keyid: 'apple-kid',
        issuer,
        audience,
        expiresIn: '1h',
      },
    );

    await expect(service.verifyIdentityToken(token)).resolves.toEqual({
      sub: 'apple-user-1',
      email: 'apple@example.com',
      emailVerified: true,
    });
  });

  it('prefers APPLE_CLIENT_ID over a legacy APPLE_AUDIENCE fallback', async () => {
    const service = createService();
    const token = jwt.sign(
      {
        sub: 'apple-user-1',
        email: 'apple@example.com',
      },
      privateKey,
      {
        algorithm: 'RS256',
        keyid: 'apple-kid',
        issuer,
        audience,
        expiresIn: '1h',
      },
    );

    await expect(service.verifyIdentityToken(token)).resolves.toMatchObject({
      sub: 'apple-user-1',
      email: 'apple@example.com',
    });
  });

  it('rejects a token when audience validation fails', async () => {
    const service = createService({ APPLE_CLIENT_ID: 'com.other.audience' });
    const token = jwt.sign(
      { sub: 'apple-user-1' },
      privateKey,
      {
        algorithm: 'RS256',
        keyid: 'apple-kid',
        issuer,
        audience,
        expiresIn: '1h',
      },
    );

    await expect(service.verifyIdentityToken(token)).rejects.toThrow(
      'Apple identity token audience is invalid.',
    );
  });
});
