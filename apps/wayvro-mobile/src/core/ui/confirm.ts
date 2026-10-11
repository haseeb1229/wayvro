import { Alert } from 'react-native';

/**
 * Destructive-action confirmation via the platform dialog (accessible, focus-managed by the OS). Resolves true only
 * when the user explicitly confirms; dismissing the dialog cancels.
 */
export function confirmDestructive(copy: {
  readonly title: string;
  readonly body: string;
  readonly confirm: string;
  readonly cancel: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      copy.title,
      copy.body,
      [
        {
          text: copy.cancel,
          style: 'cancel',
          onPress: () => {
            resolve(false);
          },
        },
        {
          text: copy.confirm,
          style: 'destructive',
          onPress: () => {
            resolve(true);
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => {
          resolve(false);
        },
      },
    );
  });
}
