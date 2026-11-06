/**
 * One piece of beta.
 *
 * The video is the top of the screen and everything else hangs under it,
 * because everything else is about a moment in it. Tapping a timestamp, from
 * the analysis or from somebody's comment, seeks the player there. That is the
 * whole interaction: read a note, watch the move it is about.
 *
 * The analysis list is empty until a model has run over the video. Nothing
 * here waits for it or fails without it; the section simply is not there.
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from 'react-native';

import { Button, Card, Chip, Row, Screen, SectionLabel, useColors } from '@/components/ui-kit';
import { Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { apeLabel } from '@/lib/profile';
import {
  addVideoComment,
  AnalysisNote,
  atLabel,
  deleteVideo,
  deleteVideoComment,
  getVideo,
  listAnalysis,
  listVideoComments,
  setLiked,
  VideoCard,
  VideoComment,
} from '@/lib/videos';

/**
 * How a note reads at a glance, from the kind the analysis gave it.
 *
 * The same green and red the rest of the app uses for sent and fallen, because
 * a note saying you did something well and a note saying you fell mean the
 * same thing to someone scanning the page, and a second palette for the same
 * idea would only be a second thing to learn.
 *
 * Anything unrecognised falls through to the neutral treatment rather than
 * disappearing. The vocabulary changes whenever the prompt does, and a note
 * the app has not been taught about should still be readable.
 */
function tone(kind: string | null, c: ReturnType<typeof useColors>) {
  switch (kind) {
    case 'good':
      return { soft: c.sentSoft, ink: c.sent, muted: false };
    case 'work_on':
      return { soft: c.fallSoft, ink: c.fall, muted: false };
    case 'info':
      // Stretches the analysis could not see. Present, because silence over a
      // gap reads as nothing having happened, but quiet, because it is not
      // coaching.
      return { soft: c.backgroundElement, ink: c.textFaint, muted: true };
    default:
      return { soft: c.accentSoft, ink: c.accent, muted: false };
  }
}

