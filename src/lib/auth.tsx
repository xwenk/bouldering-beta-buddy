/**
 * Who is signed in, for the whole app.
 *
 * One listener on the Supabase session rather than each screen asking, so
 * there is a single answer at any moment and signing out takes effect
 * everywhere at once.
 *
 * `ready` exists to separate "nobody is signed in" from "we have not looked
 * yet". Without it the app flashes the sign in screen on every cold start
 * while the stored session is being read off the device.
 */
import { Session, User } from '@supabase/supabase-js';
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';

import { supabase } from './supabase';

type AuthValue = {
  session: Session | null;
  user: User | null;
  ready: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });

    // Covers sign in, sign out, and the token refresh that happens on its own
    // roughly every hour, so nothing has to poll for it.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) throw new Error(friendly(error.message));
  }

  async function signUp(email: string, password: string, displayName: string) {
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      // Read by the handle_new_user trigger to fill in the profile row, so a
      // new account arrives with a name rather than being nameless until
      // somebody edits it.
      options: { data: { display_name: displayName.trim() } },
    });
    if (error) throw new Error(friendly(error.message));
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider
      value={{ session, user: session?.user ?? null, ready, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/**
 * Supabase error strings are written for developers. These are the few a
 * person will actually hit, rewritten to say what to do about it.
 */
function friendly(message: string) {
  if (message.includes('Invalid login credentials')) {
    return 'That email and password do not match an account.';
  }
  if (message.includes('User already registered')) {
    return 'There is already an account with that email. Try signing in.';
  }
  if (message.includes('Password should be')) {
    return 'Passwords need to be at least 6 characters.';
  }
  if (message.includes('Unable to validate email')) {
    return 'That does not look like an email address.';
  }
  return message;
}
