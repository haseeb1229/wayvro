import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { ErrorEnvelopeSchema } from '@wayvro/contracts';
import {
  createLogger,
  isSensitiveKey,
  redact,
  redactString,
  resolveRequestId,
  runWithContext,
  startTelemetry,
  toErrorEnvelope,
  WayvroError,
  REDACTED,
} from './index.js';

function capture(): { lines: () => Record<string, unknown>[]; stream: Writable } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  return {
    stream,
    lines: () =>
      chunks
        .join('')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

describe('redaction (Q36 default deny)', () => {
  it.each([
    ['password', true],
    ['accessToken', true],
    ['refresh_token', true],
    ['Authorization', true],
    ['cnicFront', true],
    ['phoneNumber', true],
    ['otp', true],
    ['card.pan', true],
    ['pickup_lat', true],
    ['selfieUrl', true],
    ['requestId', false],
    ['latency', false],
    ['ping', false],
    ['status', false],
  ])('isSensitiveKey(%s) === %s', (key, expected) => {
    expect(isSensitiveKey(key)).toBe(expected);
  });

  it('scrubs identifiers and credentials out of free text', () => {
    const s = redactString(
      'user 35202-1234567-1 / 3520212345671 phone +92 300 1234567 alt 0300-1234567 mail a.b@example.com ' +
        'auth Bearer abc.def.ghi card 4111 1111 1111 1111 db postgres://admin:hunter2@db:5432/x at 31.520412, 74.358749',
    );
    for (const leaked of ['35202-1234567-1', '3520212345671', '1234567', 'a.b@example.com', 'abc.def.ghi', '4111', 'hunter2', '31.520412']) {
      expect(s).not.toContain(leaked);
    }
    expect(s).toContain('postgres://[REDACTED]@db:5432/x');
  });

  it('redacts nested sensitive keys, keeps safe fields and survives cycles', () => {
    const obj: Record<string, unknown> = { requestId: 'r-12345678', user: { phone: '03001234567', profile: { email: 'x@y.co' } }, items: [{ token: 't' }] };
    obj['self'] = obj;
    const out = redact(obj) as Record<string, unknown>;
    expect(out['requestId']).toBe('r-12345678');
    expect((out['user'] as Record<string, unknown>)['phone']).toBe(REDACTED);
    expect(((out['user'] as Record<string, unknown>)['profile'] as Record<string, unknown>)['email']).toBe(REDACTED);
    expect((out['items'] as Array<Record<string, unknown>>)[0]?.['token']).toBe(REDACTED);
    expect(out['self']).toBe('[CIRCULAR]');
  });

  it('truncates excessive depth and reduces errors to a scrubbed name/message', () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 12; i++) deep = { next: deep };
    expect(JSON.stringify(redact(deep))).toContain('[TRUNCATED]');
    expect(redact(new Error('lookup failed for 03001234567'))).toEqual({ name: 'Error', message: 'lookup failed for [REDACTED_PHONE]' });
  });
});

describe('structured logger', () => {
  it('emits JSON with service, env, request id, and never the raw PII', () => {
    const { stream, lines } = capture();
    const log = createLogger({ service: 'api', env: 'test', level: 'info', destination: stream });
    runWithContext({ requestId: 'req-abcdef12' }, () => {
      log.info({ phoneNumber: '+923001234567', note: 'call 0300 1234567' }, 'driver 35202-1234567-1 signed in');
    });
    const [line] = lines();
    expect(line).toMatchObject({ service: 'api', env: 'test', level: 'info', requestId: 'req-abcdef12', phoneNumber: REDACTED });
    expect(JSON.stringify(line)).not.toMatch(/1234567/);
  });

  it('defaults to stdout and info level', () => {
    const log = createLogger({ service: 'api', env: 'test', level: undefined });
    expect(log.level).toBe('info');
  });
});

describe('request ids', () => {
  it('keeps well-formed ids and replaces junk', () => {
    expect(resolveRequestId('req-abcdef12')).toBe('req-abcdef12');
    expect(resolveRequestId(['req-abcdef12', 'other'])).toBe('req-abcdef12');
    for (const junk of [undefined, '', 'has spaces in it', '<script>', 'x'.repeat(100)]) {
      expect(resolveRequestId(junk)).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});

describe('error envelope mapping', () => {
  it('maps WayvroError to its code and status and hides unknown errors', () => {
    const known = toErrorEnvelope(new WayvroError('WAYVRO_E_NOT_FOUND'), 'req-abcdef12');
    expect(known.status).toBe(404);
    expect(ErrorEnvelopeSchema.parse(known.body).error.code).toBe('WAYVRO_E_NOT_FOUND');
    const unknown = toErrorEnvelope(new Error('SELECT * FROM secrets failed at pg.js:42'), 'req-abcdef12');
    expect(unknown.status).toBe(500);
    expect(unknown.body.error.code).toBe('WAYVRO_E_INTERNAL');
    expect(unknown.body.error.message).not.toMatch(/secrets|pg\.js/);
  });
});

describe('telemetry bootstrap', () => {
  it('does not export anything when no OTLP endpoint is configured', async () => {
    const t = startTelemetry({ service: 'api', version: 'test', env: 'test', otlpEndpoint: undefined });
    expect(t.exporting).toBe(false);
    await t.shutdown();
  });

  it('starts and cleanly shuts down an OTLP exporter when an endpoint is configured', async () => {
    const t = startTelemetry({ service: 'api', version: 'test', env: 'test', otlpEndpoint: 'http://127.0.0.1:4318/' });
    expect(t.exporting).toBe(true);
    await expect(t.shutdown()).resolves.toBeUndefined();
  });
});
