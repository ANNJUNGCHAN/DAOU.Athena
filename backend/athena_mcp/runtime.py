"""Resolve installed MCP runtimes without changing the user's Windows PATH."""

from __future__ import annotations

import os
import shutil
from pathlib import Path

from mcp import StdioServerParameters
from mcp.client.stdio import get_default_environment


def server_parameters(
    command: str,
    args: list[str],
    env: dict[str, str],
    *,
    runtime_root: Path | None = None,
    platform: str | None = None,
) -> StdioServerParameters:
    """Use app-owned executables for bare runtime commands; preserve custom paths.

    The probe and every provider gateway use this single upstream spawn boundary.
    Only the SDK's safe inherited environment and this server's resolved secrets
    reach the child. npm runs via node directly, avoiding Windows shell quoting.
    """
    if (platform or os.name) != "nt":
        return StdioServerParameters(command=command, args=args, env=env or None)

    root = runtime_root or Path(__file__).resolve().parents[2] / "mcp-runtime"
    child_env = {**get_default_environment(), **env}
    # Windows environment names are case-insensitive, including user-supplied Path.
    path_keys = [key for key in child_env if key.upper() == "PATH"]
    inherited_path = child_env[path_keys[-1]] if path_keys else ""
    for key in path_keys:
        del child_env[key]
    node = root / "node" / "node.exe"
    uv = root / "uv" / "uv.exe"
    directories = [str(exe.parent) for exe in (node, uv) if exe.is_file()]
    child_env["PATH"] = ";".join([*directories, inherited_path]) if directories else inherited_path

    name = command.lower()
    runtime = name.removesuffix(".exe").removesuffix(".cmd")
    bare_runtime = (
        runtime in {"node", "npm", "npx", "uv", "uvx"}
        and "/" not in command and "\\" not in command
    )
    if bare_runtime:
        if runtime in {"npm", "npx"}:
            cli = node.parent / "node_modules" / "npm" / "bin" / f"{runtime}-cli.js"
            if node.is_file() and cli.is_file():
                return StdioServerParameters(
                    command=str(node), args=[str(cli), *args], env=child_env,
                )
        else:
            executable = node if runtime == "node" else root / "uv" / f"{runtime}.exe"
            if executable.is_file():
                python = root.parent / "backend" / ".venv" / "Scripts" / "python.exe"
                if runtime in {"uv", "uvx"} and python.is_file():
                    child_env.setdefault("UV_PYTHON", str(python))
                return StdioServerParameters(command=str(executable), args=args, env=child_env)
        if shutil.which(command, path=child_env["PATH"]) is None:
            raise FileNotFoundError(
                f"MCP 실행에 필요한 {runtime} 런타임을 찾을 수 없습니다. "
                "아테나 최신 설치 파일로 복구 설치한 뒤 다시 연결해 주세요."
            )
    return StdioServerParameters(command=command, args=args, env=child_env)
