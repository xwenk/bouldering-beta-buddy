/**
 * Reviews: how good a problem is, and what people want to say about it.
 *
 * One per person per route, enforced by the primary key. That is what keeps an
 * average honest, and it means coming back to change your mind updates your
 * row rather than adding a second opinion.
 *
 * Unlike sends, these are public. A rating nobody can see is not a rating.
 */
import { supabase } from './supabase';

export type Review = {
  route_id: string;
  user_id: string;
  rating: number | null;
  comment: string | null;
  created_at: string;
  updated_at: string;
};

export type ReviewWithAuthor = Review & {
  display_name: string;
  avatar_url: string | null;
};

/** Everything said about one problem, newest first. */
export async function listReviews(routeId: string): Promise<ReviewWithAuthor[]> {
  const { data, error } = await supabase
    .from('route_reviews')
    .select('*, profiles(display_name, avatar_url)')
    .eq('route_id', routeId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row: any) => {
    const { profiles, ...review } = row;
    return {
      ...(review as Review),
      display_name: profiles?.display_name ?? 'Someone',
      avatar_url: profiles?.avatar_url ?? null,
    };
  });
}

/** Your own review of one problem, so the form opens on what you already said. */
export async function getMyReview(routeId: string, userId: string): Promise<Review | null> {
  const { data, error } = await supabase
    .from('route_reviews')
    .select('*')
    .eq('route_id', routeId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

/**
 * Leave or change a review.
 *
 * The database refuses a row that is neither a score nor a sentence, so that
 * is checked here first to turn it into a sentence somebody can act on rather
 * than a constraint name.
 */
export async function saveReview(input: {
  routeId: string;
  userId: string;
  rating: number | null;
  comment: string;
}): Promise<void> {
  const comment = input.comment.trim();
  if (input.rating == null && !comment) {
    throw new Error('Give it stars, say something about it, or both.');
  }

  const { error } = await supabase.from('route_reviews').upsert(
    {
      route_id: input.routeId,
      user_id: input.userId,
      rating: input.rating,
      comment: comment || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'route_id,user_id' }
  );

  if (error) throw new Error(error.message);
}

export async function deleteReview(routeId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('route_reviews')
    .delete()
    .eq('route_id', routeId)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
}
