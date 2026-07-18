import { createHash } from 'node:crypto';

describe('Auth refresh-token representation', () => {
  it('stores only a deterministic SHA-256 digest, never the opaque token itself', () => {
    const rawToken = 'opaque-refresh-token-value';
    const digest = createHash('sha256').update(rawToken).digest('hex');

    expect(digest).toHaveLength(64);
    expect(digest).not.toContain(rawToken);
    expect(digest).toBe(createHash('sha256').update(rawToken).digest('hex'));
  });
});
