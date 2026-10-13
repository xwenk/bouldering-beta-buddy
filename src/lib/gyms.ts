/**
 * Gyms: the shared directory, and the subset that is yours.
 *
 * Queries live in lib rather than inside screens so a screen is only about
 * what it shows, and a query two screens need is written once. Each function
 * throws on failure rather than returning an error to be checked, because a
 * screen that forgets the check renders an empty list and looks like the data
 * is gone.
 */
import { GradingSystemId, holdColor, holdHex } from '@/constants/climbing';

import { supabase } from './supabase';

export type Gym = {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  added_by: string | null;
  created_at: string;

  // Null until somebody has set the gym up. Everything about adding a route
  // depends on this, because until it is answered the app does not know what
  // a grade even looks like here.
  grading_system: GradingSystemId | null;
  set_up_by: string | null;
  set_up_at: string | null;
};

/** One rung of one gym's grade ladder. Position is difficulty order, easiest first. */
export type GymGrade = {
  id: string;
  gym_id: string;
  position: number;
  label: string;
  color_hex: string | null;
};

/** A named wall at a gym, in the order you meet them walking in. */
export type GymWall = {
  id: string;
  gym_id: string;
  name: string;
  position: number;
};

/** True once a gym can answer "what grade is this". */
export function isSetUp(gym: Gym | null | undefined): boolean {
  return !!gym?.grading_system;
}

export type MyGym = Gym & { last_visit: string | null };

/**
 * Two gyms are the same place if they share a name and sit close together.
 * Comparing coordinates to three decimals is roughly a hundred metre grid:
 * tight enough to keep two gyms in one town apart, loose enough that two
 * people adding the same gym from opposite ends of the car park agree.
 */
function samePlace(a: { name: string; lat: number | null }, b: { name: string; lat: number | null }) {
  if (a.name.trim().toLowerCase() !== b.name.trim().toLowerCase()) return false;
  if (a.lat == null || b.lat == null) return true;
  return Math.abs(a.lat - b.lat) < 0.003;
}

