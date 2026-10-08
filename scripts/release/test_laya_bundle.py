"""Tiny artifacts exercise packaging checks without distributing or loading a model."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from laya_bundle import stage_bundle, validate_bundle


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class BundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="athena-laya-bundle-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "source"
        self.source.mkdir()
        files = {
            "catalog.json": {}, "policy.json": {},
            "checkpoint/rl_agent_config.json": {}, "checkpoint/model.safetensors": "tiny fixture",
            "checkpoint/encoder/config.json": {}, "checkpoint/tokenizer/tokenizer.json": {},
            "checkpoint/tokenizer/tokenizer_config.json": {}, "notices/MODEL-TERMS.txt": "Fixture model terms",
        }
        for name, value in files.items():
            path = self.source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(value), encoding="utf-8")
        self.deployment = {
            "schema_version": 1, "model_id": "fixture", "checkpoint_path": "checkpoint",
            "catalog_path": "catalog.json", "policy_path": "policy.json",
            "catalog_sha256": digest(self.source / "catalog.json"),
            "policy_sha256": digest(self.source / "policy.json"),
            "checkpoint_sha256": {name.removeprefix("checkpoint/"): digest(self.source / name)
                                  for name in files if name.startswith("checkpoint/")},
        }
        deployment_path = self.source / "deployment.json"
        deployment_path.write_text(json.dumps(self.deployment), encoding="utf-8")
        self.bundle = {
            "schema_version": 1, "deployment_sha256": digest(deployment_path),
            "files": {name: digest(self.source / name) for name in [*files, "deployment.json"]},
            "notices": ["notices/MODEL-TERMS.txt"], "dependencies": [],
        }
        for name, version in (("laya", "0.3.21"), ("torch", "2.11.0+cpu")):
            wheel = f"wheels/{name}-{version}-py3-none-any.whl"
            path = self.source / wheel
            path.parent.mkdir(exist_ok=True)
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr(f"{name}-{version}.dist-info/METADATA", f"Name: {name}\nVersion: {version}\n")
            self.bundle["dependencies"].append({"name": name, "version": version,
                                                 "wheel": wheel, "sha256": digest(path)})
        self.save()

    def save(self, *, deployment_changed=False):
        if deployment_changed:
            path = self.source / "deployment.json"
            path.write_text(json.dumps(self.deployment), encoding="utf-8")
            self.bundle["files"]["deployment.json"] = digest(path)
            self.bundle["deployment_sha256"] = digest(path)
        (self.source / "bundle.json").write_text(json.dumps(self.bundle), encoding="utf-8")

    def test_stage_only_bound_runtime_files_and_keep_wheels_outside_installer(self):
        (self.source / "unlisted-training-data.json").write_text("private", encoding="utf-8")
        target, dependencies = self.root / "installed", self.root / "build-dependencies"
        stage_bundle(self.source, target, dependencies)
        self.assertEqual(validate_bundle(target, require_wheels=False), self.bundle)
        self.assertEqual({path.relative_to(target).as_posix() for path in target.rglob("*") if path.is_file()},
                         set(self.bundle["files"]) | {"bundle.json"})
        self.assertFalse((target / "wheels").exists())
        requirements = (dependencies / "requirements.txt").read_text(encoding="utf-8")
        for item in self.bundle["dependencies"]:
            self.assertEqual(digest(dependencies / item["wheel"]), item["sha256"])
            self.assertIn(f"{item['name']}=={item['version']} --hash=sha256:{item['sha256']}\n", requirements)

    def test_corrupt_weight_rejected_before_any_stage_directory_created(self):
        (self.source / "checkpoint/model.safetensors").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "SHA256 mismatch"):
            stage_bundle(self.source, self.root / "installed", self.root / "dependencies")
        self.assertFalse((self.root / "installed").exists())

    def test_missing_checkpoint_file_fails(self):
        (self.source / "checkpoint/model.safetensors").unlink()
        with self.assertRaises(FileNotFoundError):
            validate_bundle(self.source)

    def test_unsafe_paths_fail_even_when_file_exists_outside_package(self):
        (self.root / "secret.txt").write_text("secret", encoding="utf-8")
        for name in ("notices/../../secret.txt", "notices/../secret.txt", "C:/secret.txt", "notices\\secret.txt", "/secret.txt"):
            with self.subTest(name=name):
                original = self.bundle["files"].copy()
                self.bundle["files"][name] = "0" * 64
                self.save()
                with self.assertRaisesRegex(ValueError, "unsafe relative"):
                    validate_bundle(self.source)
                self.bundle["files"] = original

    def test_rejects_symlink_file_without_following_it(self):
        original = Path.is_symlink
        with patch.object(Path, "is_symlink", lambda path: path.name == "model.safetensors" or original(path)):
            with self.assertRaisesRegex(ValueError, "symlinks"):
                validate_bundle(self.source)

    def test_rejects_lfs_pointer_even_with_matching_hash(self):
        name = "checkpoint/model.safetensors"
        (self.source / name).write_text("version https://git-lfs.github.com/spec/v1\noid sha256:" + "0" * 64, encoding="utf-8")
        self.bundle["files"][name] = digest(self.source / name)
        self.save()
        with self.assertRaisesRegex(ValueError, "Git LFS pointer"):
            validate_bundle(self.source)

    def test_deployment_cannot_reference_machine_local_checkpoint(self):
        self.deployment["checkpoint_path"] = "C:/external/model"
        self.save(deployment_changed=True)
        with self.assertRaisesRegex(ValueError, "portable bundle layout"):
            validate_bundle(self.source)

    def test_checkpoint_and_deployment_pin_must_match_manifest(self):
        self.bundle["deployment_sha256"] = "0" * 64
        self.save()
        with self.assertRaisesRegex(ValueError, "deployment pin"):
            validate_bundle(self.source)
        self.deployment["checkpoint_sha256"]["model.safetensors"] = "0" * 64
        self.save(deployment_changed=True)
        with self.assertRaisesRegex(ValueError, "checkpoint binding"):
            validate_bundle(self.source)

    def test_cuda_wheel_rejected(self):
        self.bundle["dependencies"][1]["version"] = "2.11.0+cu128"
        self.save()
        with self.assertRaisesRegex(ValueError, "CPU Torch"):
            validate_bundle(self.source)

    def test_dependency_options_or_urls_cannot_be_injected(self):
        for value in ("0.3.21 --index-url=https://example.invalid", "https://example.invalid/a.whl", "0.3.21\n--no-index"):
            with self.subTest(version=value):
                self.bundle["dependencies"][0]["version"] = value
                self.save()
                with self.assertRaisesRegex(ValueError, "invalid dependency pin"):
                    validate_bundle(self.source)

    def test_dependency_hash_and_metadata_are_verified(self):
        item = self.bundle["dependencies"][0]
        item["sha256"] = "0" * 64
        self.save()
        with self.assertRaisesRegex(ValueError, "wheel SHA256"):
            validate_bundle(self.source)
        item["sha256"] = digest(self.source / item["wheel"])
        item["version"] = "0.3.22"
        self.save()
        with self.assertRaisesRegex(ValueError, "wheel metadata"):
            validate_bundle(self.source)

    def test_vendored_dependency_metadata_is_not_wheel_distribution_metadata(self):
        item = self.bundle["dependencies"][0]
        path = self.source / item["wheel"]
        with zipfile.ZipFile(path, "a") as archive:
            archive.writestr("laya/_vendor/packaging-1.0.dist-info/METADATA", "Name: packaging\nVersion: 1.0\n")
        item["sha256"] = digest(path)
        self.save()
        self.assertEqual(validate_bundle(self.source), self.bundle)

    def test_case_collisions_and_missing_notices_are_rejected(self):
        self.bundle["files"]["Catalog.json"] = self.bundle["files"]["catalog.json"]
        self.save()
        with self.assertRaisesRegex(ValueError, "case-insensitive duplicate"):
            validate_bundle(self.source)
        del self.bundle["files"]["Catalog.json"]
        self.bundle["notices"] = []
        self.save()
        with self.assertRaisesRegex(ValueError, "notices"):
            validate_bundle(self.source)

    def test_staging_cannot_overwrite_or_nest_in_source(self):
        for destination in (self.source, self.source / "nested", self.root):
            with self.subTest(destination=destination), self.assertRaisesRegex(ValueError, "fresh staging"):
                stage_bundle(self.source, destination, self.root / "dependencies")
        with self.assertRaisesRegex(ValueError, "outside the installed runtime"):
            stage_bundle(self.source, self.root / "install", self.root / "install/wheels")

    def test_other_notices_do_not_replace_installer_model_terms(self):
        path = self.source / "notices/NOTICE.txt"
        path.write_text("Another notice", encoding="utf-8")
        self.bundle["notices"] = ["notices/NOTICE.txt"]
        self.bundle["files"]["notices/NOTICE.txt"] = digest(path)
        del self.bundle["files"]["notices/MODEL-TERMS.txt"]
        self.save()
        with self.assertRaisesRegex(ValueError, "MODEL-TERMS.txt"):
            validate_bundle(self.source)

    def test_installer_smoke_rejects_modules_outside_bundled_python(self):
        script = (Path(__file__).resolve().parents[1] / "build-windows-installer.ps1").read_text(encoding="utf-8")
        smoke = script.split("$layaSmoke = @'\n", 1)[1].split("\n'@", 1)[0]
        self.assertIn("@('-E', '-s', '-c', $layaSmoke)", script)
        backend = self.root / "smoke-backend"
        backend.mkdir()
        (backend / "laya.py").write_text("name = 'host-side fixture'\n", encoding="utf-8")
        (backend / "torch.py").write_text("from types import SimpleNamespace\nversion = SimpleNamespace(cuda=None)\n", encoding="utf-8")
        package = backend / "athena_api/laya"
        package.mkdir(parents=True)
        (package / "contracts.py").write_text("Deployment = None\n", encoding="utf-8")
        (package / "runtime.py").write_text("SdkPredictor = None\n", encoding="utf-8")
        result = subprocess.run([sys.executable, "-E", "-s", "-c", smoke], cwd=backend,
                                env={**os.environ, "PYTHONHOME": str(self.root / "invalid-home"),
                                     "PYTHONPATH": str(backend)}, text=True, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Inference dependency is outside bundled Python", result.stderr)


if __name__ == "__main__":
    unittest.main()
