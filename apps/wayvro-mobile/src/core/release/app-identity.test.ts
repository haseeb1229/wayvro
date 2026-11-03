import { describe, expect, it } from 'vitest';
import { appHeaders, appIdentity } from './app-identity';

describe('app identity and version headers (A01/Q31)', () => {
  it('reads platform, version and the native build number from the embedded Expo config', () => {
    expect(appIdentity('android', { version: '1.2.3', android: { versionCode: 42 } })).toEqual({ platform: 'ANDROID', version: '1.2.3', build: 42 });
    expect(appIdentity('ios', { version: '1.2.3', ios: { buildNumber: '7' } })).toEqual({ platform: 'IOS', version: '1.2.3', build: 7 });
  });

  it('never guesses: a missing or malformed build is omitted, a malformed version becomes 0.0.0', () => {
    expect(appIdentity('android', null)).toEqual({ platform: 'ANDROID', version: '0.0.0', build: null });
    expect(appIdentity('ios', { version: 'not a version!', ios: { buildNumber: '1.0' } })).toEqual({ platform: 'IOS', version: '0.0.0', build: null });
    expect(appIdentity('android', { version: '1.0.0', ios: { buildNumber: '9' } }).build).toBeNull();
  });

  it('sends the contract headers on every request; the build header only when known', () => {
    expect(appHeaders({ platform: 'ANDROID', version: '0.0.0', build: 1 })).toEqual({
      'x-wayvro-platform': 'ANDROID',
      'x-wayvro-app-version': '0.0.0',
      'x-wayvro-app-build': '1',
    });
    expect(appHeaders({ platform: 'IOS', version: '1.0.0', build: null })).toEqual({ 'x-wayvro-platform': 'IOS', 'x-wayvro-app-version': '1.0.0' });
  });
});
