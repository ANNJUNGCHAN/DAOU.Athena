"""Validate and stage an explicitly supplied, offline Windows CPU LAYA package.

bundle.json schema 1 binds deployment.json, catalog.json, policy.json, checkpoint
files and notices in its `files` SHA256 map. `dependencies` lists exact wheel
name/version/wheel/sha256 records. Wheels are build inputs, not installed assets.
This tool never discovers a model, downloads packages, or changes its source.
"""
from __future__ import annotations

import argparse
from email.parser import BytesParser
import hashlib
import json
from pathlib import Path
import re
import shutil
import stat
import zipfile


DIGEST = re.compile(r"[0-9a-f]{64}\Z")
NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*\Z")
VERSION = re.compile(r"[0-9][A-Za-z0-9.!+_-]*\Z")
CHECKPOINT_REQUIRED = {
    "model.safetensors", "rl_agent_config.json", "encoder/config.json",
    "tokenizer/tokenizer.json", "tokenizer/tokenizer_config.json",
}


def fail(message):
    raise ValueError(message)


def relative_name(name):
    if (not isinstance(name, str) or not name or "\\" in name or ":" in name
            or any(part in ("", ".", "..") for part in name.split("/"))
            or any(ord(char) < 32 for char in name)):
        fail("unsafe relative bundle path")
    return name


def check_digest(value):
    if not isinstance(value, str) or not DIGEST.fullmatch(value):
        fail("invalid SHA256")
    return value


def safe_file(root, name):
    path = root
    for part in ("", *relative_name(name).split("/")):
        path = path / part
        if path.is_symlink() or getattr(path.lstat(), "st_file_attributes", 0) & 0x400:
            fail("symlinks and reparse points are not bundle files")
    if not stat.S_ISREG(path.stat().st_mode) or not path.resolve().is_relative_to(root.resolve()):
        fail("bundle file is not a contained regular file")
    return path


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        first = stream.read(1024 * 1024)
        if first.startswith(b"version https://git-lfs.github.com/spec/v1"):
            fail("Git LFS pointer found; obtain the actual bundle payload")
        digest.update(first)
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            fail("duplicate JSON key")
        value[key] = item
    return value


def read_json(path):
    value = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique_object)
    if not isinstance(value, dict):
        fail("bundle JSON must be an object")
    return value


