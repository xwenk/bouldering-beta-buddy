/**
 * Logging a send, with or without a video.
 *
 * One sheet for both, because they are the same event. Somebody who filmed it
 * and somebody who did not are both saying "I got this one, on this day"; the
 * video is the part that turns their send into beta for everybody else.
 *
 * The framing guidance is not decoration. Pose extraction needs the climber
 * large enough in frame and the climb unbroken from start to top, and a video
 * that misses those cannot be rescued later by a better model. Saying so here,
 * once, before the library fills up, is cheaper than saying sorry afterwards.
 */
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, Chip, Row, SectionLabel, useColors } from '@/components/ui-kit';
import { Radius, Spacing } from '@/constants/theme';
import { logSend } from '@/lib/sends';
import {
  atLabel,
  fromAsset,
  MAX_SECONDS,
  PickedVideo,
  pickVideo,
  recentVideos,
  RollVideo,
  recordVideo,
  rejectReason,
  uploadVideo,
} from '@/lib/videos';

const FRAMING = [
  'Whole climber in frame, from the ground up',
  'Start to topout in one take, no cuts',
  'Side on or slightly off to one side beats straight underneath',
  `Under ${lengthLimit()} — slabs can take a while, that is fine`,
];

/** Reads as minutes when it divides evenly, which is how the limit is set. */
function lengthLimit(): string {
  const minutes = MAX_SECONDS / 60;
  if (!Number.isInteger(minutes)) return `${MAX_SECONDS} seconds`;
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

export default function UploadSheet({
  open,
  routeId,
  gymId,
  userId,
  onClose,
  onDone,
}: {
  open: boolean;
  routeId: string;
  gymId: string;
  userId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const c = useColors();

  const [video, setVideo] = useState<PickedVideo | null>(null);
  const [recent, setRecent] = useState<RollVideo[]>([]);
  const [when, setWhen] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [note, setNote] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [busy, setBusy] = useState<'' | 'picking' | 'saving'>('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setVideo(null);
    setWhen(new Date());
    setNote('');
    setIsPublic(true);
    setError('');

    // Loaded as the sheet opens so the clip they just filmed is already on
    // screen by the time they look down at it.
    recentVideos().then(setRecent).catch(() => setRecent([]));
  }, [open]);

  /** Accept a video, or say why not. Every route in ends up here. */
  function accept(picked: PickedVideo | null) {
    if (!picked) return;
    const reason = rejectReason(picked);
    if (reason) {
      setError(reason);
      return;
    }
    setError('');
    setVideo(picked);

    // Filming and climbing are the same day far more often than not, so the
    // clip's own date is a better guess than today. Still changeable below.
    if (picked.createdAt) setWhen(picked.createdAt);
  }

  async function choose(source: 'library' | 'camera') {
    setBusy('picking');
    setError('');
    try {
      accept(source === 'camera' ? await recordVideo() : await pickVideo());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not get that video.');
    } finally {
      setBusy('');
    }
  }

  async function chooseFromRoll(asset: RollVideo) {
    setBusy('picking');
    setError('');
    try {
      accept(await fromAsset(asset));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open that video.');
    } finally {
      setBusy('');
    }
  }

  async function save() {
    if (!userId) return;
    setBusy('saving');
    setProgress(0);
    setError('');
    try {
      // The send goes in first. If the upload then fails the send still stands,
      // which is the right way round: somebody who climbed it did climb it,
      // whether or not the file made it onto gym wifi.
      const send = await logSend({ routeId, gymId, userId, note, sentAt: when });
      if (video) {
        await uploadVideo({
          sendId: send.id,
          uploadedBy: userId,
          video,
          isPublic,
          onProgress: setProgress,
        });
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
    } finally {
      setBusy('');
    }
  }

  const today = new Date();
  const isToday = when.toDateString() === today.toDateString();
  const yesterday = new Date(today.getTime() - 86400000);

  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
        <View style={{ paddingHorizontal: Spacing.four, paddingTop: Spacing.four }}>
          <Row>
            <Text style={{ color: c.text, fontSize: 22, fontWeight: '800', flex: 1 }}>
              You sent it
            </Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={26} color={c.textSecondary} />
            </Pressable>
          </Row>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: Spacing.four, gap: Spacing.three }}
          keyboardShouldPersistTaps="handled">
          <SectionLabel>Video</SectionLabel>

          {video ? (
            <Card style={{ gap: Spacing.two }}>
              {/* Playable before it goes up, because the wrong take from the
                  camera roll looks exactly like the right one in a list. */}
              <View
                style={{
                  height: 200,
                  borderRadius: Radius.sm,
                  overflow: 'hidden',
                  backgroundColor: '#000',
                }}>
                <Preview uri={video.uri} />
              </View>
              <Row>
                <Ionicons name="videocam" size={20} color={c.sent} />
                <Text style={{ color: c.text, fontSize: 15, fontWeight: '600', flex: 1 }}>
                  {video.durationMs ? atLabel(video.durationMs / 1000) : 'Video'}
                  {video.sizeBytes
                    ? ` · ${Math.round((video.sizeBytes / 1024 / 1024) * 10) / 10} MB`
                    : ''}
                </Text>
                <Pressable onPress={() => setVideo(null)} hitSlop={10}>
                  <Ionicons name="close-circle" size={20} color={c.textFaint} />
                </Pressable>
              </Row>
              <Row>
                <Chip
                  label={isPublic ? 'Anyone can watch' : 'Only you'}
                  selected={isPublic}
                  onPress={() => setIsPublic(!isPublic)}
                />
                <Text style={{ color: c.textFaint, fontSize: 12, flex: 1 }}>
                  {isPublic
                    ? 'This is what makes it beta for the next person.'
                    : 'Kept private. Nobody else will see it.'}
                </Text>
              </Row>
            </Card>
          ) : (
            <>
              {/* Recent clips first, the way Instagram opens straight onto the
                  camera roll. Whoever just climbed something has it at the top
                  of that list, and a system picker in between is a tap and a
                  wait for no reason. */}
              <RecentStrip
                assets={recent}
                busy={busy === 'picking'}
                onRecord={() => choose('camera')}
                onPick={chooseFromRoll}
              />

              {/* Not only the way to older clips. This path goes through the
                  system picker, which re-encodes on export, so it is also the
                  answer when one off the strip is too big to send. */}
              <Pressable
                onPress={() => choose('library')}
                disabled={busy !== ''}
                style={{ paddingVertical: Spacing.one }}>
                <Text style={{ color: c.accent, fontSize: 14, textAlign: 'center' }}>
                  Browse all videos · shrinks it to fit
                </Text>
              </Pressable>

              <Card style={{ gap: Spacing.one }}>
                <Text style={{ color: c.text, fontSize: 13, fontWeight: '700' }}>
                  What makes a video usable
                </Text>
                {FRAMING.map((line) => (
                  <Row key={line} style={{ gap: Spacing.two }}>
                    <Ionicons name="ellipse" size={5} color={c.textFaint} />
                    <Text style={{ color: c.textSecondary, fontSize: 13, flex: 1, lineHeight: 19 }}>
                      {line}
                    </Text>
                  </Row>
                ))}
                <Text style={{ color: c.textFaint, fontSize: 12, marginTop: Spacing.one }}>
                  Same things the analysis needs to read your movement.
                </Text>
              </Card>

              <Text style={{ color: c.textFaint, fontSize: 13 }}>
                No video is fine too. The send still counts and you can still rate the problem.
              </Text>
            </>
          )}

          <SectionLabel>When you climbed it</SectionLabel>
          <Row>
            <Chip label="Today" selected={isToday} onPress={() => setWhen(new Date())} />
            <Chip
              label="Yesterday"
              selected={when.toDateString() === yesterday.toDateString()}
              onPress={() => setWhen(yesterday)}
            />
            <Chip
              label={isToday ? 'Another day' : when.toLocaleDateString()}
              selected={!isToday && when.toDateString() !== yesterday.toDateString()}
              onPress={() => setShowPicker(true)}
            />
          </Row>
          {showPicker ? (
            /* Spinner rather than the inline calendar. The calendar makes you
               tap the month header, change it, then tap the header again to
               get back to the days, which is three taps to answer "last
               Tuesday". Three wheels answer it in one gesture, and centering
               it stops it sitting hard against the left edge. */
            <View style={{ alignItems: 'center' }}>
              <DateTimePicker
                value={when}
                mode="date"
                maximumDate={today}
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onValueChange={(_, picked) => {
                  if (Platform.OS !== 'ios') setShowPicker(false);
                  if (picked) setWhen(picked);
                }}
                onDismiss={() => setShowPicker(false)}
              />
              {Platform.OS === 'ios' ? (
                <Pressable onPress={() => setShowPicker(false)} hitSlop={10}>
                  <Text
                    style={{
                      color: c.accent,
                      fontSize: 15,
                      fontWeight: '700',
                      paddingVertical: Spacing.two,
                    }}>
                    Done
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <SectionLabel>Beta worth remembering</SectionLabel>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Heel hook on the volume, then cross through (optional)"
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

          {error ? (
            <View
              style={{ backgroundColor: c.fallSoft, borderRadius: Radius.md, padding: Spacing.three }}>
              <Text style={{ color: c.fall, fontSize: 14 }}>{error}</Text>
            </View>
          ) : null}

          {busy === 'saving' ? (
            <View style={{ gap: Spacing.two }}>
              {/* A bar rather than a spinner: on gym wifi a big clip takes long
                  enough that a spinner reads as stuck. */}
              <View
                style={{
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: c.surfaceSunken,
                  overflow: 'hidden',
                }}>
                <View
                  style={{
                    width: `${Math.round(progress * 100)}%`,
                    height: '100%',
                    backgroundColor: c.accent,
                  }}
                />
              </View>
              <Text style={{ color: c.textFaint, fontSize: 13, textAlign: 'center' }}>
                {!video
                  ? 'Saving.'
                  : progress >= 1
                    ? 'Finishing up.'
                    : `Uploading ${Math.round(progress * 100)}%. Keep the app open.`}
              </Text>
            </View>
          ) : (
            <Button label={video ? 'Upload' : 'Log the send'} onPress={save} />
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

/**
 * The camera roll, inline.
 *
 * A horizontal strip rather than a full grid: this sheet has four other things
 * on it, and the clip somebody wants is almost always one of the first few.
 * Anything older is a tap away under "Browse all videos".
 *
 * The camera sits in the same strip as a tile rather than as a separate
 * button, so "film it now" and "use the one I filmed" are the same decision in
 * the same place.
 */
function RecentStrip({
  assets,
  busy,
  onRecord,
  onPick,
}: {
  assets: RollVideo[];
  busy: boolean;
  onRecord: () => void;
  onPick: (asset: RollVideo) => void;
}) {
  const c = useColors();
  const SIZE = 96;

  const tile = {
    width: SIZE,
    height: SIZE,
    borderRadius: Radius.sm,
    overflow: 'hidden' as const,
    backgroundColor: c.surfaceSunken,
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: Spacing.two, paddingVertical: Spacing.one }}>
      <Pressable
        onPress={onRecord}
        disabled={busy}
        style={[
          tile,
          {
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            borderWidth: 1,
            borderColor: c.border,
          },
        ]}>
        <Ionicons name="videocam" size={24} color={c.accent} />
        <Text style={{ color: c.textSecondary, fontSize: 12, fontWeight: '600' }}>Record</Text>
      </Pressable>

      {assets.map((a) => (
        <Pressable key={a.id} onPress={() => onPick(a)} disabled={busy} style={tile}>
          <Image source={{ uri: a.uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
          {a.durationSeconds ? (
            <View
              style={{
                position: 'absolute',
                right: 4,
                bottom: 4,
                backgroundColor: 'rgba(0,0,0,0.65)',
                borderRadius: 4,
                paddingHorizontal: 5,
                paddingVertical: 1,
              }}>
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>
                {atLabel(a.durationSeconds)}
              </Text>
            </View>
          ) : null}
        </Pressable>
      ))}

      {busy ? (
        <View style={[tile, { alignItems: 'center', justifyContent: 'center' }]}>
          <ActivityIndicator color={c.accent} />
        </View>
      ) : null}
    </ScrollView>
  );
}

/** Autoplaying, muted, looping: a moving thumbnail rather than something to watch. */
function Preview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  return (
    <VideoView
      player={player}
      style={{ width: '100%', height: '100%' }}
      nativeControls={false}
      contentFit="contain"
    />
  );
}
