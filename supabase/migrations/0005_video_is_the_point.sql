-- ===========================================================================
-- 0005  the video is the point
--
-- Everything before this treated 3B as a logbook that happened to allow
-- videos. It is the other way round. A climber films a send, the video becomes
-- beta somebody else can look up at a gym they have never been to, and an AI
-- reads the video move by move and says what happened at 0:12 and 0:28.
--
-- That reframing is what this migration is for. It gives videos the things
-- that only make sense once they are the main object: an author people can
-- recognise, likes, comments that can point at a moment, and somewhere for the
-- AI to write.
--
-- Rating and commenting stay available without a video. Somebody who climbed
-- something and did not film it still has an opinion worth having, and
-- route_reviews already never required a send.
--
-- routes.set_on goes. "The day somebody first typed this into the app" told
-- nobody anything. Whether a problem is still up is answered by whether
-- anybody has filmed it lately, which is a question the data already answers.
-- ===========================================================================

drop view if exists route_stats;
alter table routes drop column set_on;


-- ---------------------------------------------------------------------------
-- A name people can recognise
--
-- display_name is what somebody calls themselves and can collide. A handle is
-- the one other climbers type and link to, so it is unique and lower case.
-- ---------------------------------------------------------------------------

alter table profiles add column handle text unique
  check (handle ~ '^[a-z0-9_]{3,20}$');


-- ---------------------------------------------------------------------------
-- videos, promoted
--
-- 0001 defaulted these to private and was right to, when a video was a private
-- note attached to a private attempt. It is now the thing the app exists to
-- share, and a private default means nobody ever sees one. The column stays so
-- a video can still be held back.
-- ---------------------------------------------------------------------------

alter table videos
  alter column visibility set default 'public',

  -- Stored next to the video in the same private bucket rather than fetched by
  -- decoding a frame on every list render.
  add column thumbnail_path text,

  add column width smallint,
  add column height smallint,

  -- What the AI made of it overall, nullable until it has looked. The move by
  -- move findings live in video_analysis.
  add column ai_score smallint check (ai_score between 0 and 100),
  add column analyzed_at timestamptz;

-- Existing rows were written under the old default and were never meant to be
-- private; there is no user visible privacy setting yet that could have set
-- them deliberately.
update videos set visibility = 'public' where visibility = 'private';


-- ---------------------------------------------------------------------------
-- video_likes
--
-- What sorts one beta above another. Ranking by likes rather than by upload
-- order is the difference between "the first person who filmed it" and "the
-- one worth watching".
-- ---------------------------------------------------------------------------

create table video_likes (
  video_id   uuid not null references videos on delete cascade,
  user_id    uuid not null references profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (video_id, user_id)
);

create index video_likes_video_idx on video_likes (video_id);


-- ---------------------------------------------------------------------------
-- video_comments
--
-- at_seconds is optional and is what makes a comment about climbing rather
-- than about a video. "Your hip is too far from the wall here" means nothing
-- without a moment attached, and everything with one.
-- ---------------------------------------------------------------------------

create table video_comments (
  id         uuid primary key default gen_random_uuid(),
  video_id   uuid not null references videos on delete cascade,
  user_id    uuid not null references profiles on delete cascade,

  body       text not null check (btrim(body) <> ''),
  at_seconds real check (at_seconds >= 0),

  created_at timestamptz not null default now()
);

create index video_comments_video_idx on video_comments (video_id, created_at);


-- ---------------------------------------------------------------------------
-- video_analysis
--
-- What the AI saw, one row per moment, which is how the screen reads it: a
-- list of timestamps down the side of the video.
--
-- Kept apart from video_comments even though both are text at a timestamp,
-- because these are regenerated when a better model runs and human comments
-- must never be caught by that.
-- ---------------------------------------------------------------------------

create table video_analysis (
  id         uuid primary key default gen_random_uuid(),
  video_id   uuid not null references videos on delete cascade,

  at_seconds real not null check (at_seconds >= 0),
  note       text not null,

  -- 'technique', 'movement', 'strength', 'mistake'. Free text rather than an
  -- enum because the vocabulary will change every time the prompt does, and a
  -- migration per wording change is not worth the type safety.
  kind       text,

  -- Which model wrote it, so a regeneration can be told from an old run.
  model      text,

  created_at timestamptz not null default now()
);

