import tomllib
from pathlib import Path
from unittest.mock import patch

import athena_api
import athena_mcp
from athena_api.config import Settings
from athena_api.main import create_app
from athena_mcp.server import build_mcp_server


def test_public_api_and_mcp_advertise_the_release_manifest_version(monkeypatch):
    monkeypatch.delenv("ATHENA_APP_VERSION", raising=False)
    manifest = Path(__file__).resolve().parents[1] / "pyproject.toml"
    expected = tomllib.loads(manifest.read_text(encoding="utf-8"))["project"]["version"]
    assert athena_api.__version__ == athena_mcp.__version__ == expected
    settings = Settings(_env_file=None)
    app = create_app(settings)
    assert app.openapi()["info"]["version"] == expected
    # Constructing the server registers handlers but never calls the gateway.
    assert build_mcp_server(None).create_initialization_options().server_version == expected


def test_bundled_manifest_wins_over_unrelated_installed_metadata(tmp_path):
    package = tmp_path / "athena_api"
    package.mkdir()
    (tmp_path / "pyproject.toml").write_text(
        '[project]\nversion = "9.2.1-rc.1"\n', encoding="utf-8"
    )
    with patch.object(athena_api, "__file__", str(package / "__init__.py")), patch.object(
        athena_api, "version", side_effect=AssertionError("must read bundled manifest")
    ):
        assert athena_api._project_version() == "9.2.1-rc.1"


def test_wheel_without_manifest_uses_installed_distribution_metadata(tmp_path):
    with (
        patch.object(athena_api, "__file__", str(tmp_path / "athena_api" / "__init__.py")),
        patch.object(athena_api, "version", return_value="9.3.0") as metadata_version,
    ):
        assert athena_api._project_version() == "9.3.0"
        metadata_version.assert_called_once_with("daou-athena-backend")
