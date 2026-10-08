"""Discover the installed CPU bundle without changing explicit runtime settings."""

from __future__ import annotations

import json
import re
import secrets
import sys
from pathlib import Path, PureWindowsPath
from typing import TYPE_CHECKING

from athena_api.laya.contracts import bound_json

if TYPE_CHECKING:
    from athena_api.config import Settings


DEFAULT_BUNDLE_ROOT = Path(__file__).resolve().parents[2] / "laya-runtime"
_SHA256 = re.compile(r"[0-9a-f]{64}")
_CHECKPOINT_FILES = {"model.safetensors", "rl_agent_config.json", "encoder/config.json",
                     "tokenizer/tokenizer.json", "tokenizer/tokenizer_config.json"}


def _inside(root: Path, relative: str) -> Path:
    if (not isinstance(relative, str) or not relative
            or Path(relative).is_absolute() or PureWindowsPath(relative).drive):
        raise ValueError("bundle_path_invalid")
    path = (root / relative).resolve()
    if path == root or not path.is_relative_to(root):
        raise ValueError("bundle_path_outside_root")
    return path


def _deployment(root: Path) -> tuple[Path, str]:
    bundle_path = _inside(root, "bundle.json")
    bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
    if (not isinstance(bundle, dict) or type(bundle.get("schema_version")) is not int
            or bundle["schema_version"] != 1):
        raise ValueError("bundle_schema_invalid")
    digest = bundle.get("deployment_sha256")
    if not isinstance(digest, str) or not _SHA256.fullmatch(digest):
        raise ValueError("bundle_pin_invalid")
    path = _inside(root, "deployment.json")
    deployment = bound_json(path, digest)
    if deployment.get("schema_version") != 1 or not deployment.get("model_id"):
        raise ValueError("deployment_schema_invalid")
    checkpoint = _inside(root, deployment["checkpoint_path"])
    for name in ("catalog", "policy"):
        bound_json(_inside(root, deployment[name + "_path"]), deployment[name + "_sha256"])
    files = deployment["checkpoint_sha256"]
    if not isinstance(files, dict) or not _CHECKPOINT_FILES.issubset(files):
        raise ValueError("checkpoint_binding_incomplete")
    for name, expected in files.items():
        file = _inside(checkpoint, name)
        if (not file.is_relative_to(root) or not file.is_file()
                or not isinstance(expected, str) or not _SHA256.fullmatch(expected)):
            raise ValueError("checkpoint_binding_invalid")
    # The worker verifies checkpoint contents before loading. Do not read large
    # weights synchronously in the backend's startup path.
    return path, digest


def resolve_bundle(settings: Settings, *, bundle_root: Path | None = None) -> tuple[Settings, str]:
    """Return per-backend defaults and a fixed diagnostic, without persisting secrets."""
    explicit = settings.model_fields_set
    if explicit & {"laya_deployment_path", "laya_deployment_sha256"}:
        return settings, "manual"
    try:
        root = (bundle_root if bundle_root is not None else DEFAULT_BUNDLE_ROOT).resolve()
        if not root.exists():
            return settings, "bundle_missing"
        deployment, digest = _deployment(root)
    except (OSError, ValueError, KeyError, TypeError, RuntimeError):
        return settings, "bundle_invalid"

    from pydantic import SecretStr

    defaults = {
        "laya_deployment_path": deployment,
        "laya_deployment_sha256": digest,
        "laya_python_executable": Path(sys.executable),
        "laya_device": "cpu",
    }
    updates = {key: value for key, value in defaults.items() if key not in explicit}
    if "laya_runtime_token" not in explicit:
        updates["laya_runtime_token"] = SecretStr(secrets.token_urlsafe(32))
    device = updates.get("laya_device", settings.laya_device)
    if device == "cpu" and "laya_timeout_seconds" not in explicit:
        updates["laya_timeout_seconds"] = 30.0
    return settings.model_copy(update=updates), "bundled"
