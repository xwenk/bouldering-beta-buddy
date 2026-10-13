/**
 * Videos: the thing this app is for.
 *
 * A video is beta. Somebody films a send, and a climber who has never been to
 * that gym can look up the problem and watch how it goes. Everything else here
 * (sends, reviews, walls) exists to make a video findable.
 *
 * Files live in a private Supabase bucket keyed <uploader>/<random>.mp4, and
 * playback goes through short lived signed URLs. A public bucket would be less
 * code, but then a video marked private would only be hidden, and its URL
 * would keep working for anybody who ever saw it.
 */
import { File, UploadTask, UploadType } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
// The legacy entry point on purpose. expo-media-library's newer API exports a
// class also called Asset, which collides with the one getAssetsAsync returns,
// and nothing here needs what the new one adds.
import * as MediaLibrary from 'expo-media-library/legacy';
import * as VideoThumbnails from 'expo-video-thumbnails';

import { supabase } from './supabase';

/**
 * Two minutes.
 *
 * Most problems are over in twenty seconds, but the ones people actually want
 * beta for are often the slow ones: a balance heavy slab is slow by
 * definition, and stopping the recording before the top cuts off the part
 * somebody came to watch.
 *
 * The cap is checked here rather than only on the bucket so a file is refused
 * before somebody sits through the upload of it.
 */
export const MAX_SECONDS = 120;

/**
 * 50 MB, and not a number anybody here chose.
 *
 * Supabase caps every bucket at the project's global file size limit, and on
 * the free plan that limit is 50 MB and the API refuses to raise it. Setting
 * the bucket higher did nothing; the project rejected an 87 MB file before the
 * bucket was ever consulted.
 *
 * Which is why EXPORT_PRESET below exists. Two minutes of 1080p is nowhere
 * near 50 MB, so the file is re-encoded on its way out of the photo library
 * rather than hoping it happens to be small.
 */
export const MAX_BYTES = 50 * 1024 * 1024;

/**
 * 960 x 540, H.264.
 *
 * iOS re-encodes to this as it exports from the picker, which is the only
 * transcoding available without leaving Expo Go. 720p would look better and
 * runs 60 to 75 MB for two minutes, which is over the ceiling; 540p lands
 * around 35 MB and leaves room. Pose estimation reads 540p comfortably, and
 * the video is watched on a phone.
 *
 * If the project ever moves to a paid plan this should go up, and the limit
 * above with it.
 */
const EXPORT_PRESET = ImagePicker.VideoExportPreset.H264_960x540;

const BUCKET = 'videos';
/** Long enough to watch a few without a refetch, short enough to matter. */
const SIGNED_URL_TTL = 60 * 60;

export type Video = {
  id: string;
  send_id: string;
  climber_id: string | null;
  uploaded_by: string;
  storage_path: string;
  thumbnail_path: string | null;
  duration_s: number | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  visibility: 'private' | 'public';
  ai_score: number | null;
  analyzed_at: string | null;
  created_at: string;
};

/** A video with who is in it, how it has gone down, and URLs that will play. */
export type VideoCard = Video & {
  climber_name: string;
  climber_handle: string | null;
  /** Null when the climber has not filled these in. The whole point of matching. */
  climber_height_cm: number | null;
  climber_ape_index_cm: number | null;

  route_id: string;
  sent_at: string;

  like_count: number;
  comment_count: number;
  analysis_count: number;
  liked_by_me: boolean;

  url: string | null;
  thumbnail_url: string | null;
};

export type VideoComment = {
  id: string;
  video_id: string;
  user_id: string;
  body: string;
  at_seconds: number | null;
  created_at: string;
  display_name: string;
  handle: string | null;
};

export type AnalysisNote = {
  id: string;
  video_id: string;
  at_seconds: number;
  note: string;
  kind: string | null;
  model: string | null;
};

// ---------------------------------------------------------------------------
// Getting a file off the phone
// ---------------------------------------------------------------------------

export type PickedVideo = {
  uri: string;
  durationMs: number | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  /**
   * When the clip was filmed, when the phone knows. A better default for "when
   * did you climb it" than today, since the two are usually the same day even
   * when the upload is weeks later. Only the camera roll reports it.
   */
  createdAt: Date | null;
};

function toPicked(asset: ImagePicker.ImagePickerAsset): PickedVideo {
  return {
    uri: asset.uri,
    durationMs: asset.duration ?? null,
    sizeBytes: asset.fileSize ?? null,
    width: asset.width ?? null,
    height: asset.height ?? null,
    createdAt: null,
  };
}

