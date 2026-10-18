import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile


SPEC = importlib.util.spec_from_file_location("product_release", Path(__file__).with_name("check-product-release.py"))
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class ProductReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="athena-product-contract-")
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.root, self.web, self.deck = [self.base / name for name in ("main", "web", "presentation")]
        self.manifest = json.loads(Path(__file__).with_name("product-release.json").read_text(encoding="utf-8"))
        self.manifest["presentation"].update(status="canonical", slides=39)
        self.deck.mkdir(parents=True)
        self.write_pptx(39)
        for kind in ("pdf", "script", "guide"):
            artifact = self.manifest["presentation"][kind]
            path = self.deck / artifact["path"]
            path.write_text(f"synthetic test {kind}", encoding="utf-8")
            artifact["sha256"] = release.sha256(path)
        runtime = self.root / "backend/laya-runtime"
        runtime.mkdir(parents=True)
        (runtime / "policy.json").write_text(json.dumps({"force_non_defer": True, "thresholds": {"query.intent": 0}}))
        (runtime / "deployment.json").write_text(json.dumps({
            "model_id": self.manifest["capabilities"]["laya"]["modelId"],
            "policy_sha256": release.sha256(runtime / "policy.json"),
        }))
        self.write_snapshots()
        self.write_preview()

    def write_pptx(self, count):
        artifact = self.manifest["presentation"]
        with zipfile.ZipFile(self.deck / artifact["path"], "w") as archive:
            slides = "".join(f'<p:sldId id="{i + 256}"/>' for i in range(count))
            archive.writestr("ppt/presentation.xml", '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst>' + slides + '</p:sldIdLst></p:presentation>')
        artifact["sha256"] = release.sha256(self.deck / artifact["path"])

    def write_snapshots(self):
        raw = json.dumps(self.manifest).encode()
        for path in (self.root / release.MANIFEST_PATH, self.web / "config/product-release.json",
                     self.deck / "release/product-release.json"):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(raw)

    def write_preview(self):
        root = self.web / "public/presentation/slides"
        root.mkdir(parents=True, exist_ok=True)
        slides = []
        for number in range(1, 40):
            name = f"slide-{number:02}.png"
            (root / name).write_bytes(f"synthetic slide {number}".encode())
            slides.append({"number": number, "file": name, "sha256": release.sha256(root / name)})
        data = {"source": {"sha256": self.manifest["presentation"]["sha256"], "slideCount": 39},
                "displayOrder": [slide["file"] for slide in slides], "slides": slides}
        (root / "manifest.json").write_text(json.dumps(data), encoding="utf-8")

    def check(self):
        def git(_root, *_args):
            if _args[0] == "status":
                return ""
            return self.manifest["productRelease"]["sourceCommit"] if _args[-1].endswith("^{commit}") else "b" * 40
        with patch.object(release, "git", side_effect=git):
            return release.check_workspace(self.root, self.web, self.deck)

    def test_coherent_workspace_preserves_unreleased_source_distinction(self):
        self.assertEqual(self.check()["appSource"]["state"], "unreleased-source")

    def test_remote_main_must_be_contained_in_current_source(self):
        remote_head = "c" * 40
        with patch.object(release, "git", side_effect=[remote_head + "\trefs/heads/main", ""]):
            self.assertEqual(release.check_remote_main(self.root), remote_head)

    def test_behind_remote_main_is_rejected(self):
        error = release.subprocess.CalledProcessError(1, ["git", "merge-base"])
        with patch.object(release, "git", side_effect=["c" * 40 + "\trefs/heads/main", error]):
            with self.assertRaisesRegex(ValueError, "does not contain latest origin/main"):
                release.check_remote_main(self.root)

    def test_unavailable_remote_main_is_rejected(self):
        with patch.object(release, "git", return_value=""):
            with self.assertRaisesRegex(ValueError, "remote main identity is unavailable"):
                release.check_remote_main(self.root)

    def test_dirty_tag_checkout_is_not_the_released_binary_source(self):
        def git(_root, *args):
            return " M app/main.js" if args[0] == "status" else self.manifest["productRelease"]["sourceCommit"]
        with patch.object(release, "git", side_effect=git):
            result = release.check_workspace(self.root, self.web, self.deck)
        self.assertEqual(result["appSource"]["state"], "unreleased-source")
        self.assertTrue(result["appSource"]["workingTreeDirty"])

    def test_stale_website_snapshot_is_rejected(self):
        stale = copy.deepcopy(self.manifest)
        stale["productRelease"]["version"] = "0.1.1"
        (self.web / "config/product-release.json").write_text(json.dumps(stale))
        with self.assertRaisesRegex(ValueError, "snapshot differs"):
            self.check()

    def test_candidate_cannot_be_published(self):
        self.manifest["presentation"]["status"] = "candidate"
        self.write_snapshots()
        with self.assertRaisesRegex(ValueError, "not yet canonical"):
            self.check()

    def test_same_filename_changed_deck_is_rejected(self):
        with (self.deck / self.manifest["presentation"]["path"]).open("ab") as stream:
            stream.write(b"later save")
        with self.assertRaisesRegex(ValueError, "pptx hash differs"):
            self.check()

    def test_updated_hash_does_not_hide_wrong_slide_count(self):
        self.write_pptx(37)
        self.write_snapshots()
        with self.assertRaisesRegex(ValueError, "slide count differs"):
            self.check()

    def test_runtime_policy_drift_is_rejected(self):
        (self.root / "backend/laya-runtime/policy.json").write_text(json.dumps({"force_non_defer": False, "thresholds": {"query.intent": 0.9}}))
        with self.assertRaisesRegex(ValueError, "active LAYA policy differs"):
            self.check()

    def test_same_flags_do_not_hide_changed_policy_content(self):
        path = self.root / "backend/laya-runtime/policy.json"
        policy = json.loads(path.read_text())
        policy["temperature"] = 2.0
        path.write_text(json.dumps(policy))
        with self.assertRaisesRegex(ValueError, "policy hash differs"):
            self.check()

    def published_runtime(self, *, model_id=None, deployment_hash=None, release_tag=None):
        manifest = copy.deepcopy(self.manifest)
        current_hash = release.sha256(self.root / "backend/laya-runtime/deployment.json")
        info = json.dumps({
            "version": manifest["productRelease"]["version"],
            "commit": manifest["productRelease"]["sourceCommit"],
            "runtimes": {"laya": {
                "modelId": model_id or manifest["capabilities"]["laya"]["modelId"],
                "deploymentSha256": deployment_hash or current_hash,
            }},
        }).encode()
        info_hash = hashlib.sha256(info).hexdigest()
        manifest["windowsInstaller"]["buildInfoSha256"] = info_hash
        metadata = {"tag_name": release_tag or manifest["productRelease"]["tag"], "draft": False, "prerelease": False, "assets": [
            {"name": manifest["windowsInstaller"]["file"], "digest": "sha256:" + manifest["windowsInstaller"]["sha256"]},
            {"id": 7, "name": "build-info.json", "digest": "sha256:" + info_hash},
        ]}
        with patch.object(release.subprocess, "check_output", side_effect=[json.dumps(metadata).encode(), info]):
            return release.check_published(manifest, current_hash)

    def test_published_runtime_matches_local_deployment(self):
        self.assertEqual(self.published_runtime()["laya"], "verified")

    def test_old_release_pin_is_rejected_after_new_stable_release(self):
        with self.assertRaisesRegex(ValueError, "not the latest published stable release"):
            self.published_runtime(release_tag="v9.9.9")

    def test_published_runtime_model_drift_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "binary LAYA model differs"):
            self.published_runtime(model_id="different-model")

    def test_published_runtime_content_drift_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "binary LAYA deployment differs"):
            self.published_runtime(deployment_hash="a" * 64)

    def test_old_website_slides_cannot_pass_with_new_deck(self):
        path = self.web / "public/presentation/slides/manifest.json"
        preview = json.loads(path.read_text(encoding="utf-8"))
        preview["source"]["sha256"] = "a" * 64
        path.write_text(json.dumps(preview))
        with self.assertRaisesRegex(ValueError, "different presentation"):
            self.check()

    def test_reordered_preview_is_rejected(self):
        path = self.web / "public/presentation/slides/manifest.json"
        preview = json.loads(path.read_text(encoding="utf-8"))
        preview["displayOrder"].reverse()
        path.write_text(json.dumps(preview))
        with self.assertRaisesRegex(ValueError, "display order differs"):
            self.check()

    def test_unsupported_order_scope_is_rejected(self):
        self.manifest["capabilities"]["orders"]["realAccount"] = True
        with self.assertRaisesRegex(ValueError, "order scope"):
            release.validate_manifest(self.manifest)

    def test_artifact_path_cannot_escape_checkout(self):
        with self.assertRaisesRegex(ValueError, "escapes"):
            release.artifact_path(self.deck, "../outside.pptx")

    def test_release_commit_cannot_be_replaced_by_current_main(self):
        manifest = copy.deepcopy(self.manifest)
        info = json.dumps({"version": manifest["productRelease"]["version"], "commit": "b" * 40}).encode()
        info_hash = hashlib.sha256(info).hexdigest()
        manifest["windowsInstaller"]["buildInfoSha256"] = info_hash
        metadata = {"tag_name": manifest["productRelease"]["tag"], "draft": False, "prerelease": False, "assets": [
            {"name": manifest["windowsInstaller"]["file"], "digest": "sha256:" + manifest["windowsInstaller"]["sha256"]},
            {"id": 7, "name": "build-info.json", "digest": "sha256:" + info_hash},
        ]}
        with patch.object(release.subprocess, "check_output", side_effect=[json.dumps(metadata).encode(), info]):
            with self.assertRaisesRegex(ValueError, "binary source/version differs"):
                release.check_published(manifest, release.sha256(self.root / "backend/laya-runtime/deployment.json"))


if __name__ == "__main__":
    unittest.main()
