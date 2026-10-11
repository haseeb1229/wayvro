import { focusManager, QueryClientProvider } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { resolveApiConfig } from '../config/api-config';
import { I18nProvider, useI18n } from '../i18n/I18nProvider';
import { saveUiLocale } from '../i18n/locale-preference';
import type { UiLocale } from '../i18n/strings';
import { Banner, Body, Button, Screen, Title } from '../ui/primitives';
import { createAppServices, type AppServices } from './app-services';
import { ServicesProvider, type ServicesContextValue } from './ServicesProvider';

/**
 * App bootstrap: resolves the API configuration, opens secure storage, restores the session and wires foreground
 * refetching. Nothing here requests a permission, starts a background task or initialises a driver-only service.
 */
type Boot = { readonly kind: 'loading' } | { readonly kind: 'failed' } | { readonly kind: 'ready'; readonly services: AppServices };

export function AppRoot({ children }: { readonly children: ReactNode }) {
  const config = useMemo(() => resolveApiConfig(Constants.expoConfig?.extra, __DEV__), []);
  if (config.kind !== 'configured') {
    return (
      <I18nProvider locale="en">
        <NotConfigured invalid={config.kind === 'invalid'} />
      </I18nProvider>
    );
  }
  return <Bootstrapped baseUrl={config.baseUrl}>{children}</Bootstrapped>;
}

function Bootstrapped({ baseUrl, children }: { readonly baseUrl: string; readonly children: ReactNode }) {
  const [boot, setBoot] = useState<Boot>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [locale, setLocale] = useState<UiLocale>('en');

  useEffect(() => {
    let active = true;
    createAppServices(baseUrl, Constants.expoConfig?.version).then(
      (services) => {
        if (!active) return;
        setLocale(services.initialLocale);
        setBoot({ kind: 'ready', services });
      },
      () => {
        if (active) setBoot({ kind: 'failed' });
      },
    );
    return () => {
      active = false;
    };
  }, [baseUrl, attempt]);

  // Queries refetch (and the account state is re-checked) whenever the app returns to the foreground.
  useEffect(() => {
    focusManager.setEventListener((handleFocus) => {
      const subscription = AppState.addEventListener('change', (state) => {
        handleFocus(state === 'active');
      });
      return () => {
        subscription.remove();
      };
    });
  }, []);

  const services = boot.kind === 'ready' ? boot.services : null;
  // Remembering the language on the device is a convenience (resolves false if it could not be stored): the in-memory
  // choice applies either way, and a signed-in account's server preference is authoritative on the next start.
  const setUiLocale = useCallback(
    (next: UiLocale): Promise<boolean> => {
      setLocale(next);
      return services
        ? saveUiLocale(services.store, next).then(
            () => true,
            () => false,
          )
        : Promise.resolve(false);
    },
    [services],
  );
  const value = useMemo<ServicesContextValue | null>(() => (services ? { ...services, setUiLocale } : null), [services, setUiLocale]);

  if (boot.kind !== 'ready' || value === null) {
    return (
      <I18nProvider locale={locale}>
        <Starting
          failed={boot.kind === 'failed'}
          onRetry={() => {
            setBoot({ kind: 'loading' });
            setAttempt((n) => n + 1);
          }}
        />
      </I18nProvider>
    );
  }
  return (
    <ServicesProvider value={value}>
      <QueryClientProvider client={value.queryClient}>
        <I18nProvider locale={locale}>
          <StatusBar style="dark" />
          {children}
        </I18nProvider>
      </QueryClientProvider>
    </ServicesProvider>
  );
}

function Starting({ failed, onRetry }: { readonly failed: boolean; readonly onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <Screen scroll={false}>
      <Title>{t('appName')}</Title>
      {failed ? (
        <>
          <Banner tone="error" text={t('startup.storageError')} />
          <Button label={t('common.retry')} onPress={onRetry} />
        </>
      ) : (
        <Body muted>{t('startup.loading')}</Body>
      )}
    </Screen>
  );
}

function NotConfigured({ invalid }: { readonly invalid: boolean }) {
  const { t } = useI18n();
  return (
    <Screen scroll={false}>
      <Title>{t('config.title')}</Title>
      <Banner tone="warning" text={t(invalid ? 'config.invalid' : 'config.unconfigured')} />
    </Screen>
  );
}
