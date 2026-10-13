import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { contentDirection } from '../i18n/bidi';
import { useI18n } from '../i18n/I18nProvider';
import type { StringKey } from '../i18n/strings';
import { livePoliteness, spokenSentence, type Announcement } from './a11y';
import { colors, MIN_TOUCH_TARGET, spacing, tonePairs, typography } from './tokens';
import type { UiErrorView } from './view-state';

/**
 * Reusable presentation primitives (tokens only, no business rules). Direction-aware: Urdu renders right-to-left via
 * text alignment/writing direction and mirrored rows, without forcing a global RTL restart.
 */

/**
 * Direction helpers for the current UI language (RTL per component; no global forceRTL). `text` is for catalogue copy
 * in the UI language; `content(text)` is for server text in any script (addresses, place names): it aligns with the UI
 * language but sets the writing direction from the text itself (`bidi.ts`), so mixed-script rows render correctly.
 */
export function useDirection() {
  const { rtl } = useI18n();
  return {
    rtl,
    text: rtl ? styles.textRtl : styles.textLtr,
    row: rtl ? styles.rowRtl : styles.rowLtr,
    content: (text: string) => [
      rtl ? styles.alignRight : styles.alignLeft,
      contentDirection(text, rtl ? 'rtl' : 'ltr') === 'rtl' ? styles.writeRtl : styles.writeLtr,
    ],
  };
}

/**
 * Screen container. It ends every screen with the "translation pending native-speaker review" note, so Urdu and Roman
 * Urdu copy is never shown without it (P18; FA-09) — screens do not add the note themselves. `topInset`: a screen drawn
 * without a navigation header (the release blocking overlay) also insets the status bar.
 */
export function Screen({
  children,
  scroll = true,
  topInset = false,
}: {
  readonly children: ReactNode;
  readonly scroll?: boolean;
  readonly topInset?: boolean;
}) {
  return (
    <SafeAreaView style={styles.safe} edges={topInset ? ['top', 'bottom', 'left', 'right'] : ['bottom', 'left', 'right']}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {children}
          <TranslationPendingNote />
        </ScrollView>
      ) : (
        <View style={[styles.content, styles.fill]}>
          {children}
          <TranslationPendingNote />
        </View>
      )}
    </SafeAreaView>
  );
}

export function Title({ children }: { readonly children: string }) {
  const dir = useDirection();
  return (
    <Text style={[styles.title, dir.text]} accessibilityRole="header">
      {children}
    </Text>
  );
}

export function Heading({ children }: { readonly children: string }) {
  const dir = useDirection();
  return (
    <Text style={[styles.heading, dir.text]} accessibilityRole="header">
      {children}
    </Text>
  );
}

export function Body({ children, muted = false }: { readonly children: string; readonly muted?: boolean }) {
  const dir = useDirection();
  return <Text style={[styles.body, muted ? styles.muted : undefined, dir.text]}>{children}</Text>;
}

type ButtonVariant = 'primary' | 'secondary' | 'danger';

export function Button(props: {
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: ButtonVariant;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly busyLabel?: string;
  /** Stable locator for the SP-08 Maestro flows (ADR-052): locale-independent, never user-visible. */
  readonly testID?: string;
}) {
  const { variant = 'primary', disabled = false, busy = false } = props;
  const inactive = disabled || busy;
  const label = busy && props.busyLabel !== undefined ? props.busyLabel : props.label;
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' ? styles.buttonPrimary : variant === 'danger' ? styles.buttonDanger : styles.buttonSecondary,
        inactive ? styles.buttonDisabled : undefined,
        pressed && !inactive ? styles.pressed : undefined,
      ]}
    >
      {busy ? <ActivityIndicator color={variant === 'secondary' ? colors.primary : colors.onPrimary} /> : null}
      <Text style={[styles.buttonText, variant === 'secondary' ? styles.buttonTextSecondary : styles.buttonTextOnFill]}>{label}</Text>
    </Pressable>
  );
}

/**
 * A navigable row. `glyph` is an optional status mark drawn before the label; it is decorative (hidden from screen
 * readers), so the meaning must also be in `label`/`detail` text — never the glyph or colour alone.
 */
