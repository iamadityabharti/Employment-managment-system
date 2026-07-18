import { Injectable, OnModuleInit } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { createReliabilityTables, DatabaseService } from '@atlas/platform';

@Injectable()
export class AuthSchemaBootstrap implements OnModuleInit {
  constructor(private readonly database: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    await this.database.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        roles TEXT[] NOT NULL,
        token_version INTEGER NOT NULL DEFAULT 1,
        disabled_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS refresh_token_families (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id),
        revoked_at TIMESTAMPTZ,
        revoke_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id UUID PRIMARY KEY,
        family_id UUID NOT NULL REFERENCES refresh_token_families(id),
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        replaced_by UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS refresh_tokens_family_idx ON refresh_tokens (family_id);
      CREATE TABLE IF NOT EXISTS login_audit (
        id BIGSERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        succeeded BOOLEAN NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await createReliabilityTables(this.database);
    await this.seedDevelopmentAdmin();
  }

  private async seedDevelopmentAdmin(): Promise<void> {
    if (process.env.SEED_DEMO_DATA === 'false') {
      return;
    }
    const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@atlas.local';
    const existing = await this.database.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rowCount) {
      return;
    }
    const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
    await this.database.query(
      `INSERT INTO users (id, email, password_hash, roles)
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), email, await bcrypt.hash(password, 12), ['Admin', 'Manager', 'Employee']]
    );
  }
}