/**
 * Whether a file is worth uploading, checked before the upload rather than
 * after, so a refusal costs seconds instead of minutes on gym wifi.
 *
 * Note that nothing here transcodes. Expo Go has no video encoder available to
 * it, so a file picked from the library is uploaded at whatever size the phone
 * recorded it. Recording through this app is capped at 720p; picking an old
 * 4K clip is what the size limit is for.
 */
export function rejectReason(v: PickedVideo): string | null {
  if (v.durationMs != null && v.durationMs / 1000 > MAX_SECONDS + 1) {
    // There is no trimming inside 3B, because the picker that trims is also
    // the one that skips re-encoding. Trimming in Photos first is the way.
    return `That is ${Math.round(v.durationMs / 1000)} seconds, and the limit is ${
      MAX_SECONDS / 60
    } minutes. Trim it in Photos first, then pick it again.`;
  }
  if (v.sizeBytes != null && v.sizeBytes > MAX_BYTES) {
    // Reachable from the camera roll strip, which hands over the original file
    // untouched. Browsing goes through the system picker, which re-encodes on
    // export, so it is a real fix and not a brush off.
    return `That clip is ${Math.round(
      v.sizeBytes / 1024 / 1024
    )} MB, and the limit is ${MAX_BYTES / 1024 / 1024} MB. Use "Browse all videos" instead: picking it that way shrinks it on the way in, and lets you trim it first.`;
  }
  return null;
}

/**
 * A camera roll entry, reduced to what a thumbnail needs.
 *
 * Deliberately not the library's own Asset type: expo-media-library ships two
 * classes by that name in two entry points, and no screen should have to care
 * which one it got.
 */
export type RollVideo = {
  id: string;
  /** Good enough to show as a thumbnail. Not necessarily readable as a file. */
  uri: string;
  durationSeconds: number | null;
};

/**
 * The last handful of videos on the phone, for showing a strip instead of a
 * button that opens a system picker.
 *
 * This is the Instagram shape and it is the right one here: somebody who just
 * climbed something has the clip at the top of their camera roll, and making
 * them tap through a file browser to reach it is a tap too many. The system
 * picker stays as the way to reach anything older.
 *
 * Returns nothing rather than throwing when permission is refused, since the
 * strip is a shortcut and browsing still works without it.
 */
export async function recentVideos(limit = 12): Promise<RollVideo[]> {
  const permission = await MediaLibrary.getPermissionsAsync();
  const granted = permission.granted ? permission : await MediaLibrary.requestPermissionsAsync();
  if (!granted.granted) return [];

  const { assets } = await MediaLibrary.getAssetsAsync({
    mediaType: 'video',
    sortBy: ['creationTime'],
    first: limit,
  });

  return assets.map((a) => ({
    id: a.id,
    uri: a.uri,
    durationSeconds: a.duration ?? null,
  }));
}

/**
 * Turn a camera roll entry into something uploadable.
 *
 * The asset's own uri is a ph:// reference on iOS, which nothing outside the
 * photo library can read, so the real file has to be asked for by id first.
 */
export async function fromAsset(video: RollVideo): Promise<PickedVideo> {
  const info = await MediaLibrary.getAssetInfoAsync(video.id);
  const uri = info.localUri ?? info.uri ?? video.uri;

  let sizeBytes: number | null = null;
  try {
    sizeBytes = new File(uri).size ?? null;
  } catch {
    sizeBytes = null;
  }

  return {
    uri,
    // MediaLibrary reports seconds where ImagePicker reports milliseconds.
    durationMs: info.duration != null ? info.duration * 1000 : null,
    sizeBytes,
    width: info.width ?? null,
    height: info.height ?? null,
    createdAt: info.creationTime ? new Date(info.creationTime) : null,
  };
}

export async function pickVideo(): Promise<PickedVideo | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error('3B needs access to your photos to pick a video.');

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['videos'],
    videoMaxDuration: MAX_SECONDS,
    // allowsEditing is deliberately off, and this is not a style choice.
    //
    // expo-image-picker picks its native picker like this:
    //
    //   if (!options.allowsEditing && sourceType != .camera) {
    //     launchMultiSelectPicker()   // PHPicker
    //   } else {
    //     launchLegacyImagePicker()   // UIImagePickerController
    //   }
    //
    // Only the PHPicker branch runs VideoUtils.transcodeVideoAsync. The legacy
    // branch copies the file as it is, so asking for Apple's trim UI silently
    // turned off the re-encoding that keeps a video under the 50 MB ceiling.
    // Trimming is worth less than being able to upload at all.
    videoExportPreset: EXPORT_PRESET,
  });

  if (result.canceled || !result.assets[0]) return null;

  const picked = toPicked(result.assets[0]);
  log('picked from library', {
    bytes: picked.sizeBytes,
    seconds: picked.durationMs != null ? Math.round(picked.durationMs / 1000) : null,
    size: `${picked.width}x${picked.height}`,
  });
  return picked;
}

