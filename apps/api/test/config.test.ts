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
    expect(loadApiConfig({ ...base, TRUST_PROXY: '10.0.0.0/8, 192.168.1.10,fd00::/8' }).TRUST_PROXY).toEqual(['10.0.0.0/8', '192.168.1.10', 'fd00::/8']);
    for (const bad of ['10.0.0.0/33', 'fd00::/129', 'proxy.internal', '10.0.0.1/8/1', '', '1']) {
      expect(() => loadApiConfig({ ...base, TRUST_PROXY: bad })).toThrow(/TRUST_PROXY/);
    }
  });

  it('staging/production refuse trust-all proxy configuration (OTP IP limits must not rest on a spoofable header)', () => {
    const prod = {
      WAYVRO_ENV: 'production',
      DATABASE_URL: 'postgres://wayvro:x@db.internal:5432/wayvro?sslmode=verify-full',
      REDIS_URL: 'rediss://cache.internal:6379',
      STAFF_WEBAUTHN_RP_ID: 'ops.wayvro.example',
      STAFF_WEBAUTHN_ORIGINS: 'https://ops.wayvro.example',
    };
    expect(() => loadApiConfig({ ...prod, TRUST_PROXY: 'true' })).toThrow(/trust-all is refused/);
    expect(() => loadApiConfig({ ...prod, WAYVRO_ENV: 'staging', TRUST_PROXY: 'true' })).toThrow(/trust-all is refused/);
    expect(loadApiConfig({ ...prod, TRUST_PROXY: '10.20.0.0/16' }).TRUST_PROXY).toEqual(['10.20.0.0/16']);
    expect(loadApiConfig({ ...prod }).TRUST_PROXY).toBe(false);
  });

  it('staging/production require a real WebAuthn relying party and https origins for staff authentication', () => {
    const prod = {
      WAYVRO_ENV: 'production',
      DATABASE_URL: 'postgres://wayvro:x@db.internal:5432/wayvro?sslmode=verify-full',
      REDIS_URL: 'rediss://cache.internal:6379',
    };
    expect(() => loadApiConfig(prod)).toThrow(/https origins for staff WebAuthn/);
    expect(() => loadApiConfig({ ...prod, STAFF_WEBAUTHN_RP_ID: 'ops.wayvro.example', STAFF_WEBAUTHN_ORIGINS: 'http://ops.wayvro.example' })).toThrow(
      /staff WebAuthn/,
    );
    expect(
      loadApiConfig({ ...prod, STAFF_WEBAUTHN_RP_ID: 'ops.wayvro.example', STAFF_WEBAUTHN_ORIGINS: 'https://ops.wayvro.example' }).STAFF_WEBAUTHN_ORIGINS,
    ).toEqual(['https://ops.wayvro.example']);
    expect(() => loadApiConfig({ ...base, STAFF_WEBAUTHN_ORIGINS: 'not a url' })).toThrow(/STAFF_WEBAUTHN_ORIGINS/);
    expect(loadApiConfig(base)).toMatchObject({ STAFF_WEBAUTHN_RP_ID: 'localhost', STAFF_SESSION_IDLE_SECONDS: 900, STAFF_STEP_UP_SECONDS: 300 });
  });

  it('refuses to boot without its dependencies', () => {
    expect(() => loadApiConfig({ WAYVRO_ENV: 'local' })).toThrow(/DATABASE_URL[\s\S]*REDIS_URL|REDIS_URL[\s\S]*DATABASE_URL/);
  });
});
