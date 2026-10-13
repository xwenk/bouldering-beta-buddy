/**
 * The root of the app: theme, auth, and the choice between the sign in screen
 * and everything else.
 *
 * That choice lives here rather than as a redirect on each screen, so one
 * place decides what a signed out person sees and no screen can forget to
 * check.
 */
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, useColorScheme, View } from 'react-native';

import OnboardingScreen from '@/components/onboarding-screen';
import SignInScreen from '@/components/sign-in-screen';
import { Colors } from '@/constants/theme';
import { AuthProvider, useAuth } from '@/lib/auth';
import { getProfile, needsOnboarding } from '@/lib/profile';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const scheme = useColorScheme();
  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </ThemeProvider>
  );
}

function Gate() {
  const { session, user, ready } = useAuth();
  const scheme = useColorScheme();
  const c = Colors[scheme === 'dark' ? 'dark' : 'light'];

  // null while it is being fetched, which is a third state from "complete" and
  // "not yet filled in" and must not be mistaken for either.
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  // Held until the stored session has been read, so somebody coming back does
  // not see the sign in screen flash past on the way to their own data.
  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  const checkProfile = useCallback(() => {
    if (!user) {
      setOnboarded(null);
      return;
    }
    setOnboarded(null);
    getProfile(user.id)
      .then((p) => setOnboarded(!needsOnboarding(p)))
      // A profile that cannot be read is not a reason to trap somebody on a
      // form they have possibly already answered.
      .catch(() => setOnboarded(true));
  }, [user]);

  useEffect(checkProfile, [checkProfile]);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background, justifyContent: 'center' }}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }

  if (!session) return <SignInScreen />;

  if (onboarded === null) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background, justifyContent: 'center' }}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }

  // Put once, before anything else, because a library of videos whose climbers
  // are anonymous shapes cannot be matched against anybody, and nobody goes
  // looking for a settings screen to fix that later. Declining counts as
  // answering, so this does not come back either way.
  if (!onboarded) return <OnboardingScreen onDone={() => setOnboarded(true)} />;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: c.background },
        headerTintColor: c.text,
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: c.background },
      }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="gym/[id]" options={{ title: '' }} />
      <Stack.Screen name="route/[id]" options={{ title: '' }} />
      <Stack.Screen name="video/[id]" options={{ title: '' }} />
    </Stack>
  );
}
