// CI entry point: fails when the flag registry contains invalid or expired flags, or the runtime-switch registry is
// invalid (unknown key shape, duplicate, untraced, or a switch able to control a security mechanism). UTC server date.
import { FLAG_REGISTRY, validateFlagRegistry } from './flags.js';
import { RUNTIME_SWITCH_REGISTRY, validateRuntimeSwitchRegistry } from './runtime-switches.js';

const today = new Date().toISOString().slice(0, 10);
const problems = validateFlagRegistry(FLAG_REGISTRY, today);
if (problems.length > 0) {
  console.error(`feature-flag registry: ${problems.length} problem(s)\n - ${problems.join('\n - ')}`);
  process.exit(1);
}
console.log(`feature-flag registry: OK (${FLAG_REGISTRY.length} flags, checked ${today})`);
const switchProblems = validateRuntimeSwitchRegistry(RUNTIME_SWITCH_REGISTRY);
if (switchProblems.length > 0) {
  console.error(`runtime-switch registry: ${switchProblems.length} problem(s)\n - ${switchProblems.join('\n - ')}`);
  process.exit(1);
}
console.log(`runtime-switch registry: OK (${RUNTIME_SWITCH_REGISTRY.length} switches)`);
