import { describe, expect, it } from 'vitest';
import { resolveApiConfig } from './api-config';

describe('resolveApiConfig', () => {
  it('has no default URL: an unconfigured release build is reported as unconfigured', () => {
    expect(resolveApiConfig(undefined, false)).toEqual({ kind: 'unconfigured' });
    expect(resolveApiConfig({ wayvroApi: { baseUrl: null, devLocalApi: false } }, false)).toEqual({ kind: 'unconfigured' });
  });

  it('ignores the local-runner fallback in release builds', () => {
    expect(resolveApiConfig({ wayvroApi: { baseUrl: null, devLocalApi: true } }, false)).toEqual({ kind: 'unconfigured' });
  });

  it('uses the emulator loopback only for an explicit dev opt-in in a development build', () => {
    expect(resolveApiConfig({ wayvroApi: { baseUrl: null, devLocalApi: true } }, true)).toEqual({
      kind: 'configured',
      baseUrl: 'http://10.0.2.2:4000',
      source: 'dev-local',
    });
    expect(resolveApiConfig({ wayvroApi: { baseUrl: null, devLocalApi: false } }, true)).toEqual({ kind: 'unconfigured' });
  });

  it('accepts a configured https origin and strips trailing slashes', () => {
    expect(resolveApiConfig({ wayvroApi: { baseUrl: 'https://api.example.test/', devLocalApi: false } }, false)).toEqual({
      kind: 'configured',
      baseUrl: 'https://api.example.test',
      source: 'build-config',
    });
  });

  it('refuses plain http in release builds and malformed values everywhere', () => {
    expect(resolveApiConfig({ wayvroApi: { baseUrl: 'http://api.example.test' } }, false)).toEqual({ kind: 'invalid' });
    expect(resolveApiConfig({ wayvroApi: { baseUrl: 'http://192.168.1.10:4000' } }, true).kind).toBe('configured');
    for (const bad of ['ftp://x.test', 'https://user:pw@x.test', 'https://x.test/?a=1', 'https://x.test/#f', 'not a url']) {
      expect(resolveApiConfig({ wayvroApi: { baseUrl: bad } }, true), bad).toEqual({ kind: 'invalid' });
    }
  });
});
