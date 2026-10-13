/**
 * One problem: what it is, who has got up it, and what people make of it.
 *
 * Sending is one tap, because this is used standing under a wall with chalk on
 * both hands and a queue behind you. Anything needing a keyboard is optional
 * and comes after the tap.
 *
 * A problem that has been taken off the wall still opens here in full. It is
 * what somebody's video and somebody's session point at, so it keeps its
 * history and its reviews and only loses the button that says you climbed it
 * today.
 */
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from 'react-native';

import { Image } from 'expo-image';

import UploadSheet from '@/components/upload-sheet';
import { Button, Card, Row, Screen, SectionLabel, useColors } from '@/components/ui-kit';
import { holdHex, MAX_RATING } from '@/constants/climbing';
import { Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { getProfile, Profile } from '@/lib/profile';
import { deleteReview, getMyReview, listReviews, ReviewWithAuthor, saveReview } from '@/lib/reviews';
import { getRoute, RouteWithStats, setStripped } from '@/lib/routes';
import { deleteSend, listRouteSends, Send } from '@/lib/sends';
import { bodyDistance, listRouteVideos, VideoCard } from '@/lib/videos';

export default function RouteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const c = useColors();
  const { user } = useAuth();

  const [route, setRoute] = useState<RouteWithStats | null>(null);
  const [sends, setSends] = useState<Send[]>([]);
  const [reviews, setReviews] = useState<ReviewWithAuthor[]>([]);
  const [videos, setVideos] = useState<VideoCard[]>([]);
  const [me, setMe] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setError('');
    try {
      const [r, ss, rv, vs, p] = await Promise.all([
        getRoute(id),
        listRouteSends(id),
        listReviews(id),
        listRouteVideos(id, user?.id),
        user ? getProfile(user.id) : Promise.resolve(null),
      ]);
      setRoute(r);
      setSends(ss);
      setReviews(rv);
      setVideos(vs);
      setMe(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this problem.');
    } finally {
      setLoading(false);
    }
  }, [id, user]);

  useEffect(() => {
    load();
  }, [load]);

  useLayoutEffect(() => {
    navigation.setOptions({ title: route?.grade_label ?? 'Problem' });
  }, [navigation, route]);

  function confirmStrip() {
    if (!route) return;
    Alert.alert(
      'Gone from the wall?',
      'It drops out of what is up right now. Everything logged on it stays, and it is still searchable.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark as gone',
          style: 'destructive',
          onPress: async () => {
            try {
              await setStripped(route.id, true);
              await load();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Could not update it.');
            }
          },
        },
      ]
    );
  }

  if (loading) {
    return (
      <Screen title="Problem">
        <ActivityIndicator color={c.accent} style={{ paddingVertical: Spacing.five }} />
      </Screen>
    );
  }

  if (!route) {
    return (
      <Screen title="Problem" subtitle="Not found">
        <Card>
          <Text style={{ color: c.textSecondary, fontSize: 14 }}>
            This problem is no longer in the database.
          </Text>
        </Card>
      </Screen>
    );
  }

  const gone = !!route.stripped_on;

  return (
    <Screen
      title={route.name || route.grade_label || 'Problem'}
      subtitle={[route.wall_name, route.hold_color ? `${route.hold_color} holds` : null]
        .filter(Boolean)
        .join(' · ')}>
      {error ? (
        <View style={{ backgroundColor: c.fallSoft, borderRadius: Radius.md, padding: Spacing.three }}>
          <Text style={{ color: c.fall, fontSize: 14 }}>{error}</Text>
        </View>
      ) : null}

      {gone ? (
        <View
          style={{
            backgroundColor: c.surfaceSunken,
            borderRadius: Radius.md,
            padding: Spacing.three,
            gap: Spacing.two,
          }}>
          <Row>
            <Ionicons name="archive-outline" size={18} color={c.textSecondary} />
            <Text style={{ color: c.textSecondary, fontSize: 13, flex: 1 }}>
              Taken off the wall on {route.stripped_on}. Everything below is kept.
            </Text>
          </Row>
          <Pressable onPress={() => setStripped(route.id, false).then(load)}>
            <Text style={{ color: c.accent, fontSize: 13, fontWeight: '600' }}>
              Still up? Put it back
            </Text>
          </Pressable>
        </View>
      ) : null}

      <Card>
        <Row>
          <View
            style={{
              width: 6,
              height: 46,
              borderRadius: 3,
              backgroundColor: holdHex(route.hold_color),
            }}
          />
          {route.grade_hex ? (
            <View
              style={{
                width: 34,
                height: 34,
                borderRadius: 17,
                backgroundColor: route.grade_hex,
                borderWidth: 1,
                borderColor: c.border,
              }}
            />
          ) : (
            <Text style={{ color: c.text, fontSize: 26, fontWeight: '800' }}>
              {route.grade_label ?? '—'}
            </Text>
          )}
          <View style={{ flex: 1, alignItems: 'flex-end', gap: 2 }}>
            {route.rating != null ? (
              <Row style={{ gap: Spacing.one }}>
                <Ionicons name="star" size={15} color={c.accent} />
                <Text style={{ color: c.text, fontSize: 15, fontWeight: '700' }}>{route.rating}</Text>
              </Row>
            ) : null}
            <Text style={{ color: c.textSecondary, fontSize: 13 }}>
              {route.climber_count > 0
                ? `Sent by ${route.climber_count} ${route.climber_count === 1 ? 'climber' : 'climbers'}`
                : 'Nobody has sent it yet'}
            </Text>
          </View>
        </Row>
      </Card>

      {route.setter ? (
        <Card>
          <Row>
            <Text style={{ color: c.textSecondary, fontSize: 14, flex: 1 }}>Setter</Text>
            <Text style={{ color: c.text, fontSize: 14, fontWeight: '600' }}>{route.setter}</Text>
          </Row>
        </Card>
      ) : null}

      {!gone ? <Button label="I sent it" icon="videocam" onPress={() => setUploading(true)} /> : null}

      <BetaSection videos={videos} me={me} />

      <SectionLabel>
        {sends.length ? `Your sends · ${sends.length}` : 'Your sends'}
      </SectionLabel>
      {sends.length === 0 ? (
        <Card>
          <Text style={{ color: c.textSecondary, fontSize: 14 }}>
            {gone ? 'You never logged this one.' : 'Nothing yet. One tap is the whole thing.'}
          </Text>
        </Card>
      ) : (
        sends.map((s) => (
          <SendRow
            key={s.id}
            send={s}
            onDelete={async () => {
              await deleteSend(s.id);
              load();
            }}
          />
        ))
      )}

      <ReviewSection
        routeId={route.id}
        userId={user?.id}
        reviews={reviews}
        onChanged={load}
        onError={setError}
      />

      {!gone ? (
        <Button
          label="Not on the wall any more"
          variant="quiet"
          icon="archive-outline"
          onPress={confirmStrip}
        />
      ) : null}

      <UploadSheet
        open={uploading}
        routeId={route.id}
        gymId={route.gym_id}
        userId={user?.id}
        onClose={() => setUploading(false)}
        onDone={() => {
          setUploading(false);
          load();
        }}
      />
    </Screen>
  );
}

