"""Validate one product release across the app, Website and presentation checkouts.

The manifest is a release index written after artifacts exist. Receipts live
outside those artifacts, so no artifact has to contain its own future hash.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile


REPOSITORY = "ANNJUNGCHAN/DAOU.Athena"
MANIFEST_PATH = Path("scripts/release/product-release.json")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def valid_hash(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def artifact_path(root, value):
    require(isinstance(value, str) and bool(value), "artifact path is required")
    root = Path(root).resolve()
    result = (root / value).resolve()
    require(result != root and root in result.parents, "artifact path escapes repository")
    return result


def validate_manifest(manifest, *, require_canonical=True):
    require(manifest.get("schemaVersion") == 1, "unsupported product manifest schema")
    release = manifest["productRelease"]
    version = release["version"]
    require(re.fullmatch(r"\d+\.\d+\.\d+", version), "published version must be stable semver")
    require(release["tag"] == f"v{version}", "release version/tag mismatch")
    require(re.fullmatch(r"[0-9a-f]{40}", release["sourceCommit"]), "invalid release source commit")
    installer = manifest["windowsInstaller"]
    require(installer["file"] == f"Athena-Setup-{version}-x64.exe", "installer filename/version mismatch")
    expected = f"https://github.com/{REPOSITORY}/releases/download/{release['tag']}/{installer['file']}"
    require(installer["url"] == expected, "installer URL/version mismatch")
    require(valid_hash(installer["sha256"]) and valid_hash(installer["buildInfoSha256"]),
            "released installer/build-info hashes are required")
    capability = manifest["capabilities"]
    require(capability["orders"] == {"account": "mock", "confirmation": "per-ticket",
            "realAccount": False, "automatedTrading": False}, "order scope must remain mock and per-ticket")
    require(capability["graph"] == {"automaticSources": ["conversation", "trade", "holding"],
            "manualEdits": True, "allActivityCapture": False}, "graph source contract mismatch")
    laya = capability["laya"]
    require(laya["policy"] == "force-non-defer" and laya["thresholds"] == "zero"
            and laya["accuracyQualified"] is False, "LAYA policy contract mismatch")
    presentation = manifest["presentation"]
    require(presentation["status"] in ("candidate", "canonical"), "unknown presentation status")
    require(presentation["slides"] == 39, "approved presentation must have 39 slides")
    if require_canonical:
        require(presentation["status"] == "canonical", "presentation is not yet canonical")
        for name, artifact in [("pptx", presentation), *[(key, presentation[key])
                               for key in ("pdf", "script", "guide")]]:
            require(valid_hash(artifact["sha256"]), f"{name} hash is missing")
    return manifest


def git(root, *arguments):
    return subprocess.check_output(["git", "-C", str(root), *arguments], text=True).strip()


def check_remote_main(root):
    rows = git(root, "ls-remote", "origin", "refs/heads/main").splitlines()
    require(len(rows) == 1, f"{Path(root).name}: remote main identity is unavailable")
    remote_head = rows[0].split()[0]
    require(re.fullmatch(r"[0-9a-f]{40}", remote_head), "invalid remote main identity")
    try:
        git(root, "merge-base", "--is-ancestor", remote_head, "HEAD")
    except subprocess.CalledProcessError as error:
        raise ValueError(f"{Path(root).name}: current HEAD does not contain latest origin/main; fetch and integrate it first") from error
    return remote_head


def check_published(manifest, deployment_sha256):
    release = manifest["productRelease"]
    route = f"repos/{REPOSITORY}/releases/latest"
    metadata = json.loads(subprocess.check_output(["gh", "api", route]))
    require(metadata["tag_name"] == release["tag"], "product manifest is not the latest published stable release")
    require(not metadata["draft"] and not metadata["prerelease"], "release is not published stable")
    assets = {item["name"]: item for item in metadata["assets"]}
    for name, expected in ((manifest["windowsInstaller"]["file"], manifest["windowsInstaller"]["sha256"]),
                           ("build-info.json", manifest["windowsInstaller"]["buildInfoSha256"])):
        require(name in assets, f"published asset missing: {name}")
        require(assets[name].get("digest") == f"sha256:{expected}", f"published asset hash mismatch: {name}")
    data = subprocess.check_output(["gh", "api", f"repos/{REPOSITORY}/releases/assets/{assets['build-info.json']['id']}",
                                    "-H", "Accept: application/octet-stream"])
    require(hashlib.sha256(data).hexdigest() == manifest["windowsInstaller"]["buildInfoSha256"],
            "downloaded build-info hash mismatch")
    info = json.loads(data)
    require(info["version"] == release["version"] and info["commit"] == release["sourceCommit"],
            "released binary source/version differs from product manifest")
    runtime = info["runtimes"]["laya"]
    require(runtime["modelId"] == manifest["capabilities"]["laya"]["modelId"],
            "released binary LAYA model differs")
    require(runtime["deploymentSha256"] == deployment_sha256,
            "released binary LAYA deployment differs")
    return {"tag": release["tag"], "installer": "verified", "buildInfo": "verified", "laya": "verified"}


def check_workspace(root, web_root, presentation_root, *, online=False):
    root, web_root, presentation_root = map(Path, (root, web_root, presentation_root))
    raw = (root / MANIFEST_PATH).read_bytes()
    manifest = validate_manifest(json.loads(raw))
    for path in (web_root / "config/product-release.json", presentation_root / "release/product-release.json"):
        require(path.read_bytes() == raw, f"product manifest snapshot differs: {path}")
    release = manifest["productRelease"]
    require(git(root, "rev-parse", release["tag"] + "^{commit}") == release["sourceCommit"],
            "release tag source commit differs")
    current_head = git(root, "rev-parse", "HEAD")
    dirty = bool(git(root, "status", "--porcelain", "--untracked-files=normal"))
    # HEAD can be newer than the released binary; never relabel it as that binary.
    source_state = "release-source" if current_head == release["sourceCommit"] and not dirty else "unreleased-source"
    policy_path = root / "backend/laya-runtime/policy.json"
    deployment_path = root / "backend/laya-runtime/deployment.json"
    policy = json.loads(policy_path.read_text(encoding="utf-8"))
    deployment = json.loads(deployment_path.read_text(encoding="utf-8"))
    require(deployment["model_id"] == manifest["capabilities"]["laya"]["modelId"], "LAYA model identity differs")
    require(policy.get("force_non_defer") is True and policy["thresholds"]
            and all(value == 0 for value in policy["thresholds"].values()), "active LAYA policy differs")
    require(sha256(policy_path) == deployment["policy_sha256"], "active LAYA policy hash differs")
    presentation = manifest["presentation"]
    artifacts = {"pptx": presentation, **{key: presentation[key] for key in ("pdf", "script", "guide")}}
    for name, artifact in artifacts.items():
        path = artifact_path(presentation_root, artifact["path"])
        require(sha256(path) == artifact["sha256"], f"canonical {name} hash differs: {path}")
    with zipfile.ZipFile(artifact_path(presentation_root, presentation["path"])) as deck:
        require(deck.testzip() is None, "canonical PPTX CRC check failed")
        xml = ET.fromstring(deck.read("ppt/presentation.xml"))
        namespace = {"p": "http://schemas.openxmlformats.org/presentationml/2006/main"}
        require(len(xml.findall("p:sldIdLst/p:sldId", namespace)) == presentation["slides"],
                "canonical PPTX slide count differs")
    preview_root = web_root / "public/presentation/slides"
    preview = json.loads((preview_root / "manifest.json").read_text(encoding="utf-8"))
    require(preview["source"]["sha256"] == presentation["sha256"]
            and preview["source"]["slideCount"] == presentation["slides"],
            "Website preview is from a different presentation")
    slides = preview["slides"]
    require(len(slides) == presentation["slides"]
            and [slide["number"] for slide in slides] == list(range(1, presentation["slides"] + 1)),
            "Website preview slide order/count differs")
    require(preview["displayOrder"] == [slide["file"] for slide in slides]
            and len(set(preview["displayOrder"])) == len(slides), "Website preview display order differs")
    for slide in slides:
        path = artifact_path(preview_root, slide["file"])
        require(path.stat().st_size <= 25 * 1024 * 1024, f"Website preview asset exceeds 25 MiB: {path.name}")
        require(sha256(path) == slide["sha256"], f"Website preview asset hash differs: {path.name}")
    result = {"status": "PASS", "productRelease": release,
              "scope": "local-workspace-coherence",
              "productManifestSha256": hashlib.sha256(raw).hexdigest(),
              "appSource": {"head": current_head, "workingTreeDirty": dirty, "state": source_state},
              "repositories": {
                  name: {"head": git(path, "rev-parse", "HEAD"),
                         "workingTreeDirty": bool(git(path, "status", "--porcelain", "--untracked-files=normal"))}
                  for name, path in (("app", root), ("web", web_root), ("presentation", presentation_root))
              },
              "presentation": {"slides": presentation["slides"], "sha256": presentation["sha256"]},
              "websitePreview": {"slides": len(slides), "sourceSha256": preview["source"]["sha256"]}}
    if online:
        for name, path in (("app", root), ("web", web_root), ("presentation", presentation_root)):
            result["repositories"][name]["remoteMain"] = check_remote_main(path)
            result["repositories"][name]["containsRemoteMain"] = True
        result["publishedApp"] = check_published(manifest, sha256(deployment_path))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    root = Path(__file__).resolve().parents[2]
    parser.add_argument("--root", type=Path, default=root)
    parser.add_argument("--web-root", type=Path, default=root.parent / "DAOU.Athena-Web")
    parser.add_argument("--presentation-root", type=Path, default=root.parent / "DAOU.Athena-Presentation")
    parser.add_argument("--online", action="store_true", help="verify stable GitHub assets and original build-info")
    parser.add_argument("--receipt", type=Path)
    args = parser.parse_args()
    try:
        result = check_workspace(args.root, args.web_root, args.presentation_root, online=args.online)
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError, zipfile.BadZipFile) as error:
        print(f"PRODUCT_RELEASE_FAIL: {error}", file=sys.stderr)
        return 1
    encoded = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.receipt:
        args.receipt.parent.mkdir(parents=True, exist_ok=True)
        args.receipt.write_text(encoded, encoding="utf-8")
    print(encoded, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