/** Every gym anybody has added. */
export async function listGyms(): Promise<Gym[]> {
  const { data, error } = await supabase.from('gyms').select('*').order('name');
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * The gyms on your list, most recently visited first, then the rest by name.
 * A gym you have been to this week should not sit under one you added in
 * March and never returned to.
 */
export async function listMyGyms(): Promise<MyGym[]> {
  const { data, error } = await supabase
    .from('user_gyms')
    .select('last_visit, gyms(*)')
    .order('last_visit', { ascending: false, nullsFirst: false });

  if (error) throw new Error(error.message);

  return (data ?? [])
    .map((row: any) => ({ ...(row.gyms as Gym), last_visit: row.last_visit }))
    .filter((g: MyGym) => g.id);
}

/**
 * Put a gym in the shared directory, or return the one already there.
 *
 * Two entries for one gym would split its routes in half, and neither half
 * would look wrong from the inside, so this checks before inserting.
 */
export async function addGym(input: {
  name: string;
  city?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  addedBy: string;
}): Promise<Gym> {
  const existing = (await listGyms()).find((g) =>
    samePlace({ name: g.name, lat: g.lat }, { name: input.name, lat: input.lat ?? null })
  );
  if (existing) return existing;

  const { data, error } = await supabase
    .from('gyms')
    .insert({
      name: input.name.trim(),
      city: input.city?.trim() || null,
      address: input.address?.trim() || null,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      // The row level policy checks this against the signed in user, so it is
      // passed explicitly rather than left to a default.
      added_by: input.addedBy,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

/** Add a gym to your own list. Adding one that is already there is harmless. */
export async function followGym(gymId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('user_gyms')
    .upsert({ user_id: userId, gym_id: gymId }, { onConflict: 'user_id,gym_id' });
  if (error) throw new Error(error.message);
}

export async function unfollowGym(gymId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('user_gyms')
    .delete()
    .eq('user_id', userId)
    .eq('gym_id', gymId);
  if (error) throw new Error(error.message);
}

/**
 * Put a gym in the directory if it is new, then add it to your list.
 * What "add this gym" means from a search result, in one call.
 */
export async function addAndFollow(input: {
  name: string;
  city?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  userId: string;
}): Promise<Gym> {
  const gym = await addGym({ ...input, addedBy: input.userId });
  await followGym(gym.id, input.userId);
  return gym;
}

// ---------------------------------------------------------------------------
// A gym's own vocabulary: how it grades, and what its walls are called.
//
// None of this is in OpenStreetMap or Google. Both carry a gym's name, address
// and opening hours and stop there; wall names and grading live on the gym's
// own website in a different shape at every gym. So it is entered by hand, once
// per gym, by whoever gets there first, and everybody after them picks from a
// list instead of typing.
// ---------------------------------------------------------------------------

/** A gym's grade ladder, easiest first. Empty until the gym has been set up. */
export async function listGrades(gymId: string): Promise<GymGrade[]> {
  const { data, error } = await supabase
    .from('gym_grades')
    .select('*')
    .eq('gym_id', gymId)
    .order('position');

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listWalls(gymId: string): Promise<GymWall[]> {
  const { data, error } = await supabase
    .from('gym_walls')
    .select('*')
    .eq('gym_id', gymId)
    .order('position')
    .order('name');

  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Record how a gym grades and what its walls are called.
 *
 * The ladder is only passed in for colour graded gyms; V and Font are
 * published scales, so the database seeds those itself rather than making
 * somebody type out sixteen rungs that are the same everywhere.
 *
 * Re-running this replaces the walls and the ladder, so the same screen works
 * for fixing a gym that was set up wrong.
 */
export async function setUpGym(input: {
  gymId: string;
  system: GradingSystemId;
  walls: string[];
  /** Colour ids, easiest first. Ignored unless the system is 'color'. */
  colorLadder?: string[];
  userId: string;
}): Promise<void> {
  const { gymId, system, userId } = input;

  const { error: gymError } = await supabase
    .from('gyms')
    .update({ grading_system: system, set_up_by: userId, set_up_at: new Date().toISOString() })
    .eq('id', gymId);
  if (gymError) throw new Error(gymError.message);

  if (system === 'color') {
    const ladder = input.colorLadder ?? [];
    await supabase.from('gym_grades').delete().eq('gym_id', gymId);
    if (ladder.length) {
      const rows = ladder.map((id, i) => ({
        gym_id: gymId,
        position: i,
        label: holdColor(id)?.label ?? id,
        color_hex: holdHex(id),
      }));
      const { error } = await supabase.from('gym_grades').insert(rows);
      if (error) throw new Error(error.message);
    }
  } else {
    // seed_gym_grades clears and refills the ladder in one statement, so a gym
    // switched from colour to V does not end up with both.
    const { error } = await supabase.rpc('seed_gym_grades', { p_gym: gymId, p_system: system });
    if (error) throw new Error(error.message);
  }

  const names = [...new Set(input.walls.map((w) => w.trim()).filter(Boolean))];
  await supabase.from('gym_walls').delete().eq('gym_id', gymId);
  if (names.length) {
    const rows = names.map((name, i) => ({
      gym_id: gymId,
      name,
      position: i,
      created_by: userId,
    }));
    const { error } = await supabase.from('gym_walls').insert(rows);
    if (error) throw new Error(error.message);
  }
}

/**
 * Add one wall to a gym that is already set up, for the wall somebody notices
 * is missing while they are standing in front of it.
 */
export async function addWall(gymId: string, name: string, userId: string): Promise<GymWall> {
  const { data, error } = await supabase
    .from('gym_walls')
    .insert({ gym_id: gymId, name: name.trim(), position: 99, created_by: userId })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}
