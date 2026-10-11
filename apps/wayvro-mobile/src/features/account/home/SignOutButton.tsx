import { useMutation } from '@tanstack/react-query';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { useServices } from '../../../core/services/ServicesProvider';
import { confirmDestructive } from '../../../core/ui/confirm';
import { Button } from '../../../core/ui/primitives';

/**
 * Sign out with confirmation. Local tokens and installation-scoped data are wiped even when the server cannot be
 * reached; the sign-in screen then says so. The account gate redirects to sign-in when the session state changes.
 */
export function SignOutButton() {
  const { client, signInFlow } = useServices();
  const { t } = useI18n();
  const signOut = useMutation({
    mutationFn: () => client.signOut(),
    onSuccess: ({ serverConfirmed }) => {
      signInFlow.setNotice(serverConfirmed ? null : 'signed-out-local-only');
    },
  });
  return (
    <Button
      variant="secondary"
      label={t('common.signOut')}
      busyLabel={t('common.signingOut')}
      busy={signOut.isPending}
      onPress={() => {
        void confirmDestructive({
          title: t('home.signOutConfirmTitle'),
          body: t('home.signOutConfirmBody'),
          confirm: t('common.signOut'),
          cancel: t('common.cancel'),
        }).then((confirmed) => {
          if (confirmed) signOut.mutate();
        });
      }}
    />
  );
}
