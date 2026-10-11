import type { DriverApplication } from '@wayvro/contracts';
import { Stack, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Banner, Button, Screen, StateView } from '../../../core/ui/primitives';
import { viewStateFromQuery } from '../../../core/ui/view-state';
import { useDriverApplication } from '../api/driver-queries';
import { EDITABLE_STATES } from '../onboarding/status';
import { useDriverText } from './DriverUi';

/**
 * Wraps an application editing step: loading/error states, and a clear message instead of a form when the SERVER says
 * the application cannot be edited now (submitted, decided, withdrawn …) — the server would refuse the edit anyway.
 */
export function ApplicationGate({ title, children }: { readonly title: string; readonly children: (application: DriverApplication) => ReactNode }) {
  const dt = useDriverText();
  const router = useRouter();
  const { application, exists } = useDriverApplication();
  const view = viewStateFromQuery(application, (app) => app);
  const backToHub = (
    <Button
      variant="secondary"
      label={dt('driver.backToApplication')}
      onPress={() => {
        router.replace('/earn');
      }}
    />
  );
  if (exists === false) {
    return (
      <Screen scroll={false}>
        <Stack.Screen options={{ title }} />
        <Banner tone="info" text={dt('driver.notEditable')} />
        {backToHub}
      </Screen>
    );
  }
  if (view.kind !== 'ready') {
    return (
      <Screen scroll={false}>
        <Stack.Screen options={{ title }} />
        <StateView
          state={view}
          emptyKey="common.loading"
          onRetry={() => {
            void application.refetch();
          }}
        />
      </Screen>
    );
  }
  if (!EDITABLE_STATES.has(view.data.state)) {
    return (
      <Screen scroll={false}>
        <Stack.Screen options={{ title }} />
        <Banner tone="info" text={dt('driver.notEditable')} />
        {backToHub}
      </Screen>
    );
  }
  return <>{children(view.data)}</>;
}
