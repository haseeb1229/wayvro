import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { isRtl, t } from '../core/i18n/strings';

/**
 * App shell only (Phase 1). Mode switching, account state hydration and the Rider / Driver-Partner navigation graphs
 * arrive with their phases; nothing here requests a permission, starts a background task or calls a provider SDK.
 */
export function App() {
  return (
    <View style={styles.container} accessibilityRole="summary">
      <Text style={styles.title} accessibilityRole="header">
        {t('en', 'shellTitle')}
      </Text>
      <Text style={styles.body}>{t('en', 'shellBody')}</Text>
      <Text style={[styles.body, isRtl('ur') ? styles.rtl : undefined]}>{t('ur', 'shellTitle')}</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 22, fontWeight: '600', textAlign: 'center' },
  body: { fontSize: 16, textAlign: 'center' },
  rtl: { writingDirection: 'rtl' },
});
