/**
 * Your account, and how you are built.
 *
 * The build fields matter more here than an account screen usually warrants.
 * They decide which beta gets shown to you, so they are the first thing on the
 * screen rather than buried under a settings heading, and they read as a
 * summary until you tap to change them. People grow, measure themselves
 * properly the second time, or guess badly at sign up.
 */
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Text, TextInput, View } from 'react-native';

import { BodyDraft, BodyFields, bodyProblem, draftFrom } from '@/components/body-fields';
import { Button, Card, Row, Screen, SectionLabel, useColors } from '@/components/ui-kit';
import { Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import {
  apeIndexFrom,
  apeLabel,
  cmToFtIn,
  getProfile,
  hasBodyStats,
  kgToLb,
  Profile,
  updateProfile,
} from '@/lib/profile';

export default function MeScreen() {
  const c = useColors();
  const { user, signOut } = useAuth();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<BodyDraft | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!user) return;
    getProfile(user.id)
      .then((p) => {
        setProfile(p);
        if (p) setName(p.display_name);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load your profile.'));
  }, [user]);

  useFocusEffect(load);

  function startEditing() {
    if (!profile) return;
    setDraft(draftFrom(profile));
    setName(profile.display_name);
    setError('');
    setEditing(true);
  }

  async function save() {
    if (!user || !draft) return;
    const problem = bodyProblem(draft, { requireHeight: false });
    if (problem) {
      setError(problem);
      return;
    }
    if (!name.trim()) {
      setError('A name to show on your videos, even a short one.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await updateProfile(user.id, {
        display_name: name.trim(),
        handle: draft.handle || null,
        height_cm: draft.heightCm,
        ape_index_cm:
          draft.wingspanCm != null && draft.heightCm != null
            ? apeIndexFrom(draft.heightCm, draft.wingspanCm)
            : null,
        weight_kg: draft.weightKg,
      });
      setEditing(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  }

  const field = {
    backgroundColor: c.surfaceSunken,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: 14,
    fontSize: 16,
    color: c.text,
  };

  return (
    <Screen
      title={profile?.display_name || 'You'}
      subtitle={profile?.handle ? `@${profile.handle}` : (user?.email ?? '')}>
      {error ? (
        <View style={{ backgroundColor: c.fallSoft, borderRadius: Radius.md, padding: Spacing.three }}>
          <Text style={{ color: c.fall, fontSize: 14 }}>{error}</Text>
        </View>
      ) : null}

      {!profile ? (
        <ActivityIndicator color={c.accent} style={{ paddingVertical: Spacing.five }} />
      ) : editing && draft ? (
        <Card style={{ gap: Spacing.three }}>
          <SectionLabel>Name</SectionLabel>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="What should we call you"
            placeholderTextColor={c.textFaint}
            autoCapitalize="words"
            style={field}
          />

          <BodyFields value={draft} onChange={setDraft} />

          {busy ? (
            <ActivityIndicator color={c.accent} />
          ) : (
            <Row>
              <View style={{ flex: 1 }}>
                <Button label="Save" onPress={save} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="Cancel" variant="quiet" onPress={() => setEditing(false)} />
              </View>
            </Row>
          )}
        </Card>
      ) : !hasBodyStats(profile) ? (
        /* The door back in for anybody who said no at sign up. It says what
           they are missing rather than asking again, because they already
           answered and the answer was no. */
        <Card style={{ gap: Spacing.two }}>
          <Row>
            <Ionicons name="body-outline" size={20} color={c.textSecondary} />
            <Text style={{ color: c.text, fontSize: 15, fontWeight: '700', flex: 1 }}>
              Beta is sorted by popularity for you
            </Text>
          </Row>
          <Text style={{ color: c.textSecondary, fontSize: 14, lineHeight: 20 }}>
            Add your height and wingspan and 3B puts the climbers built like you first instead. A
            move that is a reach at one height is a jump at another.
          </Text>
          <Button label="Add them" variant="quiet" icon="add" onPress={startEditing} />
        </Card>
      ) : (
        <Card style={{ gap: Spacing.two }}>
          <Row>
            <SectionLabel>Your build</SectionLabel>
            <View style={{ flex: 1 }} />
            <Ionicons name="create-outline" size={18} color={c.textFaint} />
          </Row>
          <Row>
            <Text style={{ color: c.textSecondary, fontSize: 14, flex: 1 }}>Height</Text>
            <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>
              {profile.height_cm != null
                ? `${cmToFtIn(profile.height_cm).feet}′${cmToFtIn(profile.height_cm).inches}″  ·  ${
                    profile.height_cm
                  } cm`
                : 'not set'}
            </Text>
          </Row>
          <Row>
            <Text style={{ color: c.textSecondary, fontSize: 14, flex: 1 }}>Ape index</Text>
            <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>
              {profile.ape_index_cm != null ? apeLabel(profile.ape_index_cm) : 'not measured'}
            </Text>
          </Row>
          <Row>
            <Text style={{ color: c.textSecondary, fontSize: 14, flex: 1 }}>Weight</Text>
            <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>
              {profile.weight_kg != null
                ? `${kgToLb(profile.weight_kg)} lb  ·  ${profile.weight_kg} kg`
                : 'not given'}
            </Text>
          </Row>
          <Text style={{ color: c.textFaint, fontSize: 12, lineHeight: 17 }}>
            Height and reach pick beta from climbers built like you. Weight is only for what the
            analysis says about your own climbing. Neither is shown next to your name.
          </Text>
          <Button label="Change" variant="quiet" icon="create-outline" onPress={startEditing} />
        </Card>
      )}

      <Card>
        <SectionLabel>Account</SectionLabel>
        <View style={{ gap: Spacing.one }}>
          <Text style={{ color: c.text, fontSize: 15 }}>{user?.email}</Text>
          <Text style={{ color: c.textFaint, fontSize: 13 }}>
            Signed in since {new Date(user?.created_at ?? Date.now()).toLocaleDateString()}
          </Text>
        </View>
      </Card>

      <Button label="Sign out" variant="quiet" icon="log-out-outline" onPress={signOut} />
    </Screen>
  );
}
