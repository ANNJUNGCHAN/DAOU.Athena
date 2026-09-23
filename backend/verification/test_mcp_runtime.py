from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from athena_mcp.runtime import server_parameters


class McpRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="athena runtime ")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "mcp-runtime"
        self.safe = patch("athena_mcp.runtime.get_default_environment", return_value={"PATH": ""})
        self.safe.start()
        self.addCleanup(self.safe.stop)

    def file(self, relative):
        target = self.root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.touch()
        return target

    def params(self, command, args=None, env=None):
        return server_parameters(
            command, args or [], env or {}, runtime_root=self.root, platform="nt",
        )

    def test_npx_without_system_path_uses_node_and_preserves_arguments_and_secrets(self):
        node = self.file("node/node.exe")
        cli = self.file("node/node_modules/npm/bin/npx-cli.js")
        args = ["--yes", "@example/server", "argument with spaces", "&literal"]
        params = self.params("npx", args, {"API_KEY": "fixture-only"})
        self.assertEqual(params.command, str(node))
        self.assertEqual(params.args, [str(cli), *args])
        self.assertEqual(params.env["API_KEY"], "fixture-only")
        self.assertEqual(params.env["PATH"].split(";")[0], str(node.parent))
        self.assertEqual(args[0], "--yes")

    def test_windows_command_suffixes_resolve_without_shell(self):
        node = self.file("node/node.exe")
        for name in ("npx", "npm"):
            self.file(f"node/node_modules/npm/bin/{name}-cli.js")
            self.assertEqual(self.params(f"{name}.CMD").command, str(node))
        self.assertEqual(self.params("node.exe").command, str(node))

    def test_uvx_uses_bundled_python_and_honors_server_override(self):
        uvx = self.file("uv/uvx.exe")
        self.file("uv/uv.exe")
        python = self.file("../backend/.venv/Scripts/python.exe")
        params = self.params("uvx")
        self.assertEqual(params.command, str(uvx))
        self.assertEqual(Path(params.env["UV_PYTHON"]).resolve(), python.resolve())
        self.assertEqual(self.params("uvx", env={"UV_PYTHON": "custom"}).env["UV_PYTHON"], "custom")

    def test_custom_executable_is_preserved_and_path_case_is_normalized(self):
        node = self.file("node/node.exe")
        command = r"C:\custom node\node.exe"
        params = self.params(command, ["server.js"], {"Path": r"C:\custom"})
        self.assertEqual(params.command, command)
        self.assertEqual(params.args, ["server.js"])
        self.assertNotIn("Path", params.env)
        self.assertEqual(params.env["PATH"], f"{node.parent};C:\\custom")

    def test_development_install_falls_back_to_available_runtime(self):
        with patch("athena_mcp.runtime.shutil.which", return_value=r"C:\node\npx.cmd"):
            self.assertEqual(self.params("npx").command, "npx")

    def test_missing_runtime_has_repair_message(self):
        with patch("athena_mcp.runtime.shutil.which", return_value=None):
            with self.assertRaisesRegex(FileNotFoundError, "npx.*런타임"):
                self.params("npx")

    def test_non_windows_behavior_is_unchanged(self):
        params = server_parameters("npx", ["server"], {}, runtime_root=self.root, platform="posix")
        self.assertEqual(params.command, "npx")
        self.assertIsNone(params.env)


if __name__ == "__main__":
    unittest.main()
