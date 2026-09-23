"""From backend: python -m verification.verify_mcp_bundled_runtime RUNTIME_ROOT [--python EXE].

RUNTIME_ROOT contains node/ and uv/ from stage-windows-mcp-runtimes.ps1. Uses fresh caches
and System32-only PATH; uvx downloads mcp and its dependencies for a local fixture.
No credentials, registered servers, or user settings are used.
--python selects an installed standalone Python for uvx; defaults to this interpreter.
"""

import argparse
import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path

from mcp import ClientSession
from mcp.client.stdio import stdio_client

from athena_mcp.runtime import server_parameters

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("runtime_root", type=Path)
parser.add_argument("--python", type=Path, default=Path(sys.executable))
options = parser.parse_args()
runtime_root = options.runtime_root.resolve()
temporary = tempfile.TemporaryDirectory(prefix="athena runtime smoke ")
root = Path(temporary.name)
package = root / "fixture package"
package.mkdir(exist_ok=True)
(package / "package.json").write_text(
    json.dumps(
        {
            "name": "athena-runtime-fixture",
            "version": "1.0.0",
            "bin": {"athena-runtime-fixture": "server.js"},
        }
    )
)
(package / "server.js").write_text(
    """#!/usr/bin/env node
const readline = require('node:readline');
readline.createInterface({input:process.stdin}).on('line', line => {
const req=JSON.parse(line); if(req.id===undefined)return;
let result={};
if(req.method==='initialize')result={protocolVersion:req.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};
if(req.method==='tools/list')result={tools:[{name:'echo',inputSchema:{type:'object'}}]};
if(req.method==='tools/call')result={content:[{type:'text',text:'runtime-ok'}]};
console.log(JSON.stringify({jsonrpc:'2.0',id:req.id,result}));
});
""",
    encoding="utf-8",
)
pyfixture = root / "fixture.py"
pyfixture.write_text("""from mcp.server.fastmcp import FastMCP
mcp = FastMCP('fixture')
@mcp.tool()
def echo() -> str:
    return 'runtime-ok'
mcp.run()
""")
os.environ["PATH"] = str(Path(os.environ["SYSTEMROOT"]) / "System32")


async def main():
    cases = [
        (
            "npx",
            ["--offline", "--yes", "--package", str(package), "athena-runtime-fixture"],
            {"npm_config_cache": str(root / "npm-cache")},
        ),
        (
            "uvx",
            ["--from", "mcp==1.28.1", "python", str(pyfixture)],
            {"UV_PYTHON": str(options.python.resolve()), "UV_CACHE_DIR": str(root / "uv-cache")},
        ),
    ]
    for command, args, env in cases:
        params = server_parameters(command, args, env, runtime_root=runtime_root)
        async with asyncio.timeout(180):
            async with stdio_client(params) as (read, write), ClientSession(read, write) as session:
                await session.initialize()
                tools = await session.list_tools()
                assert [tool.name for tool in tools.tools] == ["echo"]
                result = await session.call_tool("echo", {})
                assert result.content[0].text == "runtime-ok"
                print(
                    command + ": initialize/list_tools/call_tool PASS (System32-only PATH)",
                    flush=True,
                )


try:
    asyncio.run(main())
finally:
    temporary.cleanup()
