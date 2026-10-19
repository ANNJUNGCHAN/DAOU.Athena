import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile


SCRIPT = Path(__file__).with_name("verify-package.py")
SPEC = importlib.util.spec_from_file_location("verify_package", SCRIPT)
VERIFY_PACKAGE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(VERIFY_PACKAGE)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class CurrentReleaseVerificationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "release").mkdir()

        self.pptx = self.root / "ATHENA-최종발표.pptx"
        with zipfile.ZipFile(self.pptx, "w") as archive:
            for index in range(1, 40):
                archive.writestr(f"ppt/slides/slide{index}.xml", "<slide />")

        self.pdf = self.root / "ATHENA-최종발표.pdf"
        self.script = self.root / "ATHENA-최종발표-대본.md"
        self.guide = self.root / "ATHENA-최종발표-시연가이드.md"
        self.pdf.write_bytes(b"pdf")
        self.script.write_text("script", encoding="utf-8")
        self.guide.write_text("guide", encoding="utf-8")
        self.write_manifest()

    def tearDown(self):
        self.temp.cleanup()

    def write_manifest(self, presentation_path="ATHENA-최종발표.pptx"):
        manifest = {
            "presentation": {
                "status": "canonical",
                "path": presentation_path,
                "sha256": sha256(self.pptx),
                "slides": 39,
                "pdf": {"path": self.pdf.name, "sha256": sha256(self.pdf)},
                "script": {"path": self.script.name, "sha256": sha256(self.script)},
                "guide": {"path": self.guide.name, "sha256": sha256(self.guide)},
            }
        }
        (self.root / "release" / "product-release.json").write_text(
            json.dumps(manifest), encoding="utf-8"
        )

    def test_current_release_manifest_accepts_matching_canonical_files(self):
        errors, checked = VERIFY_PACKAGE.verify_current_release(self.root)

        self.assertEqual(errors, [])
        self.assertEqual(checked, 4)

    def test_current_release_manifest_rejects_tampered_canonical_file(self):
        self.pptx.write_bytes(self.pptx.read_bytes() + b"tampered")

        errors, checked = VERIFY_PACKAGE.verify_current_release(self.root)

        self.assertEqual(checked, 4)
        self.assertTrue(any("SHA-256 differs" in error for error in errors), errors)

    def test_current_release_manifest_rejects_path_outside_repository(self):
        self.write_manifest("../outside.pptx")

        errors, checked = VERIFY_PACKAGE.verify_current_release(self.root)

        self.assertEqual(checked, 3)
        self.assertTrue(any("outside the package root" in error for error in errors), errors)


if __name__ == "__main__":
    unittest.main()