/**
 * The beta, which is the reason somebody opened this screen.
 *
 * Sorted with the closest build to yours first when both of you have said, and
 * by likes otherwise. A move that is a reach for a tall climber is a jump for
 * a short one, so "most liked" is the wrong first answer when the app already
 * knows enough to give a better one.
 */
function BetaSection({ videos, me }: { videos: VideoCard[]; me: Profile | null }) {
  const c = useColors();

  const ranked = [...videos].sort((a, b) => {
    const da = bodyDistance(me ?? { height_cm: null, ape_index_cm: null }, a);
    const db = bodyDistance(me ?? { height_cm: null, ape_index_cm: null }, b);
    if (da != null && db != null && da !== db) return da - db;
    return b.like_count - a.like_count;
  });

  return (
    <>
      <SectionLabel>{videos.length ? `Beta · ${videos.length}` : 'Beta'}</SectionLabel>
      {videos.length === 0 ? (
        <Card style={{ gap: Spacing.one }}>
          <Text style={{ color: c.text, fontSize: 14, fontWeight: '600' }}>
            Nobody has filmed this one
          </Text>
          <Text style={{ color: c.textSecondary, fontSize: 13, lineHeight: 19 }}>
            If you get it, film it. That is what the next person who walks up to this wall is
            looking for.
          </Text>
        </Card>
      ) : (
        ranked.map((v) => <BetaRow key={v.id} video={v} me={me} />)
      )}
    </>
  );
}

