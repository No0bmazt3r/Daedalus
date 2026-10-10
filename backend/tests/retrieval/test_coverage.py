"""Graph coverage joined to the corpus — the ingestion graph-gap check."""

from __future__ import annotations

import unittest

from app.db import corpus_store
from app.services import ingestion
from app.services import knowledge_graph as kg


def setUpModule() -> None:
    from app.db import migrations  # noqa: PLC0415

    migrations.migrate("corpus")


class CorpusGapTest(unittest.TestCase):
    def setUp(self) -> None:
        self.ids = [
            ingestion.store_upload(b"1. Switch to Manual.", "SOP_Emergency_Cooldown.md", source_type="sop")["document_id"],
            ingestion.store_upload(b"Foaming notes.", "Foaming_Paper.md")["document_id"],
        ]

    def tearDown(self) -> None:
        for document_id in self.ids:
            corpus_store.delete_document(document_id)

    def test_both_directions_of_the_join(self) -> None:
        gaps = kg.coverage().as_dict()
        unlinked = {d["label"] for d in gaps["unlinked_documents"]}
        missing = {n["id"] for n in gaps["missing_documents"]}

        # Named by SOPDocument:Emergency_Cooldown — reachable from both tracks.
        self.assertNotIn("SOP_Emergency_Cooldown.md", unlinked)
        self.assertNotIn("SOPDocument:Emergency_Cooldown", missing)
        # Ingested, but no node names it: Track 1 only.
        self.assertIn("Foaming_Paper.md", unlinked)
        # Named by a node, but never ingested: the node cites nothing.
        self.assertIn("SOPDocument:Pressure_Relief", missing)
        self.assertGreaterEqual(gaps["total_gaps"], len(unlinked) + len(missing))


if __name__ == "__main__":
    unittest.main()
