import { Stack } from 'expo-router';
import { DriveModeGuard } from '../../../core/mode/use-mode';

/**
 * Driver/Partner graph `/drive/*`. Evaluated at start-up (Expo Router registers every route), so it imports NOTHING
 * from the Driver/Partner feature: its screens are lazy route files. The guard re-checks server mode availability.
 */
export default function DriveLayout() {
  return (
    <DriveModeGuard>
      <Stack />
    </DriveModeGuard>
  );
}
