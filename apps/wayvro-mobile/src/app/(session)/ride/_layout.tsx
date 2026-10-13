import { Stack } from 'expo-router';
import { RiderFlowProvider } from '../../../features/rider/flow/RiderFlowProvider';

/** Rider graph `/ride/*` (EAGER: Rider mode is the default path). In-memory rider flow state only. */
export default function RideLayout() {
  return (
    <RiderFlowProvider>
      <Stack />
    </RiderFlowProvider>
  );
}
