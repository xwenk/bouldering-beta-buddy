/**
 * Sends: one climb of one problem, top to bottom.
 *
 * There is no record of falling and no count of how many goes it took. Those
 * were in an earlier version of the schema and nobody wants to log them; what
 * gets said out loud in a gym is "I got it", and a video is only worth
 * watching if it went.
 *
 * There is also no sessions table. A session is the sends that share a day and
 * a gym, which is something a query can work out. Modelling it would mean
 * asking somebody to press "end session" while they are packing their shoes
 * away, and nobody does that.
 *
 * Row level security keeps sends private per person, so every read here is
 * already scoped to whoever is signed in. The counts other people see come
 * from the route_stats view instead, which aggregates across everybody without
 * exposing a single row.
 */
import { supabase } from './supabase';

export type Send = {
  id: string;
  user_id: string;
  route_id: string;
  sent_at: string;
  note: string | null;
  created_at: string;
};

/** A send with enough of its route to read on its own, away from a gym screen. */
export type SendInContext = Send & {
  route_name: string | null;
  hold_color: string | null;
  grade_label: string | null;
  grade_hex: string | null;
  wall_name: string | null;
  gym_id: string | null;
  gym_name: string | null;
};

/** A day at one gym. Built from sends rather than stored. */
export type Session = {
  /** date and gym together, so two gyms in one day stay two sessions. */
  key: string;
  date: string;
  gym_id: string | null;
  gym_name: string;
  sends: SendInContext[];
};

const WITH_ROUTE =
  '*, routes(name, hold_color, gym_id, gym_grades(label, color_hex), gym_walls(name), gyms(name))';

function flatten(row: any): SendInContext {
  const { routes, ...send } = row;
  return {
    ...(send as Send),
    route_name: routes?.name ?? null,
    hold_color: routes?.hold_color ?? null,
    grade_label: routes?.gym_grades?.label ?? null,
    grade_hex: routes?.gym_grades?.color_hex ?? null,
    wall_name: routes?.gym_walls?.name ?? null,
    gym_id: routes?.gym_id ?? null,
    gym_name: routes?.gyms?.name ?? null,
  };
}

/**
 * Record a send.
 *
 * Repeats are allowed rather than collapsed into one row, because climbing
 * something again a month later is its own thing and often the one you got on
 * video.
 *
 * This also stamps the gym as visited today, which is what makes the gym list
 * open on wherever somebody actually climbs rather than whatever they added
 * first. It happens here rather than on the gym screen because opening a gym
 * to look at it is not a visit; getting up something is.
 */
export async function logSend(input: {
  routeId: string;
  gymId: string;
  userId: string;
  note?: string | null;
  /** When it was actually climbed. Defaults to now, which is often wrong. */
  sentAt?: Date;
}): Promise<Send> {
  const { data, error } = await supabase
    .from('sends')
    .insert({
      user_id: input.userId,
      route_id: input.routeId,
      note: input.note?.trim() || null,
      // Filming and uploading are rarely the same day. A video sitting in the
      // camera roll for three weeks is the normal case, not the edge one, so
      // the date is asked for rather than stamped.
      ...(input.sentAt ? { sent_at: input.sentAt.toISOString() } : {}),
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  // A failure here means the gym list is ordered slightly wrong, which is not
  // worth losing the send over, so it stays out of the error path.
  supabase
    .from('user_gyms')
    .upsert(
      {
        user_id: input.userId,
        gym_id: input.gymId,
        last_visit: (input.sentAt ?? new Date()).toISOString().slice(0, 10),
      },
      { onConflict: 'user_id,gym_id' }
    )
    .then(() => {});

  return data;
}

export async function deleteSend(sendId: string): Promise<void> {
  const { error } = await supabase.from('sends').delete().eq('id', sendId);
  if (error) throw new Error(error.message);
}

/** Your own sends of one problem, newest first. */
export async function listRouteSends(routeId: string): Promise<Send[]> {
  const { data, error } = await supabase
    .from('sends')
    .select('*')
    .eq('route_id', routeId)
    .order('sent_at', { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

/** The route ids you have sent at one gym, for the "mine" filter. */
export async function listSentRouteIds(gymId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from('sends').select('route_id, routes!inner(gym_id)').eq(
    'routes.gym_id',
    gymId
  );

  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r: any) => r.route_id as string));
}

/**
 * Everything you have sent, cut into sessions.
 *
 * Grouped by the local date rather than the stored timestamp, because a
 * session that ran past midnight is still one evening to the person who
 * climbed it.
 */
export async function listSessions(limit = 200): Promise<Session[]> {
  const { data, error } = await supabase
    .from('sends')
    .select(WITH_ROUTE)
    .order('sent_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  const sessions = new Map<string, Session>();

  for (const row of data ?? []) {
    const s = flatten(row);
    const date = localDate(s.sent_at);
    const key = `${date}|${s.gym_id ?? 'unknown'}`;

    let session = sessions.get(key);
    if (!session) {
      session = {
        key,
        date,
        gym_id: s.gym_id,
        gym_name: s.gym_name ?? 'Somewhere',
        sends: [],
      };
      sessions.set(key, session);
    }
    session.sends.push(s);
  }

  return [...sessions.values()];
}

/** The calendar date a send falls on, in the phone's own timezone. */
function localDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

/**
 * How a date should read in a list: today and yesterday by name, this year
 * without the year, anything older with it.
 */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const then = new Date(y, m - 1, d);
  const now = new Date();
  const days = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - then.getTime()) / 86400000
  );

  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return then.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(then.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}
