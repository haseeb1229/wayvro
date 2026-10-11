import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { isRtl, PENDING_REVIEW_LOCALES, t as translate, type StringKey, type TranslationParams, type UiLocale } from './strings';

export interface I18n {
  readonly locale: UiLocale;
  readonly rtl: boolean;
  readonly pendingReview: boolean;
  readonly t: (key: StringKey, params?: TranslationParams) => string;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ locale, children }: { readonly locale: UiLocale; readonly children: ReactNode }) {
  const value = useMemo<I18n>(
    () => ({ locale, rtl: isRtl(locale), pendingReview: PENDING_REVIEW_LOCALES.has(locale), t: (key, params) => translate(locale, key, params) }),
    [locale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n outside I18nProvider');
  return value;
}
