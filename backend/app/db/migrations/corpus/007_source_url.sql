-- Where a document was downloaded from, when it came from Settings → Search
-- ("Add to corpus") rather than an upload. NULL for uploads. Kept so a
-- citation can be traced back to the page it was read from.
ALTER TABLE documents ADD COLUMN source_url TEXT;