export function LinkRow({
  label,
  onPress,
  detail,
  glyph,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly detail?: string;
  readonly glyph?: string;
}) {
  const dir = useDirection();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={spokenSentence([label, detail])}
      onPress={onPress}
      style={({ pressed }) => [styles.linkRow, dir.row, pressed ? styles.pressed : undefined]}
    >
      {glyph === undefined ? null : (
        <Text style={styles.glyph} importantForAccessibility="no" accessibilityElementsHidden>
          {glyph}
        </Text>
      )}
      <View style={styles.fill}>
        <Text style={[styles.body, dir.text]}>{label}</Text>
        {detail === undefined ? null : <Text style={[styles.caption, styles.muted, dir.text]}>{detail}</Text>}
      </View>
      <Text style={styles.chevron} importantForAccessibility="no">
        {dir.rtl ? '‹' : '›'}
      </Text>
    </Pressable>
  );
}

export function TextField(
  props: {
    readonly label: string;
    readonly value: string;
    readonly onChangeText: (value: string) => void;
    readonly hint?: string;
    readonly error?: string | null;
  } & Pick<
    TextInputProps,
    'keyboardType' | 'autoComplete' | 'textContentType' | 'maxLength' | 'editable' | 'onSubmitEditing' | 'autoFocus' | 'multiline' | 'onFocus' | 'testID'
  >,
) {
  const dir = useDirection();
  const { label, hint, error, value, onChangeText, ...inputProps } = props;
  const describedBy = [hint, error ?? undefined].filter((s): s is string => s !== undefined).join('. ');
  return (
    <View style={styles.field}>
      <Text style={[styles.label, dir.text]}>{label}</Text>
      <TextInput
        {...inputProps}
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={label}
        accessibilityHint={describedBy === '' ? undefined : describedBy}
        style={[
          styles.input,
          dir.text,
          props.multiline === true ? styles.inputMultiline : undefined,
          error ? styles.inputError : undefined,
          props.editable === false ? styles.inputDisabled : undefined,
        ]}
        textAlignVertical={props.multiline === true ? 'top' : 'center'}
        placeholderTextColor={colors.textMuted}
      />
      {hint === undefined ? null : <Text style={[styles.caption, styles.muted, dir.text]}>{hint}</Text>}
      {error ? (
        <Text style={[styles.caption, styles.errorText, dir.text]} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function Checkbox({ label, checked, onChange }: { readonly label: string; readonly checked: boolean; readonly onChange: (next: boolean) => void }) {
  const dir = useDirection();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={() => {
        onChange(!checked);
      }}
      style={[styles.choiceRow, dir.row]}
    >
      <View style={[styles.box, checked ? styles.boxChecked : undefined]}>{checked ? <Text style={styles.boxMark}>✓</Text> : null}</View>
      <Text style={[styles.body, styles.fill, dir.text]}>{label}</Text>
    </Pressable>
  );
}

export function RadioGroup<V extends string>(props: {
  readonly label: string;
  readonly options: readonly { readonly value: V; readonly label: string }[];
  readonly value: V;
  readonly onChange: (value: V) => void;
  readonly disabled?: boolean;
}) {
  const dir = useDirection();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={props.label} style={styles.field}>
      <Text style={[styles.label, dir.text]}>{props.label}</Text>
      {props.options.map((option) => {
        const selected = option.value === props.value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: selected, disabled: props.disabled === true }}
            disabled={props.disabled}
            onPress={() => {
              props.onChange(option.value);
            }}
            style={[styles.choiceRow, dir.row]}
          >
            <View style={[styles.radio, selected ? styles.radioSelected : undefined]} />
            <Text style={[styles.body, styles.fill, dir.text]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Banner variants; their colour pairs are the contrast-tested `tonePairs` tokens. */
export type BannerTone = keyof typeof tonePairs;

const bannerLook = (tone: BannerTone) => ({ box: { backgroundColor: tonePairs[tone].background }, text: { color: tonePairs[tone].text } });

/**
 * A status message. `announce` says how a screen reader is told about it (`a11y.ts`): ordinary status text is polite;
 * a just-expired quote or a blocking policy state is assertive (announced once — the text does not change while shown).
 */
export function Banner({ tone, text, announce = 'status' }: { readonly tone: BannerTone; readonly text: string; readonly announce?: Announcement }) {
  const dir = useDirection();
  const look = bannerLook(tone);
  return (
    <View style={[styles.banner, look.box]} accessibilityRole={tone === 'error' ? 'alert' : 'text'} accessibilityLiveRegion={livePoliteness(announce)}>
      <Text style={[styles.body, look.text, dir.text]}>{text}</Text>
    </View>
  );
}

/** Visible label for texts that are not counsel-approved (`PLACEHOLDER_NOT_FOR_PRODUCTION`). */
export function PlaceholderBadge() {
  const { t } = useI18n();
  return <Banner tone="warning" text={t('common.placeholderNotice')} />;
}

/**
 * Note shown in Urdu/Roman-Urdu while translations await native review. `Screen` renders it on every screen; only a
 * full-bleed view that cannot use `Screen` (the camera) renders it itself.
 */
export function TranslationPendingNote() {
  const { t, pendingReview } = useI18n();
  return pendingReview ? <Body muted>{t('common.translationPending')}</Body> : null;
}

export function ErrorBanner({ error }: { readonly error: UiErrorView }) {
  const { t } = useI18n();
  return <Banner tone="error" text={t(error.messageKey, error.params)} />;
}

/**
 * Full-screen loading / error / empty states. Retryable errors offer "Try again"; a session-expired error needs no button
 * because the session layer has already signed out and the account gate redirects to sign-in.
 */
export function StateView(props: {
  readonly state: { readonly kind: 'loading' } | { readonly kind: 'error'; readonly error: UiErrorView } | { readonly kind: 'empty' };
  readonly onRetry: () => void;
  readonly emptyKey: StringKey;
}) {
  const { t } = useI18n();
  const { state } = props;
  if (state.kind === 'loading') {
    return (
      <View style={styles.centered} accessibilityLabel={t('common.loading')} accessibilityLiveRegion="polite">
        <ActivityIndicator size="large" color={colors.primary} />
        <Body muted>{t('common.loading')}</Body>
      </View>
    );
  }
  if (state.kind === 'empty') {
    return (
      <View style={styles.centered}>
        <Body muted>{t(props.emptyKey)}</Body>
      </View>
    );
  }
  const { error } = state;
  return (
    <View style={styles.centered}>
      <ErrorBanner error={error} />
      {error.action === 'retry' ? <Button label={t('common.retry')} onPress={props.onRetry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
  fill: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', gap: spacing.md, paddingVertical: spacing.xl },
  textLtr: { textAlign: 'left', writingDirection: 'ltr' },
  textRtl: { textAlign: 'right', writingDirection: 'rtl' },
  alignLeft: { textAlign: 'left' },
  alignRight: { textAlign: 'right' },
  writeLtr: { writingDirection: 'ltr' },
  writeRtl: { writingDirection: 'rtl' },
  rowLtr: { flexDirection: 'row' },
  rowRtl: { flexDirection: 'row-reverse' },
  title: { ...typography.title, color: colors.text },
  heading: { ...typography.heading, color: colors.text },
  body: { ...typography.body, color: colors.text, lineHeight: 24 },
  caption: { ...typography.caption, color: colors.text, lineHeight: 20 },
  muted: { color: colors.textMuted },
  label: { ...typography.caption, fontWeight: '600', color: colors.text },
  field: { gap: spacing.xs },
  input: {
    minHeight: MIN_TOUCH_TARGET,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    fontSize: 18,
    color: colors.text,
    backgroundColor: colors.background,
  },
  inputMultiline: { minHeight: MIN_TOUCH_TARGET * 3, paddingVertical: spacing.sm, fontSize: 16 },
  inputError: { borderColor: colors.danger },
  inputDisabled: { backgroundColor: colors.surface, color: colors.textMuted },
  errorText: { color: colors.danger },
  button: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: 8,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  buttonPrimary: { backgroundColor: colors.primary },
  buttonDanger: { backgroundColor: colors.danger },
  buttonSecondary: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.primary },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { ...typography.body, fontWeight: '600' },
  buttonTextOnFill: { color: colors.onPrimary },
  buttonTextSecondary: { color: colors.primary },
  pressed: { opacity: 0.8 },
  linkRow: {
    minHeight: MIN_TOUCH_TARGET + 8,
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  chevron: { fontSize: 24, color: colors.textMuted },
  glyph: { ...typography.body, fontWeight: '700', minWidth: 20, textAlign: 'center', color: colors.text },
  choiceRow: { minHeight: MIN_TOUCH_TARGET, alignItems: 'center', gap: spacing.md },
  box: { width: 28, height: 28, borderRadius: 6, borderWidth: 2, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  boxChecked: { backgroundColor: colors.primary },
  boxMark: { color: colors.onPrimary, fontSize: 18, fontWeight: '700' },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.primary },
  radioSelected: { backgroundColor: colors.primary },
  banner: { borderRadius: 8, padding: spacing.md },
});
