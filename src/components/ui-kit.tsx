/**
 * The small set of pieces every screen in 3B is built from.
 *
 * Defined once so a card on Progress is the same object as a card on Sessions.
 * Every colour comes from the theme rather than a literal, so light and dark
 * both work without each screen having to think about it.
 */
import { Ionicons } from '@expo/vector-icons';
import { ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors, Radius, Spacing } from '@/constants/theme';

export function useColors() {
  const scheme = useColorScheme();
  return Colors[scheme === 'dark' ? 'dark' : 'light'];
}

/** Page frame: safe area, background, scrolling body, room for the tab bar. */
export function Screen({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const c = useColors();
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.background }}>
      <ScrollView
        contentContainerStyle={{ padding: Spacing.three, paddingBottom: Spacing.six * 2, gap: Spacing.three }}
        showsVerticalScrollIndicator={false}>
        <View style={{ gap: 2, marginBottom: Spacing.one }}>
          <Text style={[styles.h1, { color: c.text }]}>{title}</Text>
          {subtitle ? <Text style={{ color: c.textSecondary, fontSize: 15 }}>{subtitle}</Text> : null}
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const c = useColors();
  return (
    <View
      style={[
        {
          backgroundColor: c.surface,
          borderColor: c.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: Radius.lg,
          padding: Spacing.three,
          gap: Spacing.two,
        },
        style,
      ]}>
      {children}
    </View>
  );
}

/** Small uppercase heading that labels a group without becoming a title. */
export function SectionLabel({ children }: { children: ReactNode }) {
  const c = useColors();
  return (
    <Text
      style={{
        color: c.textFaint,
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 1.1,
        textTransform: 'uppercase',
      }}>
      {children}
    </Text>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  tint,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  tint?: string;
}) {
  const c = useColors();
  const active = tint ?? c.accent;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: Spacing.three,
        paddingVertical: Spacing.two,
        borderRadius: Radius.pill,
        borderWidth: 1,
        borderColor: selected ? active : c.border,
        backgroundColor: selected ? active : c.surface,
        opacity: pressed ? 0.7 : 1,
      })}>
      <Text
        style={{
          color: selected ? '#FFFFFF' : c.textSecondary,
          fontWeight: selected ? '700' : '500',
          fontSize: 14,
        }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled,
}: {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'quiet';
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
}) {
  const c = useColors();
  const primary = variant === 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: Spacing.two,
        paddingVertical: 14,
        paddingHorizontal: Spacing.four,
        borderRadius: Radius.md,
        backgroundColor: primary ? c.accent : c.surfaceSunken,
        opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
      })}>
      {icon ? <Ionicons name={icon} size={18} color={primary ? '#FFFFFF' : c.text} /> : null}
      <Text style={{ color: primary ? '#FFFFFF' : c.text, fontWeight: '700', fontSize: 16 }}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Marks a screen that is designed but not built yet.
 *
 * Deliberately says what it will do and what is missing, rather than
 * "coming soon". A placeholder that explains itself is still information;
 * one that does not is just a dead end.
 */
export function NotBuiltYet({ what, why }: { what: string; why: string }) {
  const c = useColors();
  return (
    <View
      style={{
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: c.border,
        borderRadius: Radius.lg,
        padding: Spacing.four,
        gap: Spacing.two,
        alignItems: 'center',
      }}>
      <Ionicons name="construct-outline" size={22} color={c.textFaint} />
      <Text style={{ color: c.text, fontWeight: '700', fontSize: 15, textAlign: 'center' }}>
        {what}
      </Text>
      <Text style={{ color: c.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
        {why}
      </Text>
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
});
