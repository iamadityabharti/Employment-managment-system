import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {
  createDomainEvent,
  type JwtClaims,
  type Role
} from '@atlas/contracts';
import {
  DatabaseService,
  OutboxService,
  getTraceContext,
  requiredJwtSecret
} from '@atlas/platform';
import { AuthRepository, type AuthUserRecord } from './auth.repository';
import { LoginRateLimiter } from './login-rate-limiter';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly repository: AuthRepository,
    private readonly outbox: OutboxService,
    private readonly loginRateLimiter: LoginRateLimiter
  ) {}

  async login(email: string, password: string): Promise<TokenPair> {
    await this.loginRateLimiter.assertAllowed(email);
    const user = await this.repository.findUserByEmail(email);
    const valid = Boolean(user && !user.disabled_at && (await bcrypt.compare(password, user.password_hash)));
    await this.repository.recordLoginAttempt(email, valid);
    if (!valid || !user) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.issueTokenPair(user);
  }

  async refresh(rawRefreshToken: string): Promise<TokenPair> {
    const tokenHash = hashToken(rawRefreshToken);
    return this.database.transaction(async (client) => {
      const stored = await this.repository.findRefreshToken(client, tokenHash);
      if (!stored || stored.disabled_at || stored.revoked_at || stored.expires_at <= new Date()) {
        throw new UnauthorizedException('Refresh token is invalid or expired');
      }
      if (stored.used_at) {
        await client.query(
          `UPDATE refresh_token_families
           SET revoked_at = NOW(), revoke_reason = 'refresh_token_reuse_detected'
           WHERE id = $1`,
          [stored.family_id]
        );
        throw new UnauthorizedException('Refresh token reuse detected; sign in again');
      }
      const tokenPair = await this.issueTokenPair(stored, client, stored.family_id);
      await client.query('UPDATE refresh_tokens SET used_at = NOW() WHERE id = $1', [stored.token_id]);
      return tokenPair;
    });
  }

  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = hashToken(rawRefreshToken);
    await this.database.query(
      `UPDATE refresh_token_families f
       SET revoked_at = NOW(), revoke_reason = 'user_logout'
       FROM refresh_tokens t
       WHERE t.family_id = f.id AND t.token_hash = $1 AND f.revoked_at IS NULL`,
      [tokenHash]
    );
  }

  async provisionUser(email: string, password: string, roles: Role[]): Promise<{ id: string; email: string; roles: Role[] }> {
    const id = randomUUID();
    return this.database.transaction(async (client) => {
      const existing = await client.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
      if (existing.rowCount) {
        throw new ConflictException('A user with that email already exists');
      }
      await client.query(
        `INSERT INTO users (id, email, password_hash, roles) VALUES ($1, $2, $3, $4)`,
        [id, email.toLowerCase(), await bcrypt.hash(password, 12), roles]
      );
      await this.outbox.enqueue(
        client,
        createDomainEvent({
          type: 'auth.user-provisioned.v1',
          producer: 'auth-service',
          aggregate: { type: 'user', id },
          traceId: getTraceContext().traceId,
          data: { userId: id, email: email.toLowerCase(), roles }
        })
      );
      return { id, email: email.toLowerCase(), roles };
    });
  }

  private async issueTokenPair(
    user: AuthUserRecord,
    existingClient?: Parameters<DatabaseService['transaction']>[0] extends (client: infer T) => unknown ? T : never,
    existingFamilyId?: string
  ): Promise<TokenPair> {
    const claims: JwtClaims = {
      sub: user.id,
      email: user.email,
      roles: user.roles,
      tokenVersion: user.token_version
    };
    const expiresInSeconds = Number(process.env.JWT_ACCESS_TTL_SECONDS ?? 900);
    const accessToken = jwt.sign(claims, requiredJwtSecret(), {
      expiresIn: expiresInSeconds,
      issuer: 'atlas-auth',
      audience: 'atlas-api'
    });
    const refreshToken = randomBytes(48).toString('base64url');
    const refreshExpiresAt = new Date(Date.now() + Number(process.env.JWT_REFRESH_TTL_DAYS ?? 30) * 86400000);
    const familyId = existingFamilyId ?? randomUUID();
    const tokenId = randomUUID();

    if (existingClient) {
      if (!existingFamilyId) {
        await existingClient.query('INSERT INTO refresh_token_families (id, user_id) VALUES ($1, $2)', [familyId, user.id]);
      }
      await existingClient.query(
        `INSERT INTO refresh_tokens (id, family_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [tokenId, familyId, hashToken(refreshToken), refreshExpiresAt]
      );
    } else {
      await this.database.transaction(async (client) => {
        await client.query('INSERT INTO refresh_token_families (id, user_id) VALUES ($1, $2)', [familyId, user.id]);
        await client.query(
          `INSERT INTO refresh_tokens (id, family_id, token_hash, expires_at)
           VALUES ($1, $2, $3, $4)`,
          [tokenId, familyId, hashToken(refreshToken), refreshExpiresAt]
        );
      });
    }
    return { accessToken, refreshToken, expiresInSeconds };
  }
}

function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
