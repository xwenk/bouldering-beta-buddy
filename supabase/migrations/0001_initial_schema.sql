-- ===========================================================================
-- 3B - Bouldering Beta Buddy
-- 0001  initial schema
--
-- Run this in the Supabase SQL editor, or with the Supabase CLI.
--
-- Six tables. The shape follows one decision: route data comes from the
-- climbers who climb it, not from the gym. A gym is a public place, not a
-- partner, so nothing here waits on a gym agreeing to anything.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- Enumerated vocabulary
--
-- Kept as enums rather than free text because every screen sorts, filters and
-- colours by them. A typo in a text column becomes a fifth outcome nobody
-- notices until a chart looks wrong.
-- ---------------------------------------------------------------------------

create type outcome as enum (
  'flash',      -- sent it first try, having never seen anyone else do it
  'send',       -- topped out
  'highpoint',  -- got further than before, did not finish
  'fall'        -- came off
);

create type visibility as enum ('private', 'public');

-- The V scale, stored as a short integer so grades can be compared and
-- averaged. VB is the beginner grade that sits below V0.
--   -1 = VB, 0 = V0, 1 = V1, ... 17 = V17
-- Storing 'V4' as text would make "harder than" a string comparison, and
-- averaging votes would be impossible without parsing on every read.


-- ---------------------------------------------------------------------------
-- profiles
--
-- Supabase owns auth.users; this is the part of a person the app cares about.
-- One row per account, created by a trigger on sign up so no screen has to
-- remember to make one.
-- ---------------------------------------------------------------------------

create table profiles (
  id            uuid primary key references auth.users on delete cascade,
  display_name  text not null,
  avatar_url    text,

  -- Optional, and only ever shown to the person themselves. These exist
  -- because reach and ape index change which beta actually works for you,
  -- which is the whole point of comparing beta with somebody else.
  height_cm     smallint,
  ape_index_cm  smallint,

  created_at    timestamptz not null default now()
);

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();


-- ---------------------------------------------------------------------------
-- gyms
--
-- Public information. Anybody may add one, because waiting for a gym to
-- register itself is waiting forever.
-- ---------------------------------------------------------------------------

create table gyms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  city        text,
  address     text,
  lat         double precision,
  lng         double precision,
  added_by    uuid references profiles on delete set null,
  created_at  timestamptz not null default now()
);

create index gyms_city_idx on gyms (city);


-- ---------------------------------------------------------------------------
-- routes
--
-- A problem on a wall. The hard part of this table is that routes do not last:
-- a gym strips and resets a wall every few weeks, and the yellow V4 in the
-- cave next month is a different climb with the same description.
--
-- So a route is never deleted. It is marked stripped, which keeps every
-- attempt that points at it readable, and keeps last spring's session honest
-- about what was actually on the wall that day.
-- ---------------------------------------------------------------------------

create table routes (
  id           uuid primary key default gen_random_uuid(),
  gym_id       uuid not null references gyms on delete cascade,

  -- Where in the gym. Free text because every gym names its walls
  -- differently, and a fixed list would fit exactly one gym.
  area         text,

  -- How climbers actually identify a problem to each other: the tape colour
  -- and roughly where it is. Neither is unique on its own, both together
  -- usually are.
  tape_color   text,
  name         text,          -- some gyms name problems; most do not

  -- What the gym's tape says, when it says anything. Null is common and
  -- normal; consensus_grade below is the one people will look at.
  set_grade    smallint,

  set_on       date,
  stripped_on  date,          -- null means it is still on the wall

  photo_url    text,
  notes        text,

  created_by   uuid references profiles on delete set null,
  created_at   timestamptz not null default now()
);

create index routes_gym_idx on routes (gym_id);

-- Nearly every query is "what is currently on the wall at this gym", so the
-- index covers that case specifically rather than making it filter the
-- stripped ones out of a full scan.
create index routes_live_idx on routes (gym_id) where stripped_on is null;


-- ---------------------------------------------------------------------------
-- grade_votes
--
-- One opinion per person per route. The gym's grade is one opinion among
-- these rather than the answer, because set grades are inconsistent between
-- gyms and often between setters at the same gym.
-- ---------------------------------------------------------------------------

create table grade_votes (
  route_id    uuid not null references routes on delete cascade,
  user_id     uuid not null references profiles on delete cascade,
  grade       smallint not null,
  created_at  timestamptz not null default now(),
  primary key (route_id, user_id)
);

-- Consensus is computed rather than stored, so a new vote is immediately
-- reflected without anything having to recalculate a column. Rounded to the
-- nearest whole grade, with the count exposed so a single vote can be
-- presented differently from twelve.
create view route_grades as
select
  r.id                                   as route_id,
  r.set_grade,
  round(avg(v.grade))::smallint          as consensus_grade,
  count(v.*)                             as vote_count
from routes r
left join grade_votes v on v.route_id = r.id
group by r.id, r.set_grade;


