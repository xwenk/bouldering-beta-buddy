-- ===========================================================================
-- 0007  weight
--
-- Height and reach decide whether a move is even in range. Weight decides
-- whether it goes once it is: pulling through a steep section is a question of
-- strength against bodyweight, and it is the reason two climbers of the same
-- height climb the same problem completely differently.
--
-- Not folded into the beta matching that height and ape index drive. Somebody
-- your height with a different build still reaches the same holds, so sorting
-- by weight would push away beta that would have worked. It is here for what
-- the analysis says about your own climbing, which is the part where strength
-- against bodyweight actually means something.
--
-- Nullable like the rest. This is the field people are most likely to skip,
-- and a made up number here is worse than a missing one.
-- ===========================================================================

alter table profiles add column weight_kg smallint
  check (weight_kg between 25 and 250);