create index video_analysis_video_idx on video_analysis (video_id, at_seconds);


-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table video_likes    enable row level security;
alter table video_comments enable row level security;
alter table video_analysis enable row level security;

-- A like count nobody can read is not a count.
create policy "likes are readable" on video_likes for select using (true);
create policy "own like is writable" on video_likes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "comments are readable" on video_comments for select using (true);
create policy "own comment is writable" on video_comments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Analysis is written by a trusted backend with the service key, never by the
-- app, so there is no insert policy here on purpose.
create policy "analysis is readable" on video_analysis for select using (true);

-- Videos were only visible to their owner or the public. That still holds, but
-- the insert policy has to allow filming somebody else, which is most of how
-- videos get made in a gym.
drop policy if exists "own videos are writable" on videos;
create policy "videos are uploadable" on videos
  for insert with check (auth.uid() = uploaded_by);
create policy "own videos are editable" on videos
  for update using (auth.uid() = uploaded_by) with check (auth.uid() = uploaded_by);
create policy "own videos are deletable" on videos
  for delete using (auth.uid() = uploaded_by);


-- ---------------------------------------------------------------------------
-- The bucket
--
-- Private, with playback going through signed URLs. A public bucket would be
-- simpler, but then a video marked private is only hidden rather than
-- protected, and its URL works for anybody who ever saw it.
--
-- 100 MB and video mime types only, so a mistake is rejected at the edge
-- rather than after the upload has finished.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'videos', 'videos', false, 104857600,
  array['video/mp4', 'video/quicktime', 'image/jpeg', 'image/png']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Objects are keyed <uploader uuid>/<video uuid>.<ext>, so the first path
-- segment is what says who may write there.
create policy "upload into your own folder" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "delete your own objects" on storage.objects
  for delete to authenticated using (
    bucket_id = 'videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Reading follows the video row rather than the path, so marking a video
-- private takes its file out of reach in the same action. The thumbnail is
-- matched too, since a still of a private video gives away the same thing.
create policy "read public or your own videos" on storage.objects
  for select to authenticated using (
    bucket_id = 'videos'
    and exists (
      select 1 from videos v
      where (v.storage_path = storage.objects.name or v.thumbnail_path = storage.objects.name)
        and (
          v.visibility = 'public'
          or v.uploaded_by = auth.uid()
          or v.climber_id = auth.uid()
        )
    )
  );


-- ---------------------------------------------------------------------------
-- route_stats, rebuilt again
--
-- Now carrying the two numbers that decide whether a problem is worth walking
-- over to: is there beta, and has anybody been on it lately.
-- ---------------------------------------------------------------------------

create view route_stats as
select
  r.id                                                    as route_id,
  count(s.*)                                              as send_count,
  count(distinct s.user_id)                               as climber_count,
  max(s.sent_at)                                          as last_sent_at,

  (select count(*) from route_reviews v where v.route_id = r.id)
                                                          as review_count,
  (select round(avg(v.rating)::numeric, 1)
     from route_reviews v
    where v.route_id = r.id and v.rating is not null)     as rating,

  (select count(*)
     from videos vd
     join sends sv on sv.id = vd.send_id
    where sv.route_id = r.id and vd.visibility = 'public')
                                                          as video_count
from routes r
left join sends s on s.route_id = r.id
group by r.id;


-- ---------------------------------------------------------------------------
-- video_stats
--
-- Counted in a view for the same reason route_stats is: likes and comments are
-- row level secured per person, and every screen must see the same number.
-- ---------------------------------------------------------------------------

create view video_stats as
select
  v.id                                            as video_id,
  (select count(*) from video_likes l    where l.video_id = v.id) as like_count,
  (select count(*) from video_comments cm where cm.video_id = v.id) as comment_count,
  (select count(*) from video_analysis a where a.video_id = v.id) as analysis_count
from videos v;
