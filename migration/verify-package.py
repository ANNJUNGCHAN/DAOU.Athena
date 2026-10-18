"""Verify relocation identities separately from the current canonical release."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import zipfile


ROOT = Path(__file__).resolve().parents[1]
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
SLIDE_PATH_PATTERN = re.compile(r"^ppt/slides/slide([1-9][0-9]*)\.xml$")


def read(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def sha(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def package_file(root, relative_path, label, errors):
    if not isinstance(relative_path, str) or not relative_path:
        errors.append(f"{label} path is missing from release/product-release.json")
        return None
    candidate = Path(relative_path)
    if candidate.is_absolute():
        errors.append(f"{label} path is outside the package root: {relative_path}")
        return None
    resolved = (root / candidate).resolve()
    if not resolved.is_relative_to(root.resolve()):
        errors.append(f"{label} path is outside the package root: {relative_path}")
        return None
    if not resolved.is_file():
        errors.append(f"Missing current release file: {relative_path}")
        return None
    return resolved


def release_entry(presentation, key, label, errors):
    entry = presentation if key is None else presentation.get(key)
    if not isinstance(entry, dict):
        errors.append(f"{label} entry is missing from release/product-release.json")
        return None
    return entry


def verify_current_release(root):
    errors = []
    checked = 0
    manifest_path = root / "release/product-release.json"
    try:
        release = read(manifest_path)
    except (OSError, json.JSONDecodeError) as error:
        return [f"Cannot read release/product-release.json: {error}"], checked

    presentation = release.get("presentation")
    if not isinstance(presentation, dict):
        return ["presentation entry is missing from release/product-release.json"], checked
    if presentation.get("status") != "canonical":
        errors.append("presentation.status must be canonical")

    expected_slides = presentation.get("slides")
    if not isinstance(expected_slides, int) or isinstance(expected_slides, bool) or expected_slides < 1:
        errors.append("presentation.slides must be a positive integer")
        expected_slides = None

    presentation_path = None
    entries = (
        (None, "presentation"),
        ("pdf", "presentation.pdf"),
        ("script", "presentation.script"),
        ("guide", "presentation.guide"),
    )
    for key, label in entries:
        entry = release_entry(presentation, key, label, errors)
        if entry is None:
            continue
        relative_path = entry.get("path")
        expected_sha = entry.get("sha256")
        if not isinstance(expected_sha, str) or not SHA256_PATTERN.fullmatch(expected_sha):
            errors.append(f"{label}.sha256 must be a lowercase SHA-256 digest")
            continue
        file = package_file(root, relative_path, label, errors)
        if file is None:
            continue
        checked += 1
        if sha(file) != expected_sha:
            errors.append(f"Current release SHA-256 differs: {relative_path}")
        if key is None:
            presentation_path = file

    if presentation_path is not None and expected_slides is not None:
        try:
            with zipfile.ZipFile(presentation_path) as archive:
                slide_numbers = {
                    int(match.group(1))
                    for name in archive.namelist()
                    if (match := SLIDE_PATH_PATTERN.fullmatch(name))
                }
            actual_slides = len(slide_numbers)
            if slide_numbers != set(range(1, expected_slides + 1)):
                errors.append(
                    f"Canonical presentation slide contract differs: expected {expected_slides}, found {actual_slides}"
                )
        except zipfile.BadZipFile:
            errors.append(f"Canonical presentation is not a valid PPTX archive: {presentation_path.name}")

    return errors, checked


def verify_package(root, historical=False):
    manifest = read(root / "migration/manifest.json")
    errors = []
    checked = 0
    superseded = []
    superseded_current_paths = {
        "ATHENA-최종발표.pptx": "The stable root path now contains the approved 39-slide canonical release.",
        "migration/verify-package.py": "The verifier now separates the historical manifest from the current canonical release.",
    }
    for row in manifest["files"]:
        file = package_file(root, row["destination"], "migration file", errors)
        if file is None:
            continue
        if not historical and row["destination"] in superseded_current_paths:
            superseded.append({
                "path": row["destination"],
                "historicalSha256": row["destinationSha256"],
                "currentSha256": sha(file),
                "reason": superseded_current_paths[row["destination"]],
            })
            continue
        actual = sha(file)
        checked += 1
        if actual != row["destinationSha256"]:
            errors.append("Package file changed: " + row["destination"])
        if row["role"] in ("final-presentation", "final-film", "historical-verification") and actual != row["originalSha256"]:
            errors.append("Original identity differs: " + row["destination"])

    current_release_checked = 0
    if not historical:
        release_errors, current_release_checked = verify_current_release(root)
        errors.extend(release_errors)
        checked += current_release_checked

    review = read(root / "source/video/history/verification/independent-homepage-review.json")
    production = read(root / "source/video/history/render/final-manifest.json")
    for name in ("stage.js", "stage.css", "feature-detail.js"):
        digest = sha(root / "source/video" / name)
        if digest != review["reviewed_file_sha256"][name] or digest != production["sourceHashes"][name]:
            errors.append("Core visual source differs from production review: " + name)

    return {
        "status": "PASS" if not errors else "FAIL",
        "mode": "historical-strict" if historical else "current-release",
        "scope": (
            "All 2026-10-08 migration byte identities, immutable production receipts, and unchanged core visual source."
            if historical else
            "Unchanged 2026-10-08 migration files, immutable production receipts, unchanged core visual source, "
            "and canonical presentation artifacts declared by release/product-release.json."
        ),
        "manifestFiles": len(manifest["files"]),
        "filesChecked": checked,
        "currentReleaseFilesChecked": current_release_checked,
        "supersededHistoricalPaths": superseded,
        "errors": errors,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--historical",
        action="store_true",
        help="Require every byte identity from the 2026-10-08 migration manifest. Run this at the historical release commit.",
    )
    args = parser.parse_args()
    result = verify_package(ROOT, historical=args.historical)
    with (ROOT / "migration/package-identity-verification.json").open("w", encoding="utf-8", newline="\n") as stream:
        stream.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return bool(result["errors"])


if __name__ == "__main__":
    sys.exit(main())
