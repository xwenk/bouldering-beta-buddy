-- ===========================================================================
-- 0008  room for a two minute climb
--
-- 0005 capped videos at a minute, on the reasoning that a boulder problem is
-- over in well under that. True of most, and wrong about the ones people most
-- want beta for: a balance heavy slab is slow by definition, and cutting the
-- video off before the top is cutting off the part somebody came to watch.
--
-- Two minutes, and the byte limit doubled to match, since a 1080p phone
-- recording of that length lands well past the old 100 MB.
-- ===========================================================================

update storage.buckets
   set file_size_limit = 209715200  -- 200 MB
 where id = 'videos';