function BetaRow({ video, me }: { video: VideoCard; me: Profile | null }) {
  const c = useColors();
  const distance = bodyDistance(me ?? { height_cm: null, ape_index_cm: null }, video);

  return (
    <Pressable onPress={() => router.push(`/video/${video.id}`)}>
      <Card style={{ gap: Spacing.two }}>
        <Row>
          <View
            style={{
              width: 88,
              height: 60,
              borderRadius: Radius.sm,
              backgroundColor: c.surfaceSunken,
              overflow: 'hidden',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            {video.thumbnail_url ? (
              <Image
                source={{ uri: video.thumbnail_url }}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
              />
            ) : (
              <Ionicons name="videocam-outline" size={22} color={c.textFaint} />
            )}
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: c.text, fontSize: 15, fontWeight: '700' }}>
              {video.climber_name}
            </Text>
            {video.climber_handle ? (
              <Text style={{ color: c.textFaint, fontSize: 12 }}>@{video.climber_handle}</Text>
            ) : null}
            <Row style={{ gap: Spacing.two }}>
              <Row style={{ gap: 3 }}>
                <Ionicons name="thumbs-up-outline" size={13} color={c.textFaint} />
                <Text style={{ color: c.textSecondary, fontSize: 12 }}>{video.like_count}</Text>
              </Row>
              <Row style={{ gap: 3 }}>
                <Ionicons name="chatbubble-outline" size={13} color={c.textFaint} />
                <Text style={{ color: c.textSecondary, fontSize: 12 }}>{video.comment_count}</Text>
              </Row>
              {video.analysis_count > 0 ? (
                <Row style={{ gap: 3 }}>
                  <Ionicons name="sparkles" size={13} color={c.accent} />
                  <Text style={{ color: c.accent, fontSize: 12 }}>analysed</Text>
                </Row>
              ) : null}
            </Row>
          </View>
          <Ionicons name="chevron-forward" size={18} color={c.textFaint} />
        </Row>

        {/* Within about a hand's width of your build, which is close enough that
            their beta will reach where yours does. */}
        {distance != null && distance <= 8 ? (
          <Row style={{ gap: Spacing.one }}>
            <Ionicons name="body-outline" size={13} color={c.sent} />
            <Text style={{ color: c.sent, fontSize: 12, fontWeight: '600' }}>
              Built about like you
            </Text>
          </Row>
        ) : null}
      </Card>
    </Pressable>
  );
}

function SendRow({ send, onDelete }: { send: Send; onDelete: () => void }) {
  const c = useColors();
  const when = new Date(send.sent_at);

  function confirm() {
    Alert.alert('Delete this send?', 'It only affects your own history.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onDelete },
    ]);
  }

  return (
    <Card>
      <Row>
        <Ionicons name="checkmark-circle" size={20} color={c.sent} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>
            {when.toLocaleDateString()}
          </Text>
          {send.note ? (
            <Text style={{ color: c.textSecondary, fontSize: 13 }}>{send.note}</Text>
          ) : null}
        </View>
        <Pressable onPress={confirm} hitSlop={10}>
          <Ionicons name="close" size={18} color={c.textFaint} />
        </Pressable>
      </Row>
    </Card>
  );
}

/**
 * Stars and a comment, both optional but not both empty.
 *
 * Yours sits at the top as an editable form rather than as another row in the
 * list, because the common case is changing your mind about a problem you have
 * been on several times, not writing a second review.
 */
