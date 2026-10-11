// Container entry point (infra/sanitiser/Dockerfile): stdin -> runSanitiser -> stdout + exit code. No arguments, no
// environment, no network, no files; nothing is logged (an input may be identity evidence).
import { runSanitiser } from './run.js';

const { exitCode, output } = await runSanitiser(process.stdin);
if (output) process.stdout.write(output);
process.exitCode = exitCode;
