/**
 * The vocabulary of the sport, matching supabase/migrations/0003_gym_vocabulary.sql.
 *
 * There is deliberately no grade scale in this file. Grades belong to a gym,
 * not to the app: one gym tapes V grades, the next prints French numbers, and
 * the one after that grades by colour with no number written anywhere. A
 * constant here would be a fourth opinion none of them asked for.
 *
 * What is here is the part that genuinely is the same everywhere: the colours
 * holds come in, and the four things that can happen when you get on a problem.
 */

/**
 * There is no list of outcomes here on purpose.
 *
 * An earlier version had four: flash, send, high point, fell. Nobody logs a
 * fall, and a video of one is not beta, so the only thing recorded now is that
 * you got up it. See supabase/migrations/0004_sends_and_reviews.sql.
 */

/** The stars a review can give, so the picker and the validation agree. */
export const MAX_RATING = 5;

/**
 * The three ways a gym can tell you how hard something is.
 *
 * Picked once per gym when it is set up. V and Font have published ladders the
 * database seeds automatically; a colour gym's ladder is whatever colours that
 * gym uses, in whatever order that gym puts them.
 */
export const GRADING_SYSTEMS = [
  {
    id: 'v_scale',
    label: 'V scale',
    example: 'V0, V1, V2…',
    hint: 'The tape says V something',
  },
  {
    id: 'font',
    label: 'Font scale',
    example: '5+, 6A, 6C…',
    hint: 'French numbers and letters',
  },
  {
    id: 'color',
    label: 'By colour',
    example: 'Yellow, green, blue…',
    hint: 'No numbers, the colour is the grade',
  },
] as const;

export type GradingSystemId = (typeof GRADING_SYSTEMS)[number]['id'];

export function gradingSystem(id?: string | null) {
  return GRADING_SYSTEMS.find((s) => s.id === id) ?? null;
}

/**
 * Hold colours, for the chips that identify a problem.
 *
 * This is what you look for from across the room, and it stays the answer to
 * "which one is it" no matter how the gym grades. At a colour graded gym the
 * same list doubles as the grade ladder, which is why the ids are plain
 * colours and not tape specific.
 */
export const HOLD_COLORS = [
  { id: 'yellow', label: 'Yellow', hex: '#EAB308' },
  { id: 'green', label: 'Green', hex: '#22C55E' },
  { id: 'blue', label: 'Blue', hex: '#3B82F6' },
  { id: 'red', label: 'Red', hex: '#EF4444' },
  { id: 'orange', label: 'Orange', hex: '#F97316' },
  { id: 'purple', label: 'Purple', hex: '#A855F7' },
  { id: 'pink', label: 'Pink', hex: '#EC4899' },
  { id: 'teal', label: 'Teal', hex: '#14B8A6' },
  { id: 'grey', label: 'Grey', hex: '#9CA3AF' },
  { id: 'white', label: 'White', hex: '#E5E7EB' },
  { id: 'black', label: 'Black', hex: '#1F2937' },
] as const;

export type HoldColorId = (typeof HOLD_COLORS)[number]['id'];

export function holdColor(id?: string | null) {
  return HOLD_COLORS.find((c) => c.id === id) ?? null;
}

/** The swatch for a hold colour, falling back to grey for anything unknown. */
export function holdHex(id?: string | null): string {
  return holdColor(id)?.hex ?? '#9CA3AF';
}