export default function VideoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const c = useColors();
  const { user } = useAuth();

  const [video, setVideo] = useState<VideoCard | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisNote[]>([]);
  const [comments, setComments] = useState<VideoComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const player = useVideoPlayer(video?.url ?? null, (p) => {
    p.loop = true;
  });

  const load = useCallback(async () => {
    if (!id) return;
    setError('');
    try {
      const [v, a, cm] = await Promise.all([
        getVideo(id, user?.id),
        listAnalysis(id),
        listVideoComments(id),
      ]);
      setVideo(v);
      setAnalysis(a);
      setComments(cm);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this video.');
    } finally {
      setLoading(false);
    }
  }, [id, user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  useLayoutEffect(() => {
    navigation.setOptions({ title: video?.climber_name ?? 'Beta' });
  }, [navigation, video]);

  /** Both the analysis notes and timestamped comments land here. */
  function seekTo(seconds: number) {
    try {
      player.currentTime = seconds;
      player.play();
    } catch {
      // A player that is not ready yet is not worth an error message.
    }
  }

  async function toggleLike() {
    if (!user || !video) return;
    // Flipped locally first: a like that waits on the network feels broken,
    // and the reload underneath corrects it if the write failed.
    setVideo({
      ...video,
      liked_by_me: !video.liked_by_me,
      like_count: video.like_count + (video.liked_by_me ? -1 : 1),
    });
    try {
      await setLiked(video.id, user.id, !video.liked_by_me);
    } catch {
      load();
    }
  }

  function confirmDelete() {
    if (!video) return;
    Alert.alert('Delete this video?', 'The file and everything said about it go with it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteVideo(video);
            navigation.goBack();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not delete it.');
          }
        },
      },
    ]);
  }

  if (loading) {
    return (
      <Screen title="Beta">
        <ActivityIndicator color={c.accent} style={{ paddingVertical: Spacing.five }} />
      </Screen>
    );
  }

  if (!video) {
    return (
      <Screen title="Beta" subtitle="Not found">
        <Card>
          <Text style={{ color: c.textSecondary, fontSize: 14 }}>
            This video is gone, or it is private.
          </Text>
        </Card>
      </Screen>
    );
  }

  const mine = video.uploaded_by === user?.id;

  return (
    <Screen
      title={video.climber_name}
      subtitle={video.climber_handle ? `@${video.climber_handle}` : ''}>
      {error ? (
        <View style={{ backgroundColor: c.fallSoft, borderRadius: Radius.md, padding: Spacing.three }}>
          <Text style={{ color: c.fall, fontSize: 14 }}>{error}</Text>
        </View>
      ) : null}

      <View
        style={{
          borderRadius: Radius.md,
          overflow: 'hidden',
          backgroundColor: '#000',
          aspectRatio: video.width && video.height ? video.width / video.height : 9 / 16,
          maxHeight: 460,
        }}>
        {video.url ? (
          <VideoView
            player={player}
            style={{ width: '100%', height: '100%' }}
            nativeControls
            fullscreenOptions={{ enable: true }}
            contentFit="contain"
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: c.textFaint, fontSize: 13 }}>Could not load the video.</Text>
          </View>
        )}
      </View>

      <Row>
        <Pressable onPress={toggleLike} hitSlop={8}>
          <Row style={{ gap: Spacing.one }}>
            <Ionicons
              name={video.liked_by_me ? 'thumbs-up' : 'thumbs-up-outline'}
              size={20}
              color={video.liked_by_me ? c.accent : c.textSecondary}
            />
            <Text
              style={{
                color: video.liked_by_me ? c.accent : c.textSecondary,
                fontSize: 14,
                fontWeight: '600',
              }}>
              {video.like_count}
            </Text>
          </Row>
        </Pressable>

        <View style={{ flex: 1 }} />

        <Text style={{ color: c.textFaint, fontSize: 13 }}>
          {new Date(video.sent_at).toLocaleDateString()}
        </Text>
      </Row>

      {/* The climber's build, which is the thing that decides whether their
          beta will work for you at all. */}
      {video.climber_height_cm != null ? (
        <Card>
          <Row>
            <Ionicons name="body-outline" size={18} color={c.textSecondary} />
            <Text style={{ color: c.textSecondary, fontSize: 14, flex: 1 }}>
              {video.climber_name} climbs at {video.climber_height_cm} cm, ape index{' '}
              {apeLabel(video.climber_ape_index_cm)}
            </Text>
          </Row>
        </Card>
      ) : null}

      {analysis.length > 0 ? (
        <>
          <Row>
            <Ionicons name="sparkles" size={16} color={c.accent} />
            <SectionLabel>What the analysis saw</SectionLabel>
          </Row>
          {analysis.map((a) => {
            const t = tone(a.kind, c);
            return (
              <Pressable key={a.id} onPress={() => seekTo(a.at_seconds)}>
                <Card>
                  <Row>
                    <View
                      style={{
                        backgroundColor: t.soft,
                        borderRadius: Radius.sm,
                        paddingHorizontal: Spacing.two,
                        paddingVertical: 3,
                      }}>
                      <Text style={{ color: t.ink, fontSize: 12, fontWeight: '800' }}>
                        {atLabel(a.at_seconds)}
                      </Text>
                    </View>
                    <Text
                      style={{
                        color: t.muted ? c.textSecondary : c.text,
                        fontSize: 14,
                        flex: 1,
                        lineHeight: 20,
                      }}>
                      {a.note}
                    </Text>
                  </Row>
                </Card>
              </Pressable>
            );
          })}
        </>
      ) : video.ai_score == null ? (
        <Card>
          <Text style={{ color: c.textFaint, fontSize: 13, lineHeight: 19 }}>
            Not analysed yet. When it is, the moves show up here with the time they happened.
          </Text>
        </Card>
      ) : null}

      <CommentSection
        videoId={video.id}
        userId={user?.id}
        comments={comments}
        player={player}
        onSeek={seekTo}
        onChanged={load}
        onError={setError}
      />

      {mine ? (
        <Button label="Delete this video" variant="quiet" icon="trash-outline" onPress={confirmDelete} />
      ) : null}
    </Screen>
  );
}

