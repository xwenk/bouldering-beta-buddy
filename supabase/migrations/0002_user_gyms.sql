-- ===========================================================================
-- 0002  my gyms
--
-- The gyms table is a shared directory: every gym anybody has added, visible
-- to everyone. That is the right shape for finding a place, and the wrong
-- shape for opening the app at your usual gym, where a list of every gym in
-- the world is noise.
--
-- So which gyms are *yours* is its own thing. It is a list per person rather
-- than a column on gyms, because the same gym is somebody's home wall and
-- somebody else's holiday visit.
-- ===========================================================================

create table user_gyms (
  user_id    uuid not null references profiles on delete cascade,
  gym_id     uuid not null references gyms on delete cascade,

  -- Set when a session is logged there, so the list can lead with wherever
  -- somebody actually climbs rather than whatever they added first.
  last_visit date,

  created_at timestamptz not null default now(),
  primary key (user_id, gym_id)
);

create index user_gyms_user_idx on user_gyms (user_id);

alter table user_gyms enable row level security;

-- Nobody else's business which gyms somebody goes to.
create policy "own gym list" on user_gyms
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
