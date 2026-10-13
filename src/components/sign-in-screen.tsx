/**
 * Sign in and sign up, on one screen.
 *
 * Two screens for this would mean a person who picked wrong has to navigate
 * back out and in again, and the two forms differ by one field. Switching
 * modes keeps whatever has already been typed.
 */
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, useColors } from '@/components/ui-kit';
import { Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';

export default function SignInScreen() {
  const c = useColors();
  const { signIn, signUp } = useAuth();

  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const signingUp = mode === 'up';
  const canSubmit = email.includes('@') && password.length >= 6 && (!signingUp || name.trim());

  async function submit() {
    setBusy(true);
    setError('');
    try {
      if (signingUp) await signUp(email, password, name);
      else await signIn(email, password);
      // Nothing to navigate to: the session changes, and the root layout
      // swaps this screen out on its own.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const field = {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: 14,
    fontSize: 16,
    color: c.text,
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            padding: Spacing.four,
            gap: Spacing.three,
          }}
          keyboardShouldPersistTaps="handled">
          <View style={{ gap: Spacing.one, marginBottom: Spacing.three }}>
            <Text style={{ color: c.accent, fontSize: 40, fontWeight: '900', letterSpacing: -1 }}>
              3B
            </Text>
            <Text style={{ color: c.text, fontSize: 22, fontWeight: '700' }}>
              Bouldering Beta Buddy
            </Text>
            <Text style={{ color: c.textSecondary, fontSize: 15, lineHeight: 21 }}>
              Log what you climbed, keep the video, and find out what actually worked.
            </Text>
          </View>

          {signingUp ? (
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="What should we call you"
              placeholderTextColor={c.textFaint}
              autoCapitalize="words"
              style={field}
            />
          ) : null}

          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor={c.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            style={field}
          />

          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={c.textFaint}
            secureTextEntry
            autoCapitalize="none"
            textContentType={signingUp ? 'newPassword' : 'password'}
            style={field}
          />

          {signingUp && password.length > 0 && password.length < 6 ? (
            <Text style={{ color: c.textFaint, fontSize: 13 }}>At least 6 characters.</Text>
          ) : null}

          {error ? (
            <View
              style={{
                backgroundColor: c.fallSoft,
                borderRadius: Radius.md,
                padding: Spacing.three,
              }}>
              <Text style={{ color: c.fall, fontSize: 14 }}>{error}</Text>
            </View>
          ) : null}

          {busy ? (
            <ActivityIndicator color={c.accent} style={{ paddingVertical: 14 }} />
          ) : (
            <Button
              label={signingUp ? 'Create account' : 'Sign in'}
              onPress={submit}
              disabled={!canSubmit}
            />
          )}

          <Pressable
            onPress={() => {
              setMode(signingUp ? 'in' : 'up');
              setError('');
            }}
            style={{ paddingVertical: Spacing.two, alignItems: 'center' }}>
            <Text style={{ color: c.textSecondary, fontSize: 15 }}>
              {signingUp ? 'Already have an account? Sign in' : 'New here? Create an account'}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
