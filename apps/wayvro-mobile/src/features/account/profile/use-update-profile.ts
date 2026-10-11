import type { AccountState, Locale, ProfileUpdateRequest } from '@wayvro/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { QUERY_KEYS } from '../../../core/query/query-client';
import { useServices } from '../../../core/services/ServicesProvider';
import { errorView, type UiErrorView } from '../../../core/ui/view-state';

/**
 * PATCH /v1/account/profile. On success the server's profile is written into the cached account state (the account
 * gate then switches the UI language to the saved preference) and the state is re-fetched.
 */
export function useUpdateProfile() {
  const { client } = useServices();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (update: ProfileUpdateRequest) => client.updateProfile(update),
    onSuccess: async (profile) => {
      queryClient.setQueryData<AccountState>(QUERY_KEYS.accountState, (old) =>
        old ? { ...old, account: { ...old.account, displayName: profile.displayName, preferredLocale: profile.preferredLocale } } : old,
      );
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.accountState });
    },
  });
  const error: UiErrorView | null = mutation.isError ? errorView(mutation.error) : null;
  return { mutate: mutation.mutate, isPending: mutation.isPending, isSuccess: mutation.isSuccess, reset: mutation.reset, error };
}

export function useLocaleOptions(): readonly { readonly value: Locale; readonly label: string }[] {
  const { t } = useI18n();
  return [
    { value: 'en', label: t('language.en') },
    { value: 'ur', label: t('language.ur') },
    { value: 'ur-Latn', label: t('language.urLatn') },
  ];
}
