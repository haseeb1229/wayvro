import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAPTURE_COLUMNS, validateCapture } from './cases.js';
import { parseCsv, toCsv } from './csv.js';
import { PACKAGE_ROOT } from './local.js';
import { scanForPii } from './pii.js';
import { syntheticCsv } from '../test/fixtures.js';

const TEMPLATE = join(PACKAGE_ROOT, '..', '..', 'docs', 'phase3', 'PHASE3_SP04_FIELD_CAPTURE_TEMPLATE.csv');

describe('CSV', () => {
  it('parses quoted fields, doubled quotes, CRLF and a BOM, and round-trips', () => {
    const bom = String.fromCodePoint(0xfeff);
    expect(parseCsv(`${bom}a,"b, c","say ""hi"""\r\n1,2,3`)).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', '2', '3'],
    ]);
    const rows = [['x', 'with,comma', 'with "quote"']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
    expect(() => parseCsv('"open')).toThrow(/unterminated/);
  });
});

describe('validateCapture', () => {
  it('matches the template header exactly and rejects the template EXAMPLE rows', () => {
    const template = readFileSync(TEMPLATE, 'utf8');
    expect(parseCsv(template)[0]).toEqual([...CAPTURE_COLUMNS]);
    const result = validateCapture(template);
    expect(result.errors).toHaveLength(3);
    expect(result.errors.every((e) => e.message.startsWith('EXAMPLE row present'))).toBe(true);
    expect(result.points).toHaveLength(0);
  });

  it('accepts a valid synthetic sheet', () => {
    const result = validateCapture(syntheticCsv(8, 4));
    expect(result.errors).toEqual([]);
    expect(result.points).toHaveLength(8);
    expect(result.routes).toHaveLength(4);
    expect(result.routes[0]).toMatchObject({ originId: 'LHR-SP04-001', destId: 'LHR-SP04-002', odometerKm: 10, actualMinutes: 20, followedNaturalRoute: true });
    // §2.2/§2.3 minimums are warnings, not errors.
    expect(result.warnings.some((w) => w.message.includes('at least 50'))).toBe(true);
  });

  it('rejects a wrong header', () => {
    expect(validateCapture('case_id,case_kind\n').errors[0]?.message).toMatch(/header/);
  });

  it.each([
    [{ true_point_lat_5dp: '51.50000', true_point_lng_5dp: '-0.10000' }, 'true_point_lat_5dp', /outside Pakistan/],
    [{ true_point_lat_5dp: '' }, 'true_point_lat_5dp', /required/],
    [{ gps_accuracy_m: '14' }, 'gps_accuracy_m', /retake/],
    [{ is_public_place: 'N' }, 'is_public_place', /must be Y/],
    [{ true_place_name: '' }, 'true_place_name', /required/],
    [{ reverse_geocode_expected_area: '' }, 'reverse_geocode_expected_area', /required/],
    [{ query_text_en: '', query_text_roman_urdu: '' }, 'query_text_en', /at least one/],
    [{ category: 'C06' }, 'category', /not a POINT category/],
    [{ case_id: 'LHR-1' }, 'case_id', /LHR-SP04-NNN/],
    [{ session_id: 'S1' }, 'session_id', /LHR-SP04-Sn/],
    [{ date: '2026-02-30' }, 'date', /valid/],
    [{ time_local: '25:00' }, 'time_local', /HH:MM/],
    [{ captured_by: 'Ali' }, 'captured_by', /FOUNDER/],
    [{ case_status: 'DONE' }, 'case_status', /CAPTURED or DISCARDED/],
  ])('POINT field errors: %j', (override, field, message) => {
    const result = validateCapture(syntheticCsv(2, 0, { 1: override }));
    const error = result.errors.find((e) => e.field === field);
    expect(error?.message).toMatch(message);
    expect(error?.row).toBe(2);
  });

  it.each([
    [{ traffic_level: 'BUSY' }, 'traffic_level', /FREE/],
    [{ odometer_km: '' }, 'odometer_km', /positive/],
    [{ actual_drive_minutes: '0' }, 'actual_drive_minutes', /positive/],
    [{ followed_natural_route: 'maybe' }, 'followed_natural_route', /Y or N/],
    [{ route_origin_case_id: 'LHR-SP04-099' }, 'route_origin_case_id', /CAPTURED POINT/],
    [{ route_dest_case_id: '' }, 'route_origin_case_id', /required/],
    [{ case_kind: 'TRIP' }, 'case_kind', /POINT or ROUTE/],
  ])('ROUTE field errors: %j', (override, field, message) => {
    const result = validateCapture(syntheticCsv(2, 1, { 3: override }));
    expect(result.errors.find((e) => e.field === field)?.message).toMatch(message);
  });

  it('skips DISCARDED rows, flags duplicates and missing reasons', () => {
    const result = validateCapture(syntheticCsv(3, 0, { 2: { case_status: 'DISCARDED' }, 3: { case_id: 'LHR-SP04-001' } }));
    expect(result.points.map((p) => p.id)).toEqual(['LHR-SP04-001']);
    expect(result.errors.some((e) => e.message === 'duplicate case id')).toBe(true);
    expect(result.warnings.some((w) => w.message.includes('DISCARDED case without a reason'))).toBe(true);
  });

  it('warns about personal data without echoing it', () => {
    const phone = '0300 1234567';
    const result = validateCapture(syntheticCsv(2, 0, { 1: { notes_no_pii: `call ${phone}` }, 2: { pickup_instruction_text: 'outside house no 12' } }));
    const warnings = result.warnings.filter((w) => w.message.startsWith('possible personal data'));
    expect(warnings.map((w) => w.field)).toEqual(['notes_no_pii', 'pickup_instruction_text']);
    expect(JSON.stringify(result.warnings)).not.toContain(phone);
    expect(result.freeTextValues).toContain(`call ${phone}`);
  });
});

describe('scanForPii', () => {
  it.each([
    ['+92 300 1234567', 'PHONE_NUMBER'],
    ['35202-1234567-1', 'CNIC'],
    ['someone@example.org', 'EMAIL'],
    ['parked behind LEA-1234', 'VEHICLE_PLATE'],
    ['my home gate', 'PRIVATE_ADDRESS_WORD'],
    ['ask Bhai at the shop', 'PERSONAL_NAME_WORD'],
    ['ref 123456789', 'LONG_DIGIT_RUN'],
  ])('%s ⇒ %s', (text, kind) => {
    expect(scanForPii(text)).toContain(kind);
  });

  it('does not flag ordinary landmark text or case ids', () => {
    expect(scanForPii('Plot N, Block H, Phase 5 near the park, see LHR-SP04-012')).toEqual([]);
  });
});
