import * as Location from 'expo-location';
import { snapshotFromPermission, type PermissionSnapshot } from './machine';

/**
 * READ-ONLY location entry point (the only one the Driver/Partner module may import): the foreground permission and
 * whether device location is on. It never prompts. Rider home reads it on mount and on every return to the foreground;
 * Driver readiness reads it to say whether location will need asking later (no request in the Driver/Partner area in
 * Phase 3).
 */
export type { PermissionSnapshot } from './machine';

export async function readLocationStatus(): Promise<PermissionSnapshot> {
  const [permission, servicesEnabled] = await Promise.all([Location.getForegroundPermissionsAsync(), Location.hasServicesEnabledAsync()]);
  return snapshotFromPermission(permission, servicesEnabled);
}
