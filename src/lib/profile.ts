/**
 * Who somebody is, and how they are built.
 *
 * Height and ape index are not trivia here. They are the key the whole "show
 * me beta from someone my size" idea turns on, and later what personalises
 * what the AI says. A tall climber and a short one solve the same problem
 * differently, and watching the wrong one is worse than watching none.
 *
 * Which is why this is asked once, straight after signing up, rather than left
 * as a settings screen nobody opens. A library of videos whose climbers are
 * anonymous shapes cannot be matched against anything.
 */
import { supabase } from './supabase';

export type Profile = {
  id: string;
  display_name: string;
  handle: string | null;
  avatar_url: string | null;
  height_cm: number | null;
  ape_index_cm: number | null;
  weight_kg: number | null;
  /** Set once the question has been put to them, answered or declined. */
  onboarded_at: string | null;
  created_at: string;
};

/**
 * Whether to put the question. Asked once and only once.
 *
 * Deliberately not the same as having the measurements. Somebody who said no
 * has answered, and asking again every launch would make that answer
 * meaningless. The way back in is the profile screen, which says what they are
 * missing rather than nagging.
 */
export function needsOnboarding(p: Profile | null): boolean {
  return !!p && p.onboarded_at == null;
}

/**
 * Enough to match beta on. Wingspan is the one people leave blank, so it is
 * not required; height alone still narrows a list usefully.
 */
export function hasBodyStats(p: Profile | null): boolean {
  return !!p && p.height_cm != null;
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateProfile(
  userId: string,
  patch: Partial<
    Pick<
      Profile,
      'display_name' | 'handle' | 'height_cm' | 'ape_index_cm' | 'weight_kg' | 'onboarded_at'
    >
  >
): Promise<void> {
  const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
  if (error) throw new Error(friendly(error.message));
}

/**
 * Record that somebody was asked and said no.
 *
 * Nothing about their body is written, and the handle only goes in if it is
 * valid, since it was sitting prefilled in the field in front of them. Saying
 * no has to mean the app stops asking, or it was never a choice.
 */
export async function declineBodyStats(userId: string, handle: string): Promise<void> {
  await updateProfile(userId, {
    onboarded_at: new Date().toISOString(),
    ...(HANDLE_PATTERN.test(handle) ? { handle } : {}),
  });
}

function friendly(message: string) {
  // The unique index and the check constraint are the two a person can trip,
  // and neither says anything useful on its own.
  if (message.includes('profiles_handle_key')) {
    return 'Somebody already has that handle. Try another.';
  }
  if (message.includes('profiles_handle_check')) {
    return 'Handles are 3 to 20 characters, lower case letters, numbers and underscores.';
  }
  return message;
}

/** What a handle has to look like, matching the check constraint on the column. */
export const HANDLE_PATTERN = /^[a-z0-9_]{3,20}$/;

/** A first guess from an email address, so nobody starts from an empty field. */
export function suggestHandle(email: string): string {
  const base = email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 20);
  return base.length >= 3 ? base : `${base}climbs`.slice(0, 20);
}

// ---------------------------------------------------------------------------
// Units
//
// Stored in centimetres always, entered in whatever the person thinks in.
// Most climbers in the US know their height in feet and inches and would have
// to look up the conversion, which is exactly the kind of friction that ends
// with a blank field.
// ---------------------------------------------------------------------------

/** One choice covering both lengths and weight, since nobody mixes the two. */
export type Units = 'metric' | 'imperial';

export function cmToFtIn(cm: number): { feet: number; inches: number } {
  const total = Math.round(cm / 2.54);
  return { feet: Math.floor(total / 12), inches: total % 12 };
}

export function ftInToCm(feet: number, inches: number): number {
  return Math.round((feet * 12 + inches) * 2.54);
}

export function kgToLb(kg: number): number {
  return Math.round(kg * 2.20462);
}

export function lbToKg(lb: number): number {
  return Math.round(lb / 2.20462);
}

/**
 * Ape index is wingspan minus height, and it is what gets stored, because it
 * is the number that means something on a wall: +6 means your reach beats your
 * size, and that is what decides whether a move is a stretch or a jump.
 *
 * People know their wingspan, not their ape index, so the form asks for
 * wingspan and this does the subtraction.
 */
export function apeIndexFrom(heightCm: number, wingspanCm: number): number {
  return Math.round(wingspanCm - heightCm);
}

export function wingspanFrom(heightCm: number, apeIndexCm: number): number {
  return heightCm + apeIndexCm;
}

/** "+6 cm" or "−2 cm", with the sign, because the sign is the whole meaning. */
export function apeLabel(apeIndexCm: number | null): string {
  if (apeIndexCm == null) return '—';
  if (apeIndexCm === 0) return 'even';
  return `${apeIndexCm > 0 ? '+' : '−'}${Math.abs(apeIndexCm)} cm`;
}
