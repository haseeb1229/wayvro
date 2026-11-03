import { useSyncExternalStore } from 'react';
import { View } from 'react-native';
import { useI18n } from '../i18n/I18nProvider';
import { useServices } from '../services/ServicesProvider';
import { Banner, Body, Button, Checkbox } from '../ui/primitives';
import type { LiteState } from './lite-mode';

export function useLiteMode(): LiteState {
  const { lite } = useServices();
  return useSyncExternalStore(lite.subscribe, lite.getState);
}

/** Manual Lite toggle (rider home and account hub). */
export function LiteToggle() {
  const { lite } = useServices();
  const { t } = useI18n();
  const state = useLiteMode();
  return (
    <View>
      <Checkbox
        label={t('lite.toggle')}
        checked={state.enabled}
        onChange={(next) => {
          void lite.setEnabled(next);
        }}
      />
      <Body muted>{t('lite.hint')}</Body>
    </View>
  );
}

/** Auto-SUGGESTION after slow requests — never switches Lite on by itself. */
export function LiteSuggestionBanner() {
  const { lite } = useServices();
  const { t } = useI18n();
  const state = useLiteMode();
  if (!state.suggested) return null;
  return (
    <View>
      <Banner tone="info" text={t('lite.suggest')} />
      <Button
        label={t('lite.turnOn')}
        onPress={() => {
          void lite.setEnabled(true);
        }}
      />
      <Button
        variant="secondary"
        label={t('common.notNow')}
        onPress={() => {
          lite.dismissSuggestion();
        }}
      />
    </View>
  );
}
