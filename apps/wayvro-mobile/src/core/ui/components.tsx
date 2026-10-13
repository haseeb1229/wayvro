import { useEffect, type ReactNode } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import { useDirection } from './primitives';
import { colors, elevation, MIN_TOUCH_TARGET, radii, spacing, typography } from './tokens';

/**
 * Phase-3 presentational components (UX doc §13). Tokens only, no business rules: every label, amount, countdown text
 * and spoken sentence is assembled by a tested view-state adapter and passed in ready to render. Direction-aware rows
 * (Urdu right-to-left per component); amounts stay left-to-right runs.
 */

export function Card({ children, label }: { readonly children: ReactNode; readonly label?: string }) {
  return (
    <View style={styles.card} accessible={label !== undefined} {...(label === undefined ? {} : { accessibilityLabel: label })}>
      {children}
    </View>
  );
}

export function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  const dir = useDirection();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, dir.text]} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

/** Static loading placeholder row (no shimmer animation; reduced-motion safe). Hidden from screen readers. */
export function SkeletonRow({ wide = true }: { readonly wide?: boolean }) {
  return (
    <View
      style={[styles.skeleton, wide ? styles.skeletonWide : styles.skeletonNarrow]}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    />
  );
}

/** One place suggestion: landmark line, area line, optional Urdu-script line; reads as one element. */
export function PlaceRow(props: {
  readonly primary: string;
  readonly secondary: string | null;
  readonly urdu?: string | null;
  readonly glyph: string;
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
}) {
  const dir = useDirection();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: props.disabled === true }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [styles.placeRow, dir.row, pressed ? styles.pressed : undefined]}
    >
      <Text style={styles.glyph} importantForAccessibility="no" accessibilityElementsHidden>
        {props.glyph}
      </Text>
      <View style={styles.fill}>
        <Text style={[styles.body, dir.text]}>{props.primary}</Text>
        {props.secondary === null ? null : <Text style={[styles.caption, styles.muted, dir.text]}>{props.secondary}</Text>}
        {props.urdu === undefined || props.urdu === null ? null : <Text style={[styles.caption, styles.muted, styles.textRtl]}>{props.urdu}</Text>}
      </View>
    </Pressable>
  );
}

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

const CONFIDENCE_LOOK: Readonly<Record<ConfidenceLevel, { readonly bg: string; readonly fg: string; readonly glyph: string }>> = {
  HIGH: { bg: colors.confidenceHighBackground, fg: colors.confidenceHighText, glyph: '●●●' },
  MEDIUM: { bg: colors.confidenceMediumBackground, fg: colors.confidenceMediumText, glyph: '●●○' },
  LOW: { bg: colors.confidenceLowBackground, fg: colors.confidenceLowText, glyph: '●○○' },
  UNKNOWN: { bg: colors.confidenceUnknownBackground, fg: colors.confidenceUnknownText, glyph: '○○○' },
};

/** Route confidence as text plus a shape (never colour alone). */
export function ConfidenceBadge({ level, text }: { readonly level: ConfidenceLevel; readonly text: string }) {
  const look = CONFIDENCE_LOOK[level];
  return (
    <View style={[styles.badge, { backgroundColor: look.bg }]} accessible accessibilityLabel={text}>
      <Text style={[styles.captionStrong, { color: look.fg }]} importantForAccessibility="no">{`${look.glyph} ${text}`}</Text>
    </View>
  );
}

/** "Updated 12 min ago" / "Couldn't refresh" — polite live region so changes are announced once. */
export function StaleIndicator({ text }: { readonly text: string }) {
  const dir = useDirection();
  return (
    <View style={styles.stale} accessibilityLiveRegion="polite">
      <Text style={[styles.caption, styles.staleText, dir.text]}>{text}</Text>
    </View>
  );
}

/**
 * Countdown text (already computed on the server-offset clock by the adapter). The visible text changes every second,
 * but screen readers hear only `announcement` — set at the thresholds (60 s, expiry), never every second.
 */
export function Countdown({ text, announcement }: { readonly text: string; readonly announcement: string | null }) {
  useEffect(() => {
    if (announcement !== null) AccessibilityInfo.announceForAccessibility(announcement);
  }, [announcement]);
  return (
    <Text style={[styles.captionStrong, styles.ltr]} importantForAccessibility="no">
      {text}
    </Text>
  );
}

/** One quote option (or an unavailable product) as ONE focusable element whose spoken label the adapter assembles. */
export function QuoteOptionCard(props: {
  readonly title: string;
  readonly lines: readonly string[];
  readonly price: string | null;
  readonly countdown?: ReactNode;
  readonly expired: boolean;
  readonly label: string;
  readonly detailsLabel?: string;
  readonly onDetails?: () => void;
}) {
  const dir = useDirection();
  const body = (
    <>
      <View style={[styles.cardHeader, dir.row]}>
        <Text style={[styles.heading, styles.fill, dir.text, props.expired ? styles.muted : undefined]}>{props.title}</Text>
        {props.price === null ? null : <Text style={[styles.price, styles.ltr, props.expired ? styles.expiredPrice : undefined]}>{props.price}</Text>}
      </View>
      {props.lines.map((line) => (
        <Text key={line} style={[styles.caption, styles.muted, dir.text]}>
          {line}
        </Text>
      ))}
      {props.countdown ?? null}
      {props.detailsLabel === undefined ? null : <Text style={[styles.link, dir.text]}>{props.detailsLabel}</Text>}
    </>
  );
  if (props.onDetails === undefined) {
    return (
      <View style={styles.card} accessible accessibilityLabel={props.label}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onDetails}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : undefined]}
    >
      {body}
    </Pressable>
  );
}

