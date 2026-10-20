import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from verification.wts_local_planner_probe import (
    MODEL_PROFILES,
    artifact_payload,
    is_safe_model_file,
    local_integrity_record,
    matches_expected,
    model_file_manifest,
    parse_strict_plan,
    process_memory,
    render_chat_prompt,
    verify_upstream_file_identities,
)


class WtsLocalPlannerProbeTests(unittest.TestCase):
    def test_strict_action_accepts_only_catalog_shape(self):
        plan = parse_strict_plan(json.dumps({
            "type": "action",
            "actions": [{
                "id": "wts.main.p3.chart.period.set",
                "args": {"period": "week"},
            }],
        }))
        self.assertEqual(plan["actions"][0]["args"]["period"], "week")

        with self.assertRaises(ValueError):
            parse_strict_plan('{"type":"action","actions":[{"id":"order.place","args":{}}]}')
        with self.assertRaises(ValueError):
            parse_strict_plan('```json\n{"type":"clarify","message":"확인"}\n```')
        with self.assertRaises(ValueError):
            parse_strict_plan(json.dumps({
                "type": "action",
                "actions": [{
                    "id": "wts.main.p3.chart.period.set",
                    "args": {"period": "month"},
                }],
            }))

    def test_non_action_expectation_checks_type_only(self):
        self.assertTrue(matches_expected(
            {"type": "clarify", "message": "어떤 주기로 바꿀까요?"},
            {"type": "clarify"},
        ))
        self.assertFalse(matches_expected(
            {"type": "refuse", "message": "지원하지 않습니다"},
            {"type": "clarify"},
        ))

    def test_model_file_policy_rejects_executable_and_pickle_formats(self):
        self.assertTrue(is_safe_model_file("model-00001-of-00003.safetensors"))
        self.assertTrue(is_safe_model_file("tokenizer.json"))
        self.assertFalse(is_safe_model_file("modeling_qwen.py"))
        self.assertFalse(is_safe_model_file("pytorch_model.bin"))

    def test_profile_manifest_does_not_absorb_nested_model_profile(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "config.json").write_text("{}", encoding="utf-8")
            nested = root / "other-profile"
            nested.mkdir()
            (nested / "config.json").write_text("{}", encoding="utf-8")
            manifest = model_file_manifest(root)
        self.assertEqual([item["path"] for item in manifest], ["config.json"])

    def test_artifact_cannot_claim_qualification_or_promotion(self):
        payload = artifact_payload(
            {"repo": "synthetic", "files": []},
            {"status": "completed", "cases": [
                {"strict_json": True, "correct": True, "latency_seconds": 9.5},
                {"strict_json": True, "correct": False, "latency_seconds": 12.0},
            ]},
        )
        self.assertFalse(payload["claims"]["m1_full_qualification"])
        self.assertFalse(payload["claims"]["model_promoted"])
        self.assertFalse(payload["claims"]["training_performed"])
        self.assertEqual(payload["summary"]["strict_json_count"], 2)
        self.assertEqual(payload["summary"]["correct_count"], 1)
        self.assertFalse(payload["summary"]["all_cases_correct"])
        self.assertFalse(payload["summary"]["interactive_latency_gate_pass"])
        self.assertEqual(
            payload["summary"]["candidate_status"],
            "not-qualified-interactive-latency",
        )

    def test_artifact_status_precedes_latency_classification(self):
        scenarios = (
            ({"status": "timed_out", "cases": []}, "probe-timed-out"),
            ({"status": "error", "cases": []}, "probe-error"),
            ({"status": "completed", "cases": []}, "no-measurement"),
        )
        for probe, expected in scenarios:
            with self.subTest(expected=expected):
                summary = artifact_payload({}, probe)["summary"]
                self.assertEqual(summary["candidate_status"], expected)
                self.assertIsNone(summary["interactive_latency_gate_pass"])

    def test_process_memory_probe_is_numeric_on_windows(self):
        memory = process_memory()
        self.assertIn("peak_working_set_gib", memory)
        if __import__("os").name == "nt":
            self.assertIsInstance(memory["working_set_gib"], float)
            self.assertGreater(memory["working_set_gib"], 0)

    def test_upstream_lfs_identity_must_match_local_sha256(self):
        local = [{
            "path": "model.safetensors",
            "bytes": 3,
            "sha256": "abc",
            "git_blob_sha1": "unused-for-lfs",
        }]
        sibling = SimpleNamespace(
            rfilename="model.safetensors",
            size=3,
            blob_id="blob",
            lfs=SimpleNamespace(sha256="abc"),
        )
        verified = verify_upstream_file_identities(local, [sibling])
        self.assertTrue(verified[0]["sha256_verified_against_upstream"])
        sibling.lfs.sha256 = "different"
        with self.assertRaises(RuntimeError):
            verify_upstream_file_identities(local, [sibling])

    def test_upstream_git_blob_identity_must_match_non_lfs_file(self):
        contents = b"{}"
        blob_sha1 = hashlib.sha1(
            b"blob 2\0" + contents,
            usedforsecurity=False,
        ).hexdigest()
        local = [{
            "path": "config.json",
            "bytes": 2,
            "sha256": hashlib.sha256(contents).hexdigest(),
            "git_blob_sha1": blob_sha1,
        }]
        sibling = SimpleNamespace(
            rfilename="config.json",
            size=2,
            blob_id=blob_sha1,
            lfs=None,
        )
        verified = verify_upstream_file_identities(local, [sibling])
        self.assertTrue(verified[0]["git_blob_verified_against_upstream"])
        sibling.blob_id = "different"
        with self.assertRaises(RuntimeError):
            verify_upstream_file_identities(local, [sibling])

    def test_chat_template_explicitly_disables_thinking(self):
        class Tokenizer:
            def apply_chat_template(self, messages, **kwargs):
                self.messages = messages
                self.kwargs = kwargs
                return "prompt"

        tokenizer = Tokenizer()
        prompt = render_chat_prompt(
            tokenizer,
            [{"role": "user", "content": "합성"}],
        )
        self.assertEqual(prompt, "prompt")
        self.assertFalse(tokenizer.kwargs["enable_thinking"])
        self.assertFalse(tokenizer.kwargs["tokenize"])
        self.assertTrue(tokenizer.kwargs["add_generation_prompt"])

    def test_skip_download_record_does_not_claim_pinned_revision(self):
        record = local_integrity_record(
            MODEL_PROFILES["1.7b"],
            [{"path": "model.safetensors", "bytes": 3, "sha256": "abc"}],
        )
        self.assertIsNone(record["resolved_revision"])
        self.assertFalse(record["revision_verified"])
        self.assertFalse(record["license_verified"])
        self.assertTrue(record["local_integrity_only"])


if __name__ == "__main__":
    unittest.main()
