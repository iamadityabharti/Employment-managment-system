import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '@atlas/platform';
import type { Role } from '@atlas/contracts';

export interface AuthUserRecord {
  id: string;
  email: string;
  password_hash: string;
  roles: Role[];
  token_version: number;
  disabled_at: Date | null;
}

export interface RefreshTokenRecord extends AuthUserRecord {
  token_id: string;
  family_id: string;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
  revoked_at: Date | null;
}

@Injectable()
export class AuthRepository {
  constructor(private readonly database: DatabaseService) {}

  async findUserByEmail(email: string): Promise<AuthUserRecord | undefined> {
    const result = await this.database.query<AuthUserRecord>(
      `SELECT id, email, password_hash, roles, token_version, disabled_at
       FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );
    return result.rows[0];
  }

  async findRefreshToken(client: PoolClient, tokenHash: string): Promise<RefreshTokenRecord | undefined> {
    const result = await client.query<RefreshTokenRecord>(
      `SELECT t.id AS token_id, t.family_id, t.token_hash, t.expires_at, t.used_at,
              f.revoked_at, u.id, u.email, u.password_hash, u.roles, u.token_version, u.disabled_at
       FROM refresh_tokens t
       JOIN refresh_token_families f ON f.id = t.family_id
       JOIN users u ON u.id = f.user_id
       WHERE t.token_hash = $1
       FOR UPDATE`,
      [tokenHash]
    );
    return result.rows[0];
  }

  async recordLoginAttempt(email: string, succeeded: boolean): Promise<void> {
    await this.database.query(
      'INSERT INTO login_audit (email, succeeded) VALUES ($1, $2)',
      [email.toLowerCase(), succeeded]
    );
  }
}
