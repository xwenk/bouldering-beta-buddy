-- ===========================================================================
-- 0009  the size limit that is actually enforced
--
-- 0008 set the bucket to 200 MB and it did nothing. Supabase caps every bucket
-- at the project's global file size limit, and on the free plan that limit is
-- 50 MB and cannot be raised:
--
--   PATCH /v1/projects/{ref}/config/storage  {"fileSizeLimit": 209715200}
--   -> "File size limit more than 52,428,800 bytes. Please upgrade the
--       project to a paid plan to unlock higher file size limits."
--
-- So an 87 MB upload was refused by the project before the bucket was ever
-- consulted, and the app reported a 200 MB limit that does not exist. A limit
-- the code believes in but the server does not is worse than a low one.
--
-- 50 MB is roughly two minutes at 540p, one minute at 720p, or twenty five
-- seconds at 1080p, which is why the app now transcodes on the way out rather
-- than hoping.
-- ===========================================================================

update storage.buckets
   set file_size_limit = 52428800  -- 50 MB, the free plan ceiling
 where id = 'videos';