export async function recordVideo(): Promise<PickedVideo | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new Error('3B needs the camera to record a climb.');

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['videos'],
    videoMaxDuration: MAX_SECONDS,
    // Captured at 540p rather than shot at 4K and shrunk afterwards, which
    // saves the phone the export and keeps two minutes under the 50 MB
    // ceiling by construction.
    videoQuality: ImagePicker.UIImagePickerControllerQualityType.IFrame960x540,
    videoExportPreset: EXPORT_PRESET,
  });

  if (result.canceled || !result.assets[0]) return null;
  return toPicked(result.assets[0]);
}

// ---------------------------------------------------------------------------
// Uploading
// ---------------------------------------------------------------------------

function objectKey(userId: string, ext: string) {
  const random = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${userId}/${random}.${ext}`;
}

/**
 * Send a local file to the bucket, streamed by the native layer.
 *
 * The obvious version of this reads the file with fetch and hands the bytes to
 * supabase.storage.upload. That works for a thumbnail and falls over on a
 * video: it materialises the whole file in JavaScript memory first, so an 80
 * MB clip needs 80 MB of heap it is not going to get, and the upload fails
 * with nothing useful to say.
 *
 * So the file never enters JavaScript. Supabase issues a signed URL, and
 * expo-file-system's UploadTask streams the file straight into it from native
 * code, which also gives progress worth showing on gym wifi.
 */
async function putFile(
  uri: string,
  key: string,
  contentType: string,
  onProgress?: (fraction: number) => void
) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(key);
  if (error) {
    log('could not get a signed upload url', { key, message: error.message });
    throw new Error(error.message);
  }

  // The file has to be readable before the native task starts, and a missing
  // or unreadable one fails deep in native code with nothing to go on.
  const file = new File(uri);
  if (!file.exists) {
    log('picked file is not there', { uri });
    throw new Error('That file is no longer on the phone. Pick it again.');
  }
  log('uploading', { key, uri, bytes: file.size, contentType });

  const task = new UploadTask(file, data.signedUrl, {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    mimeType: contentType,
    // The same headers storage-js sends when it uploads to a signed URL.
    // x-upsert in particular is not optional: the endpoint reads it.
    headers: {
      'content-type': contentType,
      'cache-control': 'max-age=3600',
      'x-upsert': 'false',
    },
    onProgress: onProgress
      ? ({ bytesSent, totalBytes }) =>
          onProgress(totalBytes > 0 ? Math.min(1, bytesSent / totalBytes) : 0)
      : undefined,
  });

  let result;
  try {
    result = await task.uploadAsync();
  } catch (e) {
    log('native upload threw', { key, message: e instanceof Error ? e.message : String(e) });
    throw new Error(
      `Upload could not start: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  // A non 2xx comes back as a resolved result rather than a throw, so it has
  // to be checked. The body is where Supabase says what it objected to.
  if (result.status >= 300) {
    log('storage refused the file', { key, status: result.status, body: result.body });
    throw new Error(uploadFailure(result.status, result.body));
  }
  log('uploaded', { key, status: result.status });
}

/**
 * Upload problems are the ones a person cannot debug and cannot work around,
 * and they happen on a phone where there is no console to open. So every step
 * says what it did, and the Metro output becomes the record of what went
 * wrong on somebody else's device.
 */
function log(what: string, detail: Record<string, unknown>) {
  console.log(`[3B upload] ${what}`, JSON.stringify(detail));
}

/** Storage errors arrive as JSON meant for a developer. These are the ones a person can hit. */
function uploadFailure(status: number, body: string): string {
  const message = (() => {
    try {
      const parsed = JSON.parse(body);
      return String(parsed.message ?? parsed.error ?? body);
    } catch {
      return body;
    }
  })();

  if (status === 413 || /exceeded the maximum allowed size/i.test(message)) {
    return `The server refused that file for being over ${
      MAX_BYTES / 1024 / 1024
    } MB. Pick it through "Browse all videos" so it gets shrunk on the way in.`;
  }
  if (/mime type|content type/i.test(message)) {
    return 'That file type is not accepted. Record it again, or pick an mp4 or mov.';
  }
  return `Upload failed (${status}). ${message}`;
}

