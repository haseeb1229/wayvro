/**
 * TaskManager.defineTask must run at module scope before the app registers (expo-task-manager requirement), so this
 * file is imported first by index.ts. The executor hands everything to the engine; it never logs or keeps positions.
 */
import type { LocationObject } from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { LOCATION_TASK, onLocationTask } from './engine.ts';

TaskManager.defineTask<{ locations?: LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  const code = error
    ? typeof error.code === 'number'
      ? `CODE_${String(error.code)}`
      : error.code
          .toUpperCase()
          .replace(/[^A-Z0-9_]/g, '_')
          .slice(0, 64)
    : null;
  await onLocationTask(data?.locations ?? [], code);
});