/** Ordered "label, amount" rows exactly as the server sent them, total last. Amounts align with tabular figures. */
export function FareBreakdown({
  rows,
  total,
}: {
  readonly rows: readonly { readonly key: string; readonly label: string; readonly amount: string }[];
  readonly total: { readonly label: string; readonly amount: string };
}) {
  const dir = useDirection();
  return (
    <View accessibilityRole="list" style={styles.fare}>
      {rows.map((row) => (
        <View key={row.key} style={[styles.fareRow, dir.row]} accessible accessibilityLabel={`${row.label}, ${row.amount}`}>
          <Text style={[styles.body, styles.fill, dir.text]}>{row.label}</Text>
          <Text style={[styles.body, styles.tabular, styles.ltr]}>{row.amount}</Text>
        </View>
      ))}
      <View style={[styles.fareRow, styles.fareTotal, dir.row]} accessible accessibilityLabel={`${total.label}, ${total.amount}`}>
        <Text style={[styles.heading, styles.fill, dir.text]}>{total.label}</Text>
        <Text style={[styles.price, styles.ltr]}>{total.amount}</Text>
      </View>
    </View>
  );
}

/**
 * Two-segment Rider / Driver/Partner control. It only asks to switch: the mode layer refetches server state and decides,
 * so the control never implies permission. A disabled segment carries its reason text.
 */
export function ModeSwitch(props: {
  readonly value: 'RIDER' | 'DRIVER';
  readonly riderLabel: string;
  readonly driverLabel: string;
  readonly switchToRiderLabel: string;
  readonly switchToDriverLabel: string;
  readonly busy: boolean;
  readonly onSelect: (mode: 'RIDER' | 'DRIVER') => void;
}) {
  const dir = useDirection();
  const segment = (mode: 'RIDER' | 'DRIVER', text: string, spoken: string) => {
    const selected = props.value === mode;
    return (
      <Pressable
        key={mode}
        accessibilityRole="tab"
        accessibilityLabel={selected ? text : spoken}
        accessibilityState={{ selected, disabled: props.busy, busy: props.busy }}
        disabled={props.busy || selected}
        onPress={() => {
          props.onSelect(mode);
        }}
        style={[styles.segment, selected ? styles.segmentSelected : undefined]}
      >
        <Text style={[styles.captionStrong, selected ? styles.segmentTextSelected : styles.segmentText]}>{text}</Text>
      </Pressable>
    );
  };
  return (
    <View accessibilityRole="tablist" style={[styles.segments, dir.row]}>
      {segment('RIDER', props.riderLabel, props.switchToRiderLabel)}
      {segment('DRIVER', props.driverLabel, props.switchToDriverLabel)}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  ltr: { writingDirection: 'ltr' },
  textRtl: { textAlign: 'right', writingDirection: 'rtl' },
  tabular: { fontVariant: ['tabular-nums'] },
  body: { ...typography.body, color: colors.text, lineHeight: 24 },
  heading: { ...typography.heading, color: colors.text },
  caption: { ...typography.caption, color: colors.text, lineHeight: 20 },
  captionStrong: { ...typography.captionStrong, color: colors.text },
  muted: { color: colors.textMuted },
  price: { ...typography.price, color: colors.priceText, fontVariant: ['tabular-nums'] },
  expiredPrice: { color: colors.textMuted, textDecorationLine: 'line-through' },
  link: { ...typography.captionStrong, color: colors.primary },
  pressed: { opacity: 0.8 },
  card: { ...elevation.card, backgroundColor: colors.background, borderRadius: radii.lg, padding: spacing.md, gap: spacing.xs, minHeight: MIN_TOUCH_TARGET },
  cardHeader: { alignItems: 'center', gap: spacing.sm },
  section: { gap: spacing.sm, paddingVertical: spacing.xs },
  sectionTitle: { ...typography.heading, color: colors.text },
  skeleton: { height: 16, borderRadius: radii.sm, backgroundColor: colors.surface, marginVertical: spacing.xs },
  skeletonWide: { width: '90%' },
  skeletonNarrow: { width: '55%' },
  placeRow: {
    minHeight: MIN_TOUCH_TARGET + 8,
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  glyph: { fontSize: 18, color: colors.textMuted, width: 24, textAlign: 'center' },
  badge: { borderRadius: radii.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, alignSelf: 'flex-start' },
  stale: { backgroundColor: colors.staleBackground, borderRadius: radii.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  staleText: { color: colors.staleText },
  fare: { gap: spacing.xs },
  fareRow: { minHeight: MIN_TOUCH_TARGET - 8, alignItems: 'center', gap: spacing.md },
  fareTotal: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, marginTop: spacing.xs },
  segments: { borderWidth: 1, borderColor: colors.primary, borderRadius: radii.md, overflow: 'hidden', alignSelf: 'stretch' },
  segment: { flex: 1, minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
  segmentSelected: { backgroundColor: colors.primary },
  segmentText: { color: colors.primary },
  segmentTextSelected: { color: colors.onPrimary },
});
