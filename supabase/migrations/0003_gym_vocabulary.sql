-- ===========================================================================
-- 0003  each gym's own vocabulary
--
-- 0001 assumed every gym speaks the V scale and that the real grade is what
-- climbers average out between them. Both assumptions are wrong.
--
-- Gyms do not agree on a scale. Some tape a V grade, some print a French
-- number, and plenty grade by colour alone, where "blue" is the grade and no
-- number exists anywhere in the building. A single smallint cannot hold all
-- three, and translating between them is a judgement call this app has no
-- business making on a climber's behalf.
--
-- So the grade ladder belongs to the gym, not to the app. A gym gets an
-- ordered list of rungs, and a route points at one of them. Sorting still
-- works because the order is stored; the label is whatever the gym actually
-- writes on the wall.
--
-- Walls get the same treatment. A gym has a fixed set of them with names
-- already painted above them, so free text per route was asking every climber
-- to re-type something the gym decided years ago, and to spell it the same way
-- every time.
--
-- This information does not exist in any public dataset. OpenStreetMap and
-- Google both carry a gym's name, address and opening hours and nothing about
-- its walls or its grading. So one person enters it once per gym, and everyone
-- after them picks from a list.
--
-- Consensus grading goes entirely. grade_votes and the route_grades view are
-- dropped: the gym's grade is the grade.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- How a gym grades
-- ---------------------------------------------------------------------------

alter table gyms
  add column grading_system text
    check (grading_system in ('v_scale', 'font', 'color')),

  -- Who filled this in, and when. Not for credit: for knowing whether the
  -- gym has been set up at all, which is what the app asks before it can
  -- offer anyone a grade to pick.
  add column set_up_by uuid references profiles on delete set null,
  add column set_up_at timestamptz;


-- ---------------------------------------------------------------------------
-- gym_grades
--
-- One row per rung of one gym's ladder, easiest first.
--
-- Colour graded gyms get a hex alongside the label, because at those gyms the
-- colour *is* the grade and a chip that reads "Blue" in grey text is missing
-- the only thing that made it recognisable.
-- ---------------------------------------------------------------------------

create table gym_grades (
  id         uuid primary key default gen_random_uuid(),
  gym_id     uuid not null references gyms on delete cascade,

  -- Difficulty order within this gym. Nothing compares positions across two
  -- gyms, because a gym's third colour is not another gym's third colour.
  position   smallint not null,

  label      text not null,          -- 'V4', '6C', 'Blue' - as the gym writes it
  color_hex  text,                   -- set only when the gym grades by colour

  created_at timestamptz not null default now(),
  unique (gym_id, position)
);

create index gym_grades_gym_idx on gym_grades (gym_id, position);


-- ---------------------------------------------------------------------------
-- gym_walls
--
-- The walls a gym has, in the order you meet them walking in.
-- ---------------------------------------------------------------------------

create table gym_walls (
  id         uuid primary key default gen_random_uuid(),
  gym_id     uuid not null references gyms on delete cascade,
  name       text not null,
  position   smallint not null default 0,
  created_by uuid references profiles on delete set null,
  created_at timestamptz not null default now(),
  unique (gym_id, name)
);

create index gym_walls_gym_idx on gym_walls (gym_id, position);


-- ---------------------------------------------------------------------------
-- routes, rewritten against that vocabulary
-- ---------------------------------------------------------------------------

alter table routes
  add column grade_id   uuid references gym_grades on delete set null,
  add column wall_id    uuid references gym_walls  on delete set null,

  -- The colour of the holds. Separate from the grade even at colour graded
  -- gyms, because this is the thing you look for from across the room and it
  -- stays the answer to "which one is it" no matter how the gym grades.
  add column hold_color text;

-- Carry the free text that was there before into the new tables, so the
-- routes already logged do not lose where they are.
insert into gym_walls (gym_id, name)
select distinct gym_id, trim(area)
from routes
where area is not null and trim(area) <> ''
on conflict (gym_id, name) do nothing;

update routes r
   set wall_id = w.id
  from gym_walls w
 where w.gym_id = r.gym_id
   and w.name = trim(r.area);

update routes set hold_color = tape_color where tape_color is not null;


-- ---------------------------------------------------------------------------
-- Consensus grading, removed
--
-- The view goes before the columns it reads, not after: Postgres refuses to
-- drop a column a view still selects.
-- ---------------------------------------------------------------------------

drop view  if exists route_grades;
drop table if exists grade_votes;

alter table routes
  drop column area,
  drop column tape_color,
  drop column set_grade;


-- ---------------------------------------------------------------------------
-- Seeding the standard ladders
--
-- V and Font are published scales, so nobody should have to type them in.
-- Colour is per gym by definition and is entered by hand during setup.
-- ---------------------------------------------------------------------------

create or replace function seed_gym_grades(p_gym uuid, p_system text)
returns void
language plpgsql
as $$
declare
  labels text[];
begin
  if p_system = 'v_scale' then
    labels := array[
      'VB','V0','V1','V2','V3','V4','V5','V6',
      'V7','V8','V9','V10','V11','V12'
    ];
  elsif p_system = 'font' then
    labels := array[
      '3','4','4+','5','5+','6A','6A+','6B','6B+',
      '6C','6C+','7A','7A+','7B','7B+','7C','7C+','8A'
    ];
  else
    -- 'color', or anything unrecognised: the gym supplies its own rungs.
    return;
  end if;

  delete from gym_grades where gym_id = p_gym;

  insert into gym_grades (gym_id, position, label)
  select p_gym, i - 1, labels[i]
  from generate_subscripts(labels, 1) as i;
end;
$$;


-- ===========================================================================
-- Row level security
--
-- The same rule routes already follow: this is shared knowledge that only
-- exists because a climber typed it in, so anybody signed in may read it and
-- anybody signed in may correct it. A gym that renamed a wall should be
-- fixable by whoever is standing in front of the new sign.
-- ===========================================================================

alter table gym_grades enable row level security;
alter table gym_walls  enable row level security;

create policy "gym grades are readable" on gym_grades for select using (true);
create policy "gym grades are editable" on gym_grades
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy "gym walls are readable" on gym_walls for select using (true);
create policy "gym walls are editable" on gym_walls
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- Gyms were only editable by whoever added them, which does not survive
-- contact with how gyms get added: one person adds it from a search result in
-- another city, and a different person is the one who actually climbs there
-- and knows how it grades.
drop policy if exists "gyms editable by adder" on gyms;
create policy "gyms editable by anyone signed in"
  on gyms for update using (auth.uid() is not null);
