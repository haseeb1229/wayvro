import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppRoot } from '../core/services/AppRoot';

/** Root route layout (thin): bootstrap + one native stack. Screens live in src/features/*; this directory holds routes only. */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppRoot>
        <Stack>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(session)" options={{ headerShown: false }} />
        </Stack>
      </AppRoot>
    </SafeAreaProvider>
  );
}