function ReviewSection({
  routeId,
  userId,
  reviews,
  onChanged,
  onError,
}: {
  routeId: string;
  userId?: string;
  reviews: ReviewWithAuthor[];
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const c = useColors();
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const mine = reviews.find((r) => r.user_id === userId);
  const others = reviews.filter((r) => r.user_id !== userId);

  // Loaded straight from the row rather than kept in step with the list, so
  // opening the form always shows what is actually saved.
  useEffect(() => {
    if (!open || !userId) return;
    getMyReview(routeId, userId)
      .then((r) => {
        setRating(r?.rating ?? null);
        setComment(r?.comment ?? '');
      })
      .catch(() => {});
  }, [open, routeId, userId]);

  async function save() {
    if (!userId) return;
    setBusy(true);
    try {
      await saveReview({ routeId, userId, rating, comment });
      setOpen(false);
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not save your review.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SectionLabel>
        {reviews.length ? `Reviews · ${reviews.length}` : 'Reviews'}
      </SectionLabel>

      {open ? (
        <Card style={{ gap: Spacing.three }}>
          <Stars value={rating} onChange={setRating} />
          <TextInput
            value={comment}
            onChangeText={setComment}
            placeholder="What is it like? Any beta worth passing on?"
            placeholderTextColor={c.textFaint}
            multiline
            style={{
              backgroundColor: c.surfaceSunken,
              borderColor: c.border,
              borderWidth: 1,
              borderRadius: Radius.md,
              paddingHorizontal: Spacing.three,
              paddingVertical: 14,
              fontSize: 15,
              color: c.text,
              minHeight: 70,
              textAlignVertical: 'top',
            }}
          />
          {busy ? (
            <ActivityIndicator color={c.accent} />
          ) : (
            <Row>
              <View style={{ flex: 1 }}>
                <Button label="Save" onPress={save} />
              </View>
              <Pressable onPress={() => setOpen(false)} hitSlop={10}>
                <Text style={{ color: c.textSecondary, fontSize: 14, paddingHorizontal: Spacing.two }}>
                  Cancel
                </Text>
              </Pressable>
            </Row>
          )}
        </Card>
      ) : (
        <Button
          label={mine ? 'Edit your review' : 'Rate it'}
          variant="quiet"
          icon="star-outline"
          onPress={() => setOpen(true)}
        />
      )}

      {mine && !open ? <ReviewRow review={mine} mine onDelete={async () => {
        await deleteReview(routeId, userId!);
        onChanged();
      }} /> : null}

      {others.map((r) => (
        <ReviewRow key={r.user_id} review={r} />
      ))}

      {reviews.length === 0 && !open ? (
        <Card>
          <Text style={{ color: c.textSecondary, fontSize: 14 }}>
            Nothing said about this one yet.
          </Text>
        </Card>
      ) : null}
    </>
  );
}

function ReviewRow({
  review,
  mine,
  onDelete,
}: {
  review: ReviewWithAuthor;
  mine?: boolean;
  onDelete?: () => void;
}) {
  const c = useColors();

  return (
    <Card style={{ gap: Spacing.one }}>
      <Row>
        <Text style={{ color: c.text, fontSize: 14, fontWeight: '700', flex: 1 }}>
          {mine ? 'You' : review.display_name}
        </Text>
        {review.rating != null ? <Stars value={review.rating} size={14} /> : null}
        {mine && onDelete ? (
          <Pressable onPress={onDelete} hitSlop={10}>
            <Ionicons name="close" size={16} color={c.textFaint} />
          </Pressable>
        ) : null}
      </Row>
      {review.comment ? (
        <Text style={{ color: c.textSecondary, fontSize: 14, lineHeight: 20 }}>{review.comment}</Text>
      ) : null}
    </Card>
  );
}

/** Read only when no onChange is given, which is how the list rows use it. */
function Stars({
  value,
  onChange,
  size = 26,
}: {
  value: number | null;
  onChange?: (v: number | null) => void;
  size?: number;
}) {
  const c = useColors();
  return (
    <Row style={{ gap: Spacing.one }}>
      {Array.from({ length: MAX_RATING }, (_, i) => i + 1).map((n) => (
        <Pressable
          key={n}
          disabled={!onChange}
          hitSlop={6}
          // Tapping the star you already chose clears it, so a comment can be
          // left without a score.
          onPress={() => onChange?.(value === n ? null : n)}>
          <Ionicons
            name={value != null && n <= value ? 'star' : 'star-outline'}
            size={size}
            color={value != null && n <= value ? c.accent : c.textFaint}
          />
        </Pressable>
      ))}
    </Row>
  );
}
