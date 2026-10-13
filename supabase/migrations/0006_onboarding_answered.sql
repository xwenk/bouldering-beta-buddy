-- ===========================================================================
-- 0006  remembering that we asked
--
-- Height and ape index are asked for once, up front, because somebody who is
-- never asked at the start is never going to go and find the settings screen,
-- and the data is gone. That much was already true.
--
-- But asking up front only works if "no" is a real answer. Some people will
-- not want to hand over their measurements, and an app that shrugs and asks
-- again on every launch has not given them a choice, it has given them a wall.
--
-- So "we asked" has to be recorded separately from "they answered". Without
-- this column the only signal is height_cm, and a declined profile looks
-- exactly like a brand new one forever.
-- ===========================================================================

alter table profiles add column onboarded_at timestamptz;

-- Anybody who already filled this in has plainly been asked, and should not be
-- sent back through it by this migration.
update profiles
   set onboarded_at = created_at
 where height_cm is not null;
