import { describe, expect, it } from 'vitest';
import { EARTH_RADIUS_M, corridorOverlap, haversineM, pathLengthM, percentile } from './geo.js';
import { GPX_MAX_ACCURACY_M, gpxLengthM, legTruths, parseGpx } from './gpx.js';
import type { RouteCase } from './cases.js';

describe('haversine (SP-04 §6, R = 6,371,008.8 m)', () => {
  it('matches the closed form for one degree of latitude and is symmetric', () => {
    const oneDegree = (2 * Math.PI * EARTH_RADIUS_M) / 360;
    expect(haversineM({ lat: 31, lng: 74 }, { lat: 32, lng: 74 })).toBeCloseTo(oneDegree, 3);
    const a = { lat: 31.5, lng: 74.3 };
    const b = { lat: 31.6, lng: 74.4 };
    expect(haversineM(a, b)).toBeCloseTo(haversineM(b, a), 9);
    expect(haversineM(a, a)).toBe(0);
    expect(pathLengthM([a, b, a])).toBeCloseTo(2 * haversineM(a, b), 6);
  });

  it('computes corridor overlap and percentiles', () => {
    const track = [
      { lat: 31.5, lng: 74.3 },
      { lat: 31.5, lng: 74.4 },
    ];
    expect(
      corridorOverlap(
        [
          { lat: 31.5001, lng: 74.35 },
          { lat: 31.51, lng: 74.35 },
        ],
        track,
      ),
    ).toBe(0.5);
    expect(corridorOverlap([], track)).toBeNull();
    expect(corridorOverlap([{ lat: 31.5, lng: 74.3 }], [{ lat: 31.5, lng: 74.3 }])).toBeNull();
    expect(percentile([3, 1, 2], 50)).toBe(2);
    expect(percentile([1, 2, 3, 4], 90)).toBeCloseTo(3.7);
    expect(percentile([], 50)).toBeNull();
  });
});

describe('GPX', () => {
  const gpx = [
    '<gpx><trk><trkseg>',
    '<trkpt lat="31.50000" lon="74.30000"><ele>200</ele></trkpt>',
    '<trkpt lat="31.50100" lon="74.30000"><extensions><acc:accuracy>40</acc:accuracy></extensions></trkpt>',
    '<trkpt lat="31.51000" lon="74.30000"><extensions><accuracy>4</accuracy></extensions></trkpt>',
    `<trkpt lon='74.30000' lat='31.52000'/>`,
    '<trkpt lat="bad" lon="74.3"></trkpt>',
    '</trkseg></trk></gpx>',
  ].join('');

  it('reads track points, drops points with accuracy above 25 m and malformed points', () => {
    const track = parseGpx(gpx);
    expect(GPX_MAX_ACCURACY_M).toBe(25);
    expect(track.points).toHaveLength(3);
    expect(track.dropped).toBe(2);
    expect(gpxLengthM(track)).toBeCloseTo(haversineM({ lat: 31.5, lng: 74.3 }, { lat: 31.52, lng: 74.3 }), 3);
    expect(gpxLengthM(parseGpx('<gpx/>'))).toBeNull();
  });

  it('uses GPX as D_true with the 5 % odometer cross-check, else the odometer', () => {
    const leg = (id: string, odometerKm: number): RouteCase => ({
      id,
      category: 'C06',
      sessionId: 'LHR-SP04-S3',
      date: '2026-10-21',
      timeLocal: '11:30',
      trafficLevel: 'FREE',
      originId: 'a',
      destId: 'b',
      odometerKm,
      actualMinutes: 10,
      followedNaturalRoute: true,
      constraintObserved: null,
      gpxFileRef: null,
    });
    const track = parseGpx(gpx);
    const length = gpxLengthM(track) ?? 0;
    const truths = legTruths(
      [leg('ok', length / 1000), leg('far', (length * 1.2) / 1000), leg('none', 3)],
      new Map([
        ['ok', track],
        ['far', track],
      ]),
    );
    expect(truths.get('ok')).toMatchObject({ source: 'GPX', flagged: false });
    expect(truths.get('far')).toMatchObject({ source: 'GPX', flagged: true });
    expect(truths.get('none')).toEqual({ distanceM: 3000, source: 'ODOMETER', flagged: false, track: null });
  });
});
