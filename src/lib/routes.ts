/**
 * Routes: the problems on a gym's walls.
 *
 * A route does not carry a grade of its own. It points at one rung of its
 * gym's ladder, and the label on that rung is whatever the gym writes on the
 * wall, so the app never translates between scales or averages an opinion out
 * of anybody. What the tape says is what it says.
 *
 * A route is never deleted, and being stripped hides it from nothing. Gyms
 * reset a wall every few weeks, but the problem that came off it is still what
 * somebody's video and somebody's session point at, and still what they will
 * search for by name. stripped_on says only that it is not up any more;
 * deciding which list it belongs in is the screen's job.
 */
import { supabase } from './supabase';

export type Route = {
  id: string;
  gym_id: string;
  wall_id: string | null;
  grade_id: string | null;
  hold_color: string | null;
  name: string | null;

  /** Free text. There are no setter accounts, because gyms are not partners here. */
  setter: string | null;

  /**
   * The day it came off the wall, or null while it is still up.
   *
   * This hides a route from nothing. It is still in somebody's session and
   * somebody's video, and it stays searchable by name; which list it shows up
   * in is a question for the screen.
   */
  stripped_on: string | null;

  photo_url: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

/**
 * A route with the words its gym uses for it and what everybody has made of
 * it, resolved once here so no screen has to look up a grade id.
 */
export type RouteWithStats = Route & {
  grade_label: string | null;
  grade_hex: string | null;
  /** Difficulty order within this gym only. Never compare it across gyms. */
  grade_position: number | null;
  wall_name: string | null;

  send_count: number;
  climber_count: number;
  review_count: number;
  /** Mean of the stars given, to one decimal. Null until somebody rates it. */
  rating: number | null;
};

const WITH_VOCABULARY = '*, gym_grades(label, color_hex, position), gym_walls(name)';

/**
 * Attach the community counts to routes already fetched.
 *
 * route_stats is a view, and PostgREST cannot join a view without a foreign
 * key it does not have, so it is fetched alongside and matched up here.
 */
async function withStats(rows: any[]): Promise<RouteWithStats[]> {
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const { data: stats } = await supabase.from('route_stats').select('*').in('route_id', ids);
  const statBy = new Map((stats ?? []).map((s: any) => [s.route_id, s]));

  return rows.map((r) => {
    const { gym_grades, gym_walls, ...route } = r;
    return {
      ...(route as Route),
      grade_label: gym_grades?.label ?? null,
      grade_hex: gym_grades?.color_hex ?? null,
      grade_position: gym_grades?.position ?? null,
      wall_name: gym_walls?.name ?? null,
      send_count: statBy.get(r.id)?.send_count ?? 0,
      climber_count: statBy.get(r.id)?.climber_count ?? 0,
      review_count: statBy.get(r.id)?.review_count ?? 0,
      rating: statBy.get(r.id)?.rating != null ? Number(statBy.get(r.id).rating) : null,
    };
  });
}

/**
 * Every problem a gym has ever had, stripped ones included.
 *
 * The stripped ones come back deliberately. They are what somebody's video and
 * somebody's session point at, and hiding them from the query would make them
 * unsearchable everywhere at once. Splitting "on the wall now" from "was here
 * once" is the screen's job, and it can do it from this list without a second
 * round trip.
 */
export async function listRoutes(gymId: string): Promise<RouteWithStats[]> {
  const { data, error } = await supabase
    .from('routes')
    .select(WITH_VOCABULARY)
    .eq('gym_id', gymId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  const routes = await withStats((data ?? []) as any[]);

  // Sorted by difficulty rather than by when it was logged, because a wall is
  // read from the easy end. Ungraded problems go last; they are the ones
  // somebody has not finished describing.
  return routes.sort((a, b) => (a.grade_position ?? 99) - (b.grade_position ?? 99));
}

/**
 * Does this route match what somebody is typing?
 *
 * Matched against everything printed on the row rather than the name alone,
 * because most problems have no name and "purple" or "cave" or "V4" is what
 * somebody actually reaches for.
 */
export function matchesQuery(route: RouteWithStats, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [route.name, route.setter, route.grade_label, route.wall_name, route.hold_color]
    .filter(Boolean)
    .some((field) => (field as string).toLowerCase().includes(q));
}

/** One problem, whether or not it is still up. */
export async function getRoute(routeId: string): Promise<RouteWithStats | null> {
  const { data, error } = await supabase
    .from('routes')
    .select(WITH_VOCABULARY)
    .eq('id', routeId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  return (await withStats([data]))[0];
}

export async function addRoute(input: {
  gymId: string;
  gradeId: string;
  wallId?: string | null;
  holdColor?: string | null;
  name?: string | null;
  setter?: string | null;
  createdBy: string;
}): Promise<Route> {
  const { data, error } = await supabase
    .from('routes')
    .insert({
      gym_id: input.gymId,
      grade_id: input.gradeId,
      wall_id: input.wallId ?? null,
      hold_color: input.holdColor ?? null,
      name: input.name?.trim() || null,
      setter: input.setter?.trim() || null,
      created_by: input.createdBy,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

/**
 * Mark a route as gone from the wall, or put it back if somebody was wrong.
 *
 * Open to anyone, not only whoever added it: the person standing in front of
 * the empty wall is the one who knows, and it is rarely the same person.
 *
 * Nothing is deleted by this. The route keeps its sends, its reviews and its
 * videos, and stays searchable; it just stops being something to go and climb
 * today.
 */
export async function setStripped(routeId: string, stripped: boolean): Promise<void> {
  const { error } = await supabase
    .from('routes')
    .update({ stripped_on: stripped ? new Date().toISOString().slice(0, 10) : null })
    .eq('id', routeId);
  if (error) throw new Error(error.message);
}
