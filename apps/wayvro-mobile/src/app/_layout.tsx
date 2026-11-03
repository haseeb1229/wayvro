import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ROOT_STACK_SCREEN_OPTIONS } from '../core/mode/root-stack';
import { AppRoot } from '../core/services/AppRoot';

/**
 * Root route layout (thin): bootstrap + one native stack. Screens live in src/features/*; this directory holds routes only.
 * Root-level redirects are not animated (PB-07; see core/mode/root-stack.ts).
 */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppRoot>
        <Stack screenOptions={ROOT_STACK_SCREEN_OPTIONS}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(session)" options={{ headerShown: false }} />
        </Stack>
      </AppRoot>
    </SafeAreaProvider>
  );
}
