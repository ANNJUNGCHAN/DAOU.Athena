"""DAOU Athena read-only Kiwoom API."""

import tomllib
from importlib.metadata import version
from pathlib import Path


def _project_version() -> str:
    # Source checkouts and the Windows bundle both include this canonical manifest.
    manifest = Path(__file__).resolve().parent.parent / "pyproject.toml"
    if manifest.is_file():
        with manifest.open("rb") as stream:
            return tomllib.load(stream)["project"]["version"]
    return version("daou-athena-backend")


__version__ = _project_version()
