import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { SessionState } from '../session/session-manager';
import type { SignInNotice } from '../session/sign-in-flow';
import type { UiLocale } from '../i18n/strings';
import type { AppServices } from './app-services';

export interface ServicesContextValue extends AppServices {
  /** Changes the UI language immediately and remembers it on this device; resolves false if it could not be stored. */
  readonly setUiLocale: (locale: UiLocale) => Promise<boolean>;
}

const ServicesContext = createContext<ServicesContextValue | null>(null);

export function ServicesProvider({ value, children }: { readonly value: ServicesContextValue; readonly children: ReactNode }) {
  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>;
}

export function useServices(): ServicesContextValue {
  const value = useContext(ServicesContext);
  if (!value) throw new Error('useServices outside ServicesProvider');
  return value;
}

export function useSessionState(): SessionState {
  const { session } = useServices();
  return useSyncExternalStore(session.subscribe, session.getState);
}

export function useSignInChallenge() {
  const { signInFlow } = useServices();
  return useSyncExternalStore(signInFlow.subscribe, signInFlow.getChallenge);
}

export function useSignInNotice(): SignInNotice {
  const { signInFlow } = useServices();
  return useSyncExternalStore(signInFlow.subscribe, signInFlow.getNotice);
}
