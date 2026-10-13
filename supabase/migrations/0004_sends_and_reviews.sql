-- ===========================================================================
-- 0004  sends, reviews, and routes that outlive the wall
--
-- Three changes, all of them narrowing what the app asks somebody to enter.
--
-- 1. Attempts become sends. 0001 modelled four outcomes and counted how many
--    tries something took. Nobody wants to log a fall, and a video of a fall
--    is not beta. The unit is now "I climbed this", once per go, and the
--    outcome enum goes with it.
--
-- 2. Stripped no longer means hidden. A route that came off the wall is still
--    the route in somebody's video and somebody's session, and it should stay
--    findable by name. stripped_on now only says "this is not up any more";
--    which list a route appears in is a question for the screen, not the
--    schema.
--
-- 3. Ratings and comments. How good a problem is cannot be derived from
--    anything already stored, and it is the one thing climbers say to each
--    other unprompted.
--
-- Plus a setter name on routes, as free text. Gyms are not partners here, so
-- there is no setter account to link to, but the name is often chalked on the
-- wall next to the tape and it is worth keeping when somebody knows it.
-- ===========================================================================


-- The view reads attempts.outcome, so it cannot outlive the column.
drop view if exists route_stats;


-- ---------------------------------------------------------------------------
-- Who set it
-- ---------------------------------------------------------------------------

alter table routes add column setter text;


-- ---------------------------------------------------------------------------
-- attempts becomes sends
--
-- Renamed rather than replaced so the videos already pointing at rows keep
-- pointing at them.
-- ---------------------------------------------------------------------------

alter table attempts drop column outcome;
drop type if exists outcome;

alter table attempts rename to sends;
alter table sends rename column climbed_at to sent_at;

alter index attempts_user_time_idx rename to sends_user_time_idx;
alter index attempts_route_idx     rename to sends_route_idx;

alter policy "own attempts" on sends rename to "own sends";

alter table videos rename column attempt_id to send_id;
alter index videos_attempt_idx rename to videos_send_idx;


-- ---------------------------------------------------------------------------
-- route_reviews
--
-- One per person per route, which is what keeps an average honest: somebody
-- who loves a problem can say so once. Coming back to change your mind updates
-- the row rather than adding a second opinion.
--
-- Both fields are optional on their own but not together, because a review
-- that is neither a score nor a sentence is an empty row.
-- ---------------------------------------------------------------------------

create table route_reviews (
  route_id   uuid not null references routes on delete cascade,
  user_id    uuid not null references profiles on delete cascade,

  rating     smallint check (rating between 1 and 5),
  comment    text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (route_id, user_id),
  constraint review_says_something check (rating is not null or nullif(btrim(comment), '') is not null)
);

create index route_reviews_route_idx on route_reviews (route_id, created_at desc);

alter table route_reviews enable row level security;

-- Readable by everyone: an average nobody can see is not a rating. Writable
-- only as yourself, which the primary key then limits to one per route.
create policy "reviews are readable" on route_reviews for select using (true);
create policy "own review is writable" on route_reviews
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- route_stats, rebuilt
--
-- Counts across everybody while sends and reviews stay row level secured, so
-- the view is what the app reads rather than the tables. Postgres runs a view
-- as its owner unless told otherwise, which is what makes that work.
-- ---------------------------------------------------------------------------

create view route_stats as
select
  r.id                                                    as route_id,
  count(s.*)                                              as send_count,
  count(distinct s.user_id)                               as climber_count,
  max(s.sent_at)                                          as last_sent_at,

  -- Subqueries rather than a second join, because joining reviews alongside
  -- sends would multiply the rows and count every send once per review.
  (select count(*) from route_reviews v where v.route_id = r.id)
                                                          as review_count,
  (select round(avg(v.rating)::numeric, 1)
     from route_reviews v
    where v.route_id = r.id and v.rating is not null)     as rating
from routes r
left join sends s on s.route_id = r.id
group by r.id;
