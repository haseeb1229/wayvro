import { Stack } from 'expo-router';
import { AccountGate } from '../../core/account/AccountGate';

/** Every route in this group requires a session; the server's account state decides which one is shown. */
export default function SessionLayout() {
  return (
    <AccountGate>
      <Stack />
    </AccountGate>
  );
}