-- ---------------------------------------------------------------------------
-- attempts
--
-- One try at one route. The unit everything else is counted from.
--
-- There is no sessions table. A session is the attempts that share a day and
-- a gym, which is something a query can work out. Modelling it would mean
-- asking somebody to press "end session" while they are packing their shoes
-- away, and nobody does that.
-- ---------------------------------------------------------------------------

create table attempts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles on delete cascade,
  route_id    uuid not null references routes on delete cascade,

  climbed_at  timestamptz not null default now(),
  outcome     outcome not null,
  note        text,

  created_at  timestamptz not null default now()
);

-- The two orderings every screen wants: my history newest first, and
-- everything that has happened on one route.
create index attempts_user_time_idx on attempts (user_id, climbed_at desc);
create index attempts_route_idx on attempts (route_id);


-- ---------------------------------------------------------------------------
-- videos
--
-- A recording of one attempt.
--
-- climber_id and uploaded_by are separate on purpose. In a gym people film
-- each other constantly, so the person in the video is often not the person
-- whose phone it is, and both need to be able to find it later.
--
-- Visibility defaults to private. Beta sharing is the point of the app, but a
-- video that was meant to be private and went public cannot be un-seen, while
-- one that was private and should have been shared is one tap from fixed.
-- ---------------------------------------------------------------------------

create table videos (
  id            uuid primary key default gen_random_uuid(),
  attempt_id    uuid not null references attempts on delete cascade,

  climber_id    uuid references profiles on delete set null,
  uploaded_by   uuid not null references profiles on delete cascade,

  storage_path  text not null,          -- object key in the Supabase bucket
  thumbnail_url text,
  duration_s    smallint,
  size_bytes    integer,

  visibility    visibility not null default 'private',

  created_at    timestamptz not null default now()
);

create index videos_attempt_idx on videos (attempt_id);
create index videos_climber_idx on videos (climber_id);

-- Finding beta means finding public videos for a route, which goes through
-- attempts. Worth its own index because it is the query behind the feature
-- the app is named after.
create index videos_public_idx on videos (attempt_id) where visibility = 'public';


-- ---------------------------------------------------------------------------
-- route_stats
--
-- How busy a route is and how often it goes, for the route list and for
-- deciding whether a consensus grade is worth trusting.
--
-- This has to count across everybody's attempts while the attempts table
-- itself stays private, so the view is what is exposed rather than the table.
-- Postgres runs a view as its owner unless told otherwise, which is what makes
-- that possible. Worth confirming in Supabase that security_invoker is off for
-- this view before relying on it.
-- ---------------------------------------------------------------------------

create view route_stats as
select
  r.id                                                          as route_id,
  count(a.*)                                                    as attempt_count,
  count(distinct a.user_id)                                     as climber_count,
  count(*) filter (where a.outcome in ('flash', 'send'))        as send_count,
  max(a.climbed_at)                                             as last_climbed_at
from routes r
left join attempts a on a.route_id = r.id
group by r.id;


-- ===========================================================================
-- Row level security
--
-- On from the start rather than added later. Supabase talks to the database
-- directly from the client, so a table without policies is a table anybody
-- can read. Turning this on afterwards means auditing every query already
-- written against it.
-- ===========================================================================

alter table profiles    enable row level security;
alter table gyms        enable row level security;
alter table routes      enable row level security;
alter table grade_votes enable row level security;
alter table attempts    enable row level security;
alter table videos      enable row level security;

-- Profiles: everyone can see who exists, you can only change yourself.
create policy "profiles are readable"   on profiles for select using (true);
create policy "own profile is editable" on profiles for update using (auth.uid() = id);

-- Gyms and routes are shared knowledge: readable by anyone signed in, and
-- addable by anyone, since the data only exists because climbers put it there.
create policy "gyms are readable"  on gyms  for select using (true);
create policy "gyms can be added"  on gyms  for insert with check (auth.uid() = added_by);
create policy "gyms editable by adder" on gyms for update using (auth.uid() = added_by);

create policy "routes are readable" on routes for select using (true);
create policy "routes can be added" on routes for insert with check (auth.uid() = created_by);

-- Anyone may mark a route stripped, not just whoever created it. The person
-- standing in front of the empty wall is the one who knows, and it is rarely
-- the same person who first logged the problem.
create policy "routes editable by anyone signed in"
  on routes for update using (auth.uid() is not null);

-- Grade votes: yours to write, everyone's to read, since the average is the
-- whole point.
create policy "votes are readable" on grade_votes for select using (true);
create policy "own vote is writable" on grade_votes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Attempts are personal. Other people's attempt counts feed the route's
-- popularity, but the note you wrote about falling off is yours.
create policy "own attempts" on attempts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Videos: you can always see your own, whether you filmed it or are in it.
-- Everything else has to be public.
create policy "own or public videos" on videos for select using (
  visibility = 'public'
  or auth.uid() = uploaded_by
  or auth.uid() = climber_id
);
create policy "own videos are writable" on videos
  for all using (auth.uid() = uploaded_by) with check (auth.uid() = uploaded_by);
