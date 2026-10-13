/**
 * The one connection to the backend.
 *
 * Everything that talks to Supabase imports this client rather than making its
 * own, so there is a single place session handling and configuration live.
 *
 * The session is kept in the device keychain rather than plain storage: it is
 * a credential, and on a phone that is shared or lost the difference matters.
 * On web there is no keychain, so the browser's own storage is used and the
 * adapter below quietly steps aside.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Supabase is not configured. Copy .env.example to .env and fill in the ' +
      'project URL and anon key from your Supabase dashboard, then restart ' +
      'the dev server so Expo picks the values up.'
  );
}

/**
 * SecureStore refuses values over 2048 bytes, and a session with a long JWT
 * can exceed that, so anything too large falls back to AsyncStorage. The
 * fallback is the same place the session would have lived without SecureStore
 * at all, so this degrades rather than breaking.
 */
const secureAdapter = {
  getItem: async (key: string) => {
    const fromSecure = await SecureStore.getItemAsync(key).catch(() => null);
    return fromSecure ?? AsyncStorage.getItem(key);
  },
  setItem: async (key: string, value: string) => {
    if (value.length > 2000) return AsyncStorage.setItem(key, value);
    await SecureStore.setItemAsync(key, value).catch(() => AsyncStorage.setItem(key, value));
  },
  removeItem: async (key: string) => {
    await SecureStore.deleteItemAsync(key).catch(() => {});
    await AsyncStorage.removeItem(key);
  },
};

export const supabase = createClient(url, anonKey, {
  auth: {
    storage: Platform.OS === 'web' ? undefined : secureAdapter,
    autoRefreshToken: true,
    persistSession: true,
    // Expo has no URL bar to read a session out of, and leaving this on makes
    // the client look for one on every start.
    detectSessionInUrl: false,
  },
});
