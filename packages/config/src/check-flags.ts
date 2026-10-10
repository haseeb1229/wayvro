// CI entry point: fails when the flag registry contains invalid or expired flags. Uses the UTC server date.
import { FLAG_REGISTRY, validateFlagRegistry } from './flags.js';

const today = new Date().toISOString().slice(0, 10);
const problems = validateFlagRegistry(FLAG_REGISTRY, today);
if (problems.length > 0) {
  console.error(`feature-flag registry: ${problems.length} problem(s)\n - ${problems.join('\n - ')}`);
  process.exit(1);
}
console.log(`feature-flag registry: OK (${FLAG_REGISTRY.length} flags, checked ${today})`);