/**
 * Put a video on a send.
 *
 * The file goes up first and the row second, so a row never points at
 * something that is not there. If the row fails the object is removed, because
 * an orphaned file counts against the quota and nothing will ever find it.
 *
 * climberId defaults to the uploader but does not have to be them. In a gym
 * people film each other constantly, and the person in the video is the one
 * whose body the beta belongs to.
 */
export async function uploadVideo(input: {
  sendId: string;
  uploadedBy: string;
  climberId?: string;
  video: PickedVideo;
  isPublic?: boolean;
  onProgress?: (fraction: number) => void;
}): Promise<Video> {
  const reason = rejectReason(input.video);
  if (reason) throw new Error(reason);

  const ext = input.video.uri.split('.').pop()?.toLowerCase() === 'mov' ? 'mov' : 'mp4';
  const key = objectKey(input.uploadedBy, ext);
  await putFile(
    input.video.uri,
    key,
    ext === 'mov' ? 'video/quicktime' : 'video/mp4',
    input.onProgress
  );

  // A still from a second in is more use than frame zero, which on a climbing
  // video is usually somebody's back as they walk up to the wall.
  let thumbKey: string | null = null;
  try {
    const thumb = await VideoThumbnails.getThumbnailAsync(input.video.uri, { time: 1000 });
    thumbKey = key.replace(/\.(mp4|mov)$/, '.jpg');
    await putFile(thumb.uri, thumbKey, 'image/jpeg');
  } catch (e) {
    log('thumbnail skipped', { message: e instanceof Error ? e.message : String(e) });
    // A missing thumbnail costs a grey box in a list. Not worth failing the
    // upload the person just waited for.
    thumbKey = null;
  }

  const { data, error } = await supabase
    .from('videos')
    .insert({
      send_id: input.sendId,
      uploaded_by: input.uploadedBy,
      climber_id: input.climberId ?? input.uploadedBy,
      storage_path: key,
      thumbnail_path: thumbKey,
      duration_s: input.video.durationMs ? Math.round(input.video.durationMs / 1000) : null,
      size_bytes: input.video.sizeBytes,
      width: input.video.width,
      height: input.video.height,
      visibility: input.isPublic === false ? 'private' : 'public',
    })
    .select()
    .single();

  if (error) {
    log('row insert failed, removing the uploaded file', { key, message: error.message });
    await supabase.storage.from(BUCKET).remove([key, ...(thumbKey ? [thumbKey] : [])]);
    throw new Error(error.message);
  }

  return data;
}

export async function deleteVideo(video: Video): Promise<void> {
  const { error } = await supabase.from('videos').delete().eq('id', video.id);
  if (error) throw new Error(error.message);
  await supabase.storage
    .from(BUCKET)
    .remove([video.storage_path, ...(video.thumbnail_path ? [video.thumbnail_path] : [])]);
}