def normalize_name(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def validate_bundle(source, *, require_wheels=True):
    root = Path(source).absolute()
    bundle = read_json(safe_file(root, "bundle.json"))
    if type(bundle.get("schema_version")) is not int or bundle["schema_version"] != 1:
        fail("unsupported bundle schema")
    files = bundle.get("files")
    if not isinstance(files, dict) or not {"deployment.json", "catalog.json", "policy.json"} <= files.keys():
        fail("missing runtime file bindings")
    if len({name.casefold() for name in files}) != len(files):
        fail("case-insensitive duplicate bundle path")
    notices = bundle.get("notices")
    if (not isinstance(notices, list) or not notices
            or any(not isinstance(name, str) or not name.startswith("notices/") or name not in files
                   for name in notices) or len(set(notices)) != len(notices)):
        fail("include the selected model and package notices")
    if "notices/MODEL-TERMS.txt" not in notices:
        fail("include hash-bound notices/MODEL-TERMS.txt for installer acceptance")
    for name, expected in files.items():
        relative_name(name)
        allowed = (name in ("deployment.json", "catalog.json", "policy.json") or name in notices
                   or name.startswith("checkpoint/") and Path(name).suffix in (".json", ".safetensors", ".txt", ".model"))
        if not allowed:
            fail("runtime manifest contains a non-inference file")
        if sha256(safe_file(root, name)) != check_digest(expected):
            fail("bundle file SHA256 mismatch: " + name)
    if check_digest(bundle.get("deployment_sha256")) != files["deployment.json"]:
        fail("deployment pin does not match bundle file binding")
    deployment = read_json(safe_file(root, "deployment.json"))
    if deployment.get("schema_version") != 1 or not deployment.get("model_id"):
        fail("invalid deployment")
    for key, expected in (("checkpoint_path", "checkpoint"), ("catalog_path", "catalog.json"), ("policy_path", "policy.json")):
        if deployment.get(key) != expected:
            fail("deployment must use the portable bundle layout")
    for name in ("catalog", "policy"):
        if deployment.get(name + "_sha256") != files[name + ".json"]:
            fail("deployment artifact binding differs from bundle")
    checkpoint = deployment.get("checkpoint_sha256")
    if not isinstance(checkpoint, dict) or not CHECKPOINT_REQUIRED <= checkpoint.keys():
        fail("incomplete checkpoint binding")
    if {"checkpoint/" + relative_name(name): digest for name, digest in checkpoint.items()} != {
            name: digest for name, digest in files.items() if name.startswith("checkpoint/")}:
        fail("checkpoint binding differs from bundle")
    dependencies = bundle.get("dependencies")
    if not isinstance(dependencies, list) or not dependencies:
        fail("missing pinned dependency wheels")
    names, wheel_names = set(), set()
    for item in dependencies:
        if (not isinstance(item, dict) or not isinstance(item.get("name"), str)
                or not NAME.fullmatch(item["name"]) or not isinstance(item.get("version"), str)
                or not VERSION.fullmatch(item["version"])):
            fail("invalid dependency pin")
        name = normalize_name(item["name"])
        wheel = relative_name(item.get("wheel"))
        if (name in names or wheel.casefold() in wheel_names or not wheel.startswith("wheels/")
                or len(wheel.split("/")) != 2 or not wheel.endswith(".whl")):
            fail("invalid or duplicate dependency wheel")
        names.add(name)
        wheel_names.add(wheel.casefold())
        check_digest(item.get("sha256"))
        if name == "torch" and not item["version"].endswith("+cpu"):
            fail("default installer requires a CPU Torch wheel")
        if require_wheels:
            path = safe_file(root, wheel)
            if sha256(path) != item["sha256"]:
                fail("dependency wheel SHA256 mismatch")
            with zipfile.ZipFile(path) as archive:
                metadata_paths = [entry for entry in archive.namelist()
                                  if entry.endswith(".dist-info/METADATA") and len(entry.split("/")) == 2]
                if len(metadata_paths) != 1 or archive.getinfo(metadata_paths[0]).file_size > 2 * 1024 * 1024:
                    fail("invalid wheel metadata")
                metadata = BytesParser().parsebytes(archive.read(metadata_paths[0]))
                if normalize_name(metadata.get("Name", "")) != name or metadata.get("Version") != item["version"]:
                    fail("wheel metadata differs from dependency pin")
    if not {"laya", "torch"} <= names:
        fail("LAYA SDK and CPU Torch wheels are required")
    return bundle


def stage_bundle(source, destination, dependency_directory):
    source, destination, dependency_directory = map(lambda path: Path(path).absolute(),
                                                   (source, destination, dependency_directory))
    for path in (destination, dependency_directory):
        if path.exists() or path.is_relative_to(source) or source.is_relative_to(path):
            fail("use fresh staging directories outside the source package")
    if destination.is_relative_to(dependency_directory) or dependency_directory.is_relative_to(destination):
        fail("dependency archives must be outside the installed runtime")
    bundle = validate_bundle(source)
    destination.mkdir(parents=True)
    dependency_directory.mkdir(parents=True)
    for name, digest in bundle["files"].items():
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(safe_file(source, name), target)
        if sha256(target) != digest:
            fail("source changed during staging")
    for item in bundle["dependencies"]:
        target = dependency_directory / item["wheel"]
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(safe_file(source, item["wheel"]), target)
        if sha256(target) != item["sha256"]:
            fail("dependency changed during staging")
    (destination / "bundle.json").write_text(json.dumps(bundle, indent=2) + "\n", encoding="utf-8")
    requirements = "".join(f"{item['name']}=={item['version']} --hash=sha256:{item['sha256']}\n"
                           for item in bundle["dependencies"])
    (dependency_directory / "requirements.txt").write_text(requirements, encoding="utf-8")
    return bundle


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--destination", type=Path)
    parser.add_argument("--dependency-directory", type=Path)
    args = parser.parse_args()
    if bool(args.destination) != bool(args.dependency_directory):
        parser.error("provide both --destination and --dependency-directory, or neither to verify")
    try:
        bundle = (stage_bundle(args.source, args.destination, args.dependency_directory)
                  if args.destination else validate_bundle(args.source))
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        parser.exit(1, str(error) + "\n")
    print(json.dumps({"schema_version": 1, "deployment_sha256": bundle["deployment_sha256"],
                      "runtime_files": len(bundle["files"]), "dependency_wheels": len(bundle["dependencies"])}))


if __name__ == "__main__":
    main()
