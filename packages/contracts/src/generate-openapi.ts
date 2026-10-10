// Writes the generated OpenAPI document. CI regenerates it and fails on any diff (generated-drift gate, GR-02).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOpenApiDocument } from './openapi.js';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'openapi', 'wayvro-api.v1.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(buildOpenApiDocument('1.0.0'), null, 2) + '\n');
console.log(`openapi: wrote ${out}`);