/**
 * Comments, optionally pinned to a moment.
 *
 * The moment is offered as "at 0:14" taken from wherever the video is paused,
 * because that is what somebody has already done before they start typing:
 * they scrubbed to the bit they want to talk about.
 */
function CommentSection({
  videoId,
  userId,
  comments,
  player,
  onSeek,
  onChanged,
  onError,
}: {
  videoId: string;
  userId?: string;
  comments: VideoComment[];
  player: { currentTime: number };
  onSeek: (s: number) => void;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const c = useColors();
  const [body, setBody] = useState('');
  const [pin, setPin] = useState(true);
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);

  // Read when the field is focused rather than on a timer, so the offered
  // timestamp is where the video sat when they started writing.
  function captureTime() {
    try {
      setAt(Math.max(0, player.currentTime));
    } catch {
      setAt(0);
    }
  }

  async function post() {
    if (!userId || !body.trim()) return;
    setBusy(true);
    try {
      await addVideoComment({ videoId, userId, body, atSeconds: pin ? at : null });
      setBody('');
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not post that.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SectionLabel>{comments.length ? `Comments · ${comments.length}` : 'Comments'}</SectionLabel>

      <Card style={{ gap: Spacing.two }}>
        <TextInput
          value={body}
          onChangeText={setBody}
          onFocus={captureTime}
          placeholder="Say something about a move"
          placeholderTextColor={c.textFaint}
          multiline
          style={{
            backgroundColor: c.surfaceSunken,
            borderColor: c.border,
            borderWidth: 1,
            borderRadius: Radius.md,
            paddingHorizontal: Spacing.three,
            paddingVertical: 12,
            fontSize: 15,
            color: c.text,
            minHeight: 54,
            textAlignVertical: 'top',
          }}
        />
        <Row>
          <Chip
            label={pin ? `About ${atLabel(at)}` : 'About the whole climb'}
            selected={pin}
            onPress={() => {
              if (!pin) captureTime();
              setPin(!pin);
            }}
          />
          <View style={{ flex: 1 }} />
          {busy ? (
            <ActivityIndicator color={c.accent} />
          ) : (
            <Pressable onPress={post} hitSlop={8} disabled={!body.trim()}>
              <Text
                style={{
                  color: body.trim() ? c.accent : c.textFaint,
                  fontSize: 15,
                  fontWeight: '700',
                }}>
                Post
              </Text>
            </Pressable>
          )}
        </Row>
      </Card>

      {comments.map((cm) => (
        <Card key={cm.id} style={{ gap: Spacing.one }}>
          <Row>
            {cm.at_seconds != null ? (
              <Pressable onPress={() => onSeek(cm.at_seconds!)} hitSlop={6}>
                <View
                  style={{
                    backgroundColor: c.surfaceSunken,
                    borderRadius: Radius.sm,
                    paddingHorizontal: Spacing.two,
                    paddingVertical: 3,
                  }}>
                  <Text style={{ color: c.accent, fontSize: 12, fontWeight: '700' }}>
                    {atLabel(cm.at_seconds)}
                  </Text>
                </View>
              </Pressable>
            ) : null}
            <Text style={{ color: c.text, fontSize: 14, fontWeight: '700', flex: 1 }}>
              {cm.user_id === userId ? 'You' : cm.display_name}
            </Text>
            {cm.user_id === userId ? (
              <Pressable
                hitSlop={10}
                onPress={async () => {
                  await deleteVideoComment(cm.id);
                  onChanged();
                }}>
                <Ionicons name="close" size={16} color={c.textFaint} />
              </Pressable>
            ) : null}
          </Row>
          <Text style={{ color: c.textSecondary, fontSize: 14, lineHeight: 20 }}>{cm.body}</Text>
        </Card>
      ))}
    </>
  );
}
