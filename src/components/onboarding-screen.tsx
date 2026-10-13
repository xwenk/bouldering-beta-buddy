/**
 * The one thing asked before the app opens.
 *
 * Put here rather than into the sign up form for two reasons. The form runs
 * before there is a session, so there is nothing to write a profile with when
 * email confirmation is switched on. And this way it also catches accounts
 * made before the field existed, instead of leaving them permanently blank.
 *
 * It says why it is asking. A form that demands your height without a reason
 * gets a made up number, and a made up number is worse here than an empty one.
 */
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BodyDraft, BodyFields, bodyProblem } from '@/components/body-fields';
import { Button, useColors } from '@/components/ui-kit';
import { Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { apeIndexFrom, declineBodyStats, suggestHandle, updateProfile } from '@/lib/profile';

export default function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const c = useColors();
  const { user, signOut } = useAuth();

  const [draft, setDraft] = useState<BodyDraft>({
    handle: suggestHandle(user?.email ?? ''),
    heightCm: null,
    wingspanCm: null,
    weightKg: null,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    if (!user) return;
    const problem = bodyProblem(draft);
    if (problem) {
      setError(problem);
      return;
    }

    setBusy(true);
    setError('');
    try {
      await updateProfile(user.id, {
        // Empty means no handle rather than an empty string, which the unique
        // index would let exactly one person have.
        handle: draft.handle || null,
        height_cm: draft.heightCm,
        ape_index_cm:
          draft.wingspanCm != null && draft.heightCm != null
            ? apeIndexFrom(draft.heightCm, draft.wingspanCm)
            : null,
        weight_kg: draft.weightKg,
        onboarded_at: new Date().toISOString(),
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * No is a real answer, and it has to stick. Nothing about their body is
   * written and the app never asks again; the profile screen is where they can
   * change their mind.
   */
  async function decline() {
    if (!user) return;
    setBusy(true);
    setError('');
    try {
      await declineBodyStats(user.id, draft.handle);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ padding: Spacing.four, gap: Spacing.three }}
          keyboardShouldPersistTaps="handled">
          <View style={{ gap: Spacing.two, marginBottom: Spacing.two }}>
            <Text style={{ color: c.text, fontSize: 26, fontWeight: '800' }}>
              How you are built
            </Text>
            <Text style={{ color: c.textSecondary, fontSize: 15, lineHeight: 22 }}>
              Beta from someone built like you is different beta. A move that is a reach for one
              climber is a jump for another, and watching the wrong one wastes a session.
            </Text>
            <Text style={{ color: c.textSecondary, fontSize: 15, lineHeight: 22 }}>
              3B uses these to pick which videos to show you, and later to make what it tells you
              about your own climbing yours rather than generic. Nobody else sees them next to your
              name.
            </Text>
          </View>

          <BodyFields value={draft} onChange={setDraft} />

          {error ? (
            <View
              style={{ backgroundColor: c.fallSoft, borderRadius: Radius.md, padding: Spacing.three }}>
              <Text style={{ color: c.fall, fontSize: 14 }}>{error}</Text>
            </View>
          ) : null}

          {busy ? (
            <ActivityIndicator color={c.accent} style={{ paddingVertical: 14 }} />
          ) : (
            <>
              <Button label="Done" onPress={save} />

              {/* A quieter button, not a hidden one. Somebody who does not want
                  to give their measurements should be able to say so and be
                  believed, not worn down by being asked again next launch. */}
              <Pressable
                onPress={decline}
                style={{ paddingVertical: Spacing.two, alignItems: 'center' }}>
                <Text style={{ color: c.textSecondary, fontSize: 15 }}>
                  I would rather not say
                </Text>
                <Text
                  style={{
                    color: c.textFaint,
                    fontSize: 12,
                    textAlign: 'center',
                    marginTop: 2,
                    paddingHorizontal: Spacing.three,
                    lineHeight: 17,
                  }}>
                  The app works without them. You just get beta sorted by what is popular rather
                  than by what will fit you.
                </Text>
              </Pressable>
            </>
          )}

          <Text style={{ color: c.textFaint, fontSize: 13, textAlign: 'center' }}>
            Either way, you can change this later on your profile.
          </Text>

          <Pressable onPress={signOut} style={{ paddingVertical: Spacing.two, alignItems: 'center' }}>
            <Text style={{ color: c.textFaint, fontSize: 14 }}>Sign out</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
