import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrationHeaderProblems } from './migrate.js';

describe('migration header discipline (GR-04)', () => {
  it('every shipped migration documents compatibility, data impact, rollback and verification', () => {
    expect(migrationHeaderProblems()).toEqual([]);
  });

  it('flags an undocumented migration', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wayvro-mig-'));
    writeFileSync(join(dir, '9999_undocumented.sql'), 'ALTER TABLE x DROP COLUMN y;\n');
    // wayvro-migration, compatibility, data-impact, rollback, verification
    expect(migrationHeaderProblems(dir)).toHaveLength(5);
  });
});
