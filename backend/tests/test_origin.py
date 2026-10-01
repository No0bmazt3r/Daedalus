"""Document origin — this rig's own, or a reference from another installation."""

from __future__ import annotations

import json
import unittest

from app.db import audit_store, corpus_store
from app.services import agent_tools, ingestion
from app.services import knowledge_graph as kg
from app.services.orchestration import evidence, prompt

from . import fixtures


def upload(text: str, **kw: object) -> dict:
    return ingestion.store_upload(text.encode(), f"{abs(hash(text))}.txt", **kw)  # type: ignore[arg-type]


def chunk(document_id: str, chunk_id: str) -> None:
    corpus_store.replace_chunks(document_id, [{
        "chunk_id": chunk_id, "ordinal": 0, "text": "x", "char_start": 0, "char_end": 1,
    }], run_id="test")


def passage(origin: str | None) -> dict:
    c = {"chunk_id": "c1", "source_file": "SOP.pdf", "text": "Close ABV-1 first."}
    if origin:
        c["origin"] = origin
    return {"tool": "search_corpus", "ok": True, "status": "ok", "integrity": "corpus", "citable": True,
            "data": {"track": "vector", "chunks": [c]}}


def setUpModule() -> None:
    from app.db import migrations  # noqa: PLC0415

    migrations.migrate("corpus")


class CorpusOriginTest(unittest.TestCase):
    def test_reference_is_the_default(self) -> None:
        self.assertEqual(upload("an unlabelled manual")["origin"], "reference")

    def test_rig_is_kept_and_can_be_corrected(self) -> None:
        doc = upload("this lab's startup SOP", origin="rig")
        self.assertEqual(doc["origin"], "rig")
        self.assertEqual(corpus_store.update_document(doc["document_id"], origin="reference")["origin"],
                         "reference")

    def test_the_store_refuses_anything_else(self) -> None:
        doc = upload("a third document")
        with self.assertRaises(Exception):
            corpus_store.update_document(doc["document_id"], origin="ours")

    def test_origin_is_read_at_query_time(self) -> None:
        doc = upload("a fourth document", origin="rig")
        chunk(doc["document_id"], "chunk-q1")
        self.assertEqual(corpus_store.origins_for(["chunk-q1", "gone"]), {"chunk-q1": "rig"})
        corpus_store.update_document(doc["document_id"], origin="reference")
        self.assertEqual(corpus_store.origins_for(["chunk-q1"]), {"chunk-q1": "reference"})

    def test_api_validates_origin(self) -> None:
        from fastapi.testclient import TestClient  # noqa: PLC0415

        from app.main import app  # noqa: PLC0415

        client = TestClient(app)
        bad = client.post("/api/corpus/documents", params={"filename": "a.txt", "origin": "mine"},
                          content=b"text")
        self.assertEqual(bad.status_code, 400)
        ok = client.post("/api/corpus/documents", params={"filename": "b.txt", "origin": "rig"},
                         content=b"our own procedure")
        self.assertEqual(ok.json()["document"]["origin"], "rig")
        patched = client.patch(f"/api/corpus/documents/{ok.json()['document']['document_id']}",
                               json={"origin": "reference"})
        self.assertIn("no re-ingest", patched.json()["note"])


class GraphOriginTest(unittest.TestCase):
    def test_defaults(self) -> None:
        self.assertEqual(kg.origin_of({"type": "Sensor"}), "rig")
        self.assertEqual(kg.origin_of({"type": "OperatingMode", "origin": "reference"}), "rig")
        self.assertEqual(kg.origin_of({"type": "SOPDocument"}), "reference")
        self.assertEqual(kg.origin_of({"type": "Threshold", "origin": "rig"}), "rig")

    def test_a_bad_origin_fails_validation(self) -> None:
        raw = {"nodes": [{"id": "SOPDocument:x", "type": "SOPDocument", "origin": "ours"}], "edges": []}
        with self.assertRaises(kg.GraphValidationError):
            kg._build(raw)  # noqa: SLF001


class EvidenceOriginTest(unittest.TestCase):
    def test_passages_say_whose_they_are(self) -> None:
        rig = evidence.build([passage("rig")]).items[0]
        ref = evidence.build([passage("reference")]).items[0]
        missing = evidence.build([passage(None)]).items[0]
        self.assertIn("[THIS RIG]", rig.line)
        self.assertIn("[REFERENCE: another installation]", ref.line)
        self.assertIn("[REFERENCE: another installation]", missing.line)
        self.assertEqual(rig.citation["origin"], "rig")

    def test_graph_nodes_say_whose_they_are_except_sensors(self) -> None:
        env = {"tool": "graph_walk", "ok": True, "status": "ok", "integrity": "system", "citable": True,
               "data": {"track": "graph", "nodes": [
                   {"id": "Sensor:ph", "type": "Sensor", "label": "pH"},
                   {"id": "SOPDocument:a", "type": "SOPDocument", "label": "Ours", "origin": "rig"},
                   {"id": "SOPDocument:b", "type": "SOPDocument", "label": "Theirs"},
               ]}}
        lines = [i.line for i in evidence.build([env]).items]
        self.assertNotIn("[", lines[0].split("]", 1)[1])  # nothing after the label
        self.assertIn("[THIS RIG]", lines[1])
        self.assertIn("[REFERENCE: another installation]", lines[2])

    def test_the_prompt_says_what_reference_means(self) -> None:
        self.assertIn("[REFERENCE: another installation]", prompt.SYSTEM_PROMPT)


class LoggedOriginTest(unittest.TestCase):
    def test_graph_retrieval_logs_an_origin_per_node(self) -> None:
        fixtures.set_track("graph")
        try:
            query_id = audit_store.new_query_id()
            agent_tools.call("graph_walk", {"query": "what should I do about high co2"}, query_id=query_id)
        finally:
            fixtures.set_track("vector")
        row = audit_store.trace(query_id)["rag_logs"][0]
        ids, origins = json.loads(row["retrieved_chunk_ids"]), json.loads(row["retrieved_origins"])
        self.assertEqual(len(ids), len(origins))
        self.assertEqual(origins[ids.index("Sensor:co2_ppm")], "rig")
        self.assertTrue(set(origins) <= {"rig", "reference"})


if __name__ == "__main__":
    unittest.main()
