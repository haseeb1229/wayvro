import { describe, expect, it } from 'vitest';
import { ConfigError, databaseEnvSchema, httpEnvSchema, isNonProductionLike, keyEnvSchema, loadConfig, redisEnvSchema, serviceEnvSchema } from './env.js';

const schema = serviceEnvSchema.extend(databaseEnvSchema.shape).extend(redisEnvSchema.shape).extend(httpEnvSchema.shape);
const local = {
  WAYVRO_ENV: 'local',
  DATABASE_URL: 'postgres://wayvro:local-only@127.0.0.1:25432/wayvro',
  REDIS_URL: 'redis://127.0.0.1:26379',
  PORT: '4000',
};

describe('loadConfig', () => {
  it('returns a frozen, typed config with defaults applied', () => {
    const c = loadConfig(schema, local);
    expect(c.PORT).toBe(4000);
    expect(c.LOG_LEVEL).toBe('info');
    expect(c.HOST).toBe('127.0.0.1');
    expect(Object.isFrozen(c)).toBe(true);
  });

  it('fails boot on missing or malformed keys and names them without echoing values', () => {
    const secret = 'postgres://user:SUPER-SECRET@db.example.com/x';
    try {
      loadConfig(schema, { ...local, WAYVRO_ENV: 'prod', PORT: 'abc', DATABASE_URL: secret.replace('postgres', 'mysql') });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      const msg = (e as ConfigError).message;
      expect(msg).toMatch(/WAYVRO_ENV/);
      expect(msg).toMatch(/PORT/);
      expect(msg).toMatch(/DATABASE_URL/);
      expect(msg).not.toMatch(/SUPER-SECRET/);
    }
  });

  it('refuses local infrastructure and plaintext transport in staging/production', () => {
    for (const env of ['staging', 'production']) {
      expect(() => loadConfig(schema, { ...local, WAYVRO_ENV: env })).toThrow(/must not use a local host/);
    }
    const remoteNoTls = {
      ...local,
      WAYVRO_ENV: 'production',
      DATABASE_URL: 'postgres://u:p@db.internal.example/wayvro',
      REDIS_URL: 'redis://cache.internal.example:6379',
    };
    try {
      loadConfig(schema, remoteNoTls);
      expect.unreachable();
    } catch (e) {
      expect((e as ConfigError).issues).toEqual(expect.arrayContaining([expect.stringMatching(/sslmode/), expect.stringMatching(/rediss/)]));
    }
    const ok = loadConfig(schema, {
      ...remoteNoTls,
      DATABASE_URL: 'postgres://u:p@db.internal.example/wayvro?sslmode=verify-full',
      REDIS_URL: 'rediss://cache.internal.example:6380',
    });
    expect(ok.WAYVRO_ENV).toBe('production');
  });

  it('refuses local key material in staging/production (EG-05: no production key provider yet)', () => {
    const remote = {
      DATABASE_URL: 'postgres://u:p@db.internal.example/wayvro?sslmode=verify-full',
      REDIS_URL: 'rediss://cache.internal.example:6380',
      WAYVRO_LOCAL_KEY_SEED: 'synthetic-seed-that-is-long-enough-000000',
    };
    const keyed = serviceEnvSchema.extend(databaseEnvSchema.shape).extend(redisEnvSchema.shape).extend(keyEnvSchema.shape);
    for (const env of ['staging', 'production']) expect(() => loadConfig(keyed, { ...remote, WAYVRO_ENV: env })).toThrow(/must not use local key material/);
    expect(loadConfig(keyed, { ...local, WAYVRO_LOCAL_KEY_SEED: remote.WAYVRO_LOCAL_KEY_SEED }).WAYVRO_LOCAL_KEY_SEED).toBe(remote.WAYVRO_LOCAL_KEY_SEED);
    expect(() => loadConfig(keyed, { ...local, WAYVRO_LOCAL_KEY_SEED: 'short' })).toThrow(/WAYVRO_LOCAL_KEY_SEED/);
  });

  it('reports service-specific environment rules together with the shared ones (no rule hides another)', () => {
    const rules = (c: { WAYVRO_ENV: string }) => (c.WAYVRO_ENV === 'production' ? ['SERVICE_RULE: refused in production'] : []);
    const db = serviceEnvSchema.extend(databaseEnvSchema.shape);
    let message = '';
    try {
      loadConfig(db, { WAYVRO_ENV: 'production', DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/w?sslmode=require' }, rules);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/must not use a local host/);
    expect(message).toMatch(/SERVICE_RULE: refused in production/);
    expect(loadConfig(db, { WAYVRO_ENV: 'local', DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/w' }, rules).WAYVRO_ENV).toBe('local');
  });

  it('refuses debug logging outside local/test', () => {
    expect(() => loadConfig(serviceEnvSchema, { WAYVRO_ENV: 'staging', LOG_LEVEL: 'debug' })).toThrow(/debug/);
    expect(loadConfig(serviceEnvSchema, { WAYVRO_ENV: 'local', LOG_LEVEL: 'debug' }).LOG_LEVEL).toBe('debug');
  });

  it('classifies only local and test as non-production-like', () => {
    expect(['local', 'test', 'staging', 'production'].map((e) => isNonProductionLike(e as never))).toEqual([true, true, false, false]);
  });
});
