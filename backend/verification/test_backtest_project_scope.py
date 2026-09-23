from types import SimpleNamespace
from unittest.mock import patch

import pytest

from athena_api.api import backtest
from athena_api.api.projects import TECHNIQUE_SEED_SOURCE
from athena_api.projects.store import ProjectStore


@pytest.mark.asyncio
async def test_registration_and_listing_use_the_app_project_registry(tmp_path):
    registry_root = tmp_path / "app-projects"
    folder = tmp_path / "technique"
    folder.mkdir()
    (folder / "strategy.py").write_text(TECHNIQUE_SEED_SOURCE, encoding="utf-8")
    project = ProjectStore(registry_root).open_external(str(folder))
    state = SimpleNamespace(
        settings=SimpleNamespace(
            projects_root=registry_root, backtest_db_path=tmp_path / "backtest.sqlite3"
        ),
        backtest_store=object(),
    )
    request = SimpleNamespace(app=SimpleNamespace(state=state))
    with patch(
        "athena_api.config.get_settings",
        side_effect=AssertionError("global settings must not be read"),
    ):
        result = await backtest.register_user_strategy_route(
            request, {"project_id": project.id, "path": "strategy.py", "name": "QA technique"}
        )
        assert result["project_id"] == project.id
        listed = await backtest.list_user_strategies_route(request)
        assert listed["strategies"][0]["exists"] is True
        assert backtest._project_root("missing", request) is None
