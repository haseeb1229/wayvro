import { describe, expect, it } from 'vitest';
import { loadApiConfig } from '../src/config.js';

const base = { WAYVRO_ENV: 'local', DATABASE_URL: 'postgres://wayvro:x@127.0.0.1:25432/wayvro', REDIS_URL: 'redis://127.0.0.1:26379' };

describe('api configuration', () => {
  it('applies safe defaults (loopback bind, no proxy trust, dev version)', () => {
    expect(loadApiConfig(base)).toMatchObject({ PORT: 4000, HOST: '127.0.0.1', TRUST_PROXY: false, WAYVRO_BUILD_VERSION: 'dev' });
  });

  it('parses TRUST_PROXY strictly', () => {
    expect(loadApiConfig({ ...base, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
    expect(() => loadApiConfig({ ...base, TRUST_PROXY: 'yes' })).toThrow(/TRUST_PROXY/);
  });

  it('refuses to boot without its dependencies', () => {
    expect(() => loadApiConfig({ WAYVRO_ENV: 'local' })).toThrow(/DATABASE_URL[\s\S]*REDIS_URL|REDIS_URL[\s\S]*DATABASE_URL/);
  });
});
