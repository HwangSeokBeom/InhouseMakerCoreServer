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

  const createService = (configuredAudience = audience) =>
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
        get: jest.fn((key: string) =>
          key === 'APPLE_AUDIENCE' ? configuredAudience : undefined,
        ),
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

  it('rejects a token when audience validation fails', async () => {
    const service = createService('com.other.audience');
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
