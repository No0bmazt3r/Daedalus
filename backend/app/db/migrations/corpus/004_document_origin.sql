-- Whose document this is: this rig's own, or a reference from another installation.
--
-- The corpus mixes the lab's own manuals and SOPs with public literature —
-- other analysers' manuals, other universities' SOPs, other pilot plants'
-- incident reports. Their *concepts* transfer (foaming is foaming on any amine
-- rig); their *specifics* do not (another plant's setpoints, valve tags and step
-- order can be wrong for this one). An answer has to be able to tell the two
-- apart, so every document says which it is.
--
-- `reference` is the default on purpose: nothing counts as this rig's unless a
-- person said so. Existing rows become `reference` for the same reason.
--
-- Read from here at query time rather than copied onto each vector's metadata,
-- so correcting a document's origin takes effect on the next question instead
-- of waiting for a re-ingest.
ALTER TABLE documents ADD COLUMN origin TEXT NOT NULL DEFAULT 'reference'
    CHECK (origin IN ('rig', 'reference'));

CREATE INDEX IF NOT EXISTS idx_documents_origin ON documents(origin);