export async function setVisibility(videoId: string, isPublic: boolean): Promise<void> {
  const { error } = await supabase
    .from('videos')
    .update({ visibility: isPublic ? 'public' : 'private' })
    .eq('id', videoId);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const WITH_CONTEXT =
  '*, sends!inner(route_id, sent_at), profiles!videos_climber_id_fkey(display_name, handle, height_cm, ape_index_cm)';

/** One signed URL per path, in one round trip rather than one per row. */
async function signAll(paths: string[]): Promise<Map<string, string>> {
  const wanted = paths.filter(Boolean);
  if (wanted.length === 0) return new Map();

  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(wanted, SIGNED_URL_TTL);

  const signed = new Map<string, string>();
  for (const row of data ?? []) {
    // A path that could not be signed is one row level security refused, which
    // is a private video belonging to somebody else and not an error here.
    if (row.path && row.signedUrl) signed.set(row.path, row.signedUrl);
  }
  return signed;
}

async function decorate(rows: any[], userId?: string): Promise<VideoCard[]> {
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const [{ data: stats }, { data: myLikes }, signed] = await Promise.all([
    supabase.from('video_stats').select('*').in('video_id', ids),
    userId
      ? supabase.from('video_likes').select('video_id').eq('user_id', userId).in('video_id', ids)
      : Promise.resolve({ data: [] as any[] }),
    signAll(rows.flatMap((r) => [r.storage_path, r.thumbnail_path].filter(Boolean))),
  ]);

  const statBy = new Map((stats ?? []).map((s: any) => [s.video_id, s]));
  const liked = new Set((myLikes ?? []).map((l: any) => l.video_id as string));

  return rows.map((row) => {
    const { sends, profiles, ...video } = row;
    return {
      ...(video as Video),
      climber_name: profiles?.display_name ?? 'Someone',
      climber_handle: profiles?.handle ?? null,
      climber_height_cm: profiles?.height_cm ?? null,
      climber_ape_index_cm: profiles?.ape_index_cm ?? null,
      route_id: sends?.route_id ?? '',
      sent_at: sends?.sent_at ?? video.created_at,
      like_count: statBy.get(video.id)?.like_count ?? 0,
      comment_count: statBy.get(video.id)?.comment_count ?? 0,
      analysis_count: statBy.get(video.id)?.analysis_count ?? 0,
      liked_by_me: liked.has(video.id),
      url: signed.get(video.storage_path) ?? null,
      thumbnail_url: video.thumbnail_path ? (signed.get(video.thumbnail_path) ?? null) : null,
    };
  });
}

/**
 * Every bit of beta for one problem, best first.
 *
 * Sorted by likes rather than by date, because "who filmed it first" is not
 * the same question as "which one is worth watching". Row level security has
 * already dropped anybody else's private videos.
 */
export async function listRouteVideos(routeId: string, userId?: string): Promise<VideoCard[]> {
  const { data, error } = await supabase
    .from('videos')
    .select(WITH_CONTEXT)
    .eq('sends.route_id', routeId);

  if (error) throw new Error(error.message);

  const cards = await decorate((data ?? []) as any[], userId);
  return cards.sort((a, b) => b.like_count - a.like_count || b.sent_at.localeCompare(a.sent_at));
}

export async function getVideo(videoId: string, userId?: string): Promise<VideoCard | null> {
  const { data, error } = await supabase
    .from('videos')
    .select(WITH_CONTEXT)
    .eq('id', videoId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return (await decorate([data], userId))[0];
}

/**
 * How close somebody's build is to yours, in centimetres, or null when either
 * of you has not said.
 *
 * This is the whole "show me beta from someone shaped like me" feature, and it
 * needs no model at all. Height and ape index are weighted the same because a
 * long reach and a tall frame solve different problems on the same wall.
 */
export function bodyDistance(
  mine: { height_cm: number | null; ape_index_cm: number | null },
  theirs: { climber_height_cm: number | null; climber_ape_index_cm: number | null }
): number | null {
  if (mine.height_cm == null || theirs.climber_height_cm == null) return null;
  const height = Math.abs(mine.height_cm - theirs.climber_height_cm);
  if (mine.ape_index_cm == null || theirs.climber_ape_index_cm == null) return height;
  return height + Math.abs(mine.ape_index_cm - theirs.climber_ape_index_cm);
}

// ---------------------------------------------------------------------------
// Likes, comments, analysis
// ---------------------------------------------------------------------------

export async function setLiked(videoId: string, userId: string, liked: boolean): Promise<void> {
  const { error } = liked
    ? await supabase.from('video_likes').upsert(
        { video_id: videoId, user_id: userId },
        { onConflict: 'video_id,user_id' }
      )
    : await supabase.from('video_likes').delete().eq('video_id', videoId).eq('user_id', userId);
  if (error) throw new Error(error.message);
}

export async function listVideoComments(videoId: string): Promise<VideoComment[]> {
  const { data, error } = await supabase
    .from('video_comments')
    .select('*, profiles(display_name, handle)')
    .eq('video_id', videoId)
    .order('created_at');

  if (error) throw new Error(error.message);

  return (data ?? []).map((row: any) => {
    const { profiles, ...comment } = row;
    return {
      ...(comment as Omit<VideoComment, 'display_name' | 'handle'>),
      display_name: profiles?.display_name ?? 'Someone',
      handle: profiles?.handle ?? null,
    };
  });
}

/** atSeconds pins a comment to a moment, which is what makes it about climbing. */
export async function addVideoComment(input: {
  videoId: string;
  userId: string;
  body: string;
  atSeconds?: number | null;
}): Promise<void> {
  const body = input.body.trim();
  if (!body) return;

  const { error } = await supabase.from('video_comments').insert({
    video_id: input.videoId,
    user_id: input.userId,
    body,
    at_seconds: input.atSeconds ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function deleteVideoComment(commentId: string): Promise<void> {
  const { error } = await supabase.from('video_comments').delete().eq('id', commentId);
  if (error) throw new Error(error.message);
}

/** What the AI saw, in the order it happened. Empty until a model has run. */
export async function listAnalysis(videoId: string): Promise<AnalysisNote[]> {
  const { data, error } = await supabase
    .from('video_analysis')
    .select('*')
    .eq('video_id', videoId)
    .order('at_seconds');

  if (error) throw new Error(error.message);
  return data ?? [];
}

/** 0:07, the way a timestamp reads next to a note. */
export function atLabel(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
