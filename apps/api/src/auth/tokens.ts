import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { AppConfig } from '../config';
import type { Db, Queryable } from '../db';
import { withTransaction } from '../db';
import { unauthorized } from '../errors';
import { audit } from '../audit';

const ISSUER = 'edgevitals-api';
const AUDIENCE = 'edgevitals-app';

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export class TokenService {
  private readonly key: Uint8Array;
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
  ) {
    this.key = new TextEncoder().encode(config.jwtSecret);
  }

  async signAccess(userId: string): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setJti(randomUUID())
      .setExpirationTime(`${this.config.accessTokenTtlSec}s`)
      .sign(this.key);
  }

  /** Verify an access token and return the user id. */
  async verifyAccess(token: string): Promise<string> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      if (!payload.sub) throw new Error('no subject');
      return payload.sub;
    } catch {
      throw unauthorized('Invalid or expired session');
    }
  }

  private async insertRefresh(q: Queryable, userId: string, familyId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const expires = new Date(Date.now() + this.config.refreshTokenTtlDays * 86_400_000);
    await q.query(
      'INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
      [userId, familyId, sha256(token), expires],
    );
    return token;
  }

  async issue(userId: string, q: Queryable = this.db): Promise<TokenPair> {
    const refresh = await this.insertRefresh(q, userId, randomUUID());
    return {
      access_token: await this.signAccess(userId),
      refresh_token: refresh,
      token_type: 'Bearer',
      expires_in: this.config.accessTokenTtlSec,
    };
  }

  /**
   * Rotate a refresh token. Presenting an already-rotated token is treated
   * as theft: the whole token family is revoked.
   */
  async rotate(refreshToken: string): Promise<TokenPair> {
    const result = await withTransaction(
      this.db,
      async (c): Promise<TokenPair | { reuse: { userId: string; familyId: string } }> => {
        const { rows } = await c.query(
          `SELECT rt.id, rt.user_id, rt.family_id, rt.expires_at, rt.revoked_at, u.status
           FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
          WHERE rt.token_hash = $1 FOR UPDATE OF rt`,
          [sha256(refreshToken)],
        );
        const row = rows[0];
        if (!row) throw unauthorized('Invalid session');
        // Reuse is handled after this transaction so the revocation is not rolled back.
        if (row.revoked_at) return { reuse: { userId: row.user_id, familyId: row.family_id } };
        if (row.status !== 'active' || new Date(row.expires_at) < new Date())
          throw unauthorized('Session expired');
        await c.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [row.id]);
        const refresh = await this.insertRefresh(c, row.user_id, row.family_id);
        return {
          access_token: await this.signAccess(row.user_id),
          refresh_token: refresh,
          token_type: 'Bearer' as const,
          expires_in: this.config.accessTokenTtlSec,
        };
      },
    );
    if ('reuse' in result) {
      await this.db.query(
        'UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL',
        [result.reuse.familyId],
      );
      await audit(this.db, result.reuse.userId, 'auth.refresh_reuse_detected', {});
      throw unauthorized('Session revoked');
    }
    return result;
  }

  async revokeFamilyOf(refreshToken: string): Promise<void> {
    await this.db.query(
      `UPDATE refresh_tokens SET revoked_at = now()
        WHERE family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = $1) AND revoked_at IS NULL`,
      [sha256(refreshToken)],
    );
  }
}
