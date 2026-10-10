import { defineConfig } from 'drizzle-kit';

// drizzle-kit is used only to draft migrations; every file in ./migrations is reviewed SQL (ADR-004).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
});
