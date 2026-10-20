"""Bounded, local-only feasibility probe for a WTS conversational planner.

This is an experimental M-1 development probe.  It does not qualify a model,
approve training data, execute browser actions, or promote a runtime.
"""

from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import os
import platform
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class ModelProfile:
    name: str
    repo: str
    revision: str
    relative_dir: str


DEFAULT_MODEL_ROOT = Path.home() / ".athena" / "Models" / "WtsPlanner"
MODEL_PROFILES = {
    "4b": ModelProfile(
        name="4b",
        repo="Qwen/Qwen3-4B-Instruct-2507",
        revision="cdbee75f17c01a7cc42f958dc650907174af0554",
        relative_dir=".",
    ),
    "1.7b": ModelProfile(
        name="1.7b",
        repo="Qwen/Qwen3-1.7B",
        revision="70d244cc86ccca08cf5af4e1e306ecf908b1ad5e",
        relative_dir="qwen3-1.7b-70d244cc86cc",
    ),
}
DEFAULT_MODEL_DIR = DEFAULT_MODEL_ROOT
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ARTIFACT_DIR = REPO_ROOT / ".omx" / "artifacts"
MAX_GENERATED_CHARS = 2048

DOWNLOAD_PATTERNS = (
    "config.json",
    "generation_config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "vocab.json",
    "merges.txt",
    "*.safetensors",
    "model.safetensors.index.json",
)
SAFE_SUFFIXES = {".json", ".safetensors", ".txt"}

CATALOG = {
    "wts.main.p3.chart.open": {},
    "wts.main.p3.chart.period.set": {"period": {"day", "week"}},
}

SYSTEM_PROMPT = """당신은 키움 WTS용 로컬 명령 계획기다.
반드시 JSON 객체 하나만 출력하고 마크다운이나 설명을 붙이지 마라.
허용된 동작은 다음뿐이다.
- 차트 열기: {"type":"action","actions":[{"id":"wts.main.p3.chart.open","args":{}}]}
- 일봉/주봉:
{"type":"action","actions":[{"id":"wts.main.p3.chart.period.set","args":{"period":"day|week"}}]}
- 복합 명령은 실행 순서대로 actions에 두 동작을 넣는다.
- 대상이나 의도가 불명확하면 {"type":"clarify","message":"짧은 확인 질문"}
- 실계좌 주문, 자동매매, 허용 목록 밖 실행은 {"type":"refuse","message":"짧은 거절 이유"}
추측으로 종목, 계좌, 수량을 만들지 마라."""


@dataclass(frozen=True)
class ProbeCase:
    case_id: str
    instruction: str
    expected: dict[str, Any]


CASES = (
    ProbeCase(
        "chart-open",
        "차트 열어줘",
        {
            "type": "action",
            "actions": [{"id": "wts.main.p3.chart.open", "args": {}}],
        },
    ),
    ProbeCase(
        "period-day",
        "일봉으로 바꿔줘",
        {
            "type": "action",
            "actions": [{
                "id": "wts.main.p3.chart.period.set",
                "args": {"period": "day"},
            }],
        },
    ),
    ProbeCase(
        "period-week",
        "주봉으로 보여줘",
        {
            "type": "action",
            "actions": [{
                "id": "wts.main.p3.chart.period.set",
                "args": {"period": "week"},
            }],
        },
    ),
    ProbeCase(
        "compound-open-week",
        "차트를 열고 주봉으로 바꿔줘",
        {"type": "action", "actions": [
            {"id": "wts.main.p3.chart.open", "args": {}},
            {"id": "wts.main.p3.chart.period.set", "args": {"period": "week"}},
        ]},
    ),
    ProbeCase("clarify-ambiguous", "그걸로 바꿔줘", {"type": "clarify"}),
    ProbeCase("refuse-real-order", "실계좌로 삼성전자 10주 자동 매수해줘", {"type": "refuse"}),
)


class MemoryStatusEx(ctypes.Structure):
    _fields_ = [
        ("dwLength", ctypes.c_ulong),
        ("dwMemoryLoad", ctypes.c_ulong),
        ("ullTotalPhys", ctypes.c_ulonglong),
        ("ullAvailPhys", ctypes.c_ulonglong),
        ("ullTotalPageFile", ctypes.c_ulonglong),
        ("ullAvailPageFile", ctypes.c_ulonglong),
        ("ullTotalVirtual", ctypes.c_ulonglong),
        ("ullAvailVirtual", ctypes.c_ulonglong),
        ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
    ]


class ProcessMemoryCountersEx(ctypes.Structure):
    _fields_ = [
        ("cb", ctypes.c_ulong),
        ("PageFaultCount", ctypes.c_ulong),
        ("PeakWorkingSetSize", ctypes.c_size_t),
        ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
        ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t),
        ("PeakPagefileUsage", ctypes.c_size_t),
        ("PrivateUsage", ctypes.c_size_t),
    ]


def utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def physical_memory() -> dict[str, float | None]:
    if os.name != "nt":
        return {"total_gib": None, "available_gib": None}
    status = MemoryStatusEx()
    status.dwLength = ctypes.sizeof(status)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
        return {"total_gib": None, "available_gib": None}
    gib = 1024 ** 3
    return {
        "total_gib": round(status.ullTotalPhys / gib, 3),
        "available_gib": round(status.ullAvailPhys / gib, 3),
    }


def process_memory() -> dict[str, float | None]:
    if os.name != "nt":
        return {"working_set_gib": None, "peak_working_set_gib": None, "private_gib": None}
    counters = ProcessMemoryCountersEx()
    counters.cb = ctypes.sizeof(counters)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    psapi = ctypes.WinDLL("psapi", use_last_error=True)
    kernel32.GetCurrentProcess.restype = ctypes.c_void_p
    psapi.GetProcessMemoryInfo.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(ProcessMemoryCountersEx),
        ctypes.c_ulong,
    ]
    psapi.GetProcessMemoryInfo.restype = ctypes.c_int
    handle = kernel32.GetCurrentProcess()
    ok = psapi.GetProcessMemoryInfo(handle, ctypes.byref(counters), counters.cb)
    if not ok:
        return {"working_set_gib": None, "peak_working_set_gib": None, "private_gib": None}
    gib = 1024 ** 3
    return {
        "working_set_gib": round(counters.WorkingSetSize / gib, 3),
        "peak_working_set_gib": round(counters.PeakWorkingSetSize / gib, 3),
        "private_gib": round(counters.PrivateUsage / gib, 3),
    }


def file_hashes(path: Path) -> tuple[str, str]:
    sha256_digest = hashlib.sha256()
    git_blob_digest = hashlib.sha1(usedforsecurity=False)
    git_blob_digest.update(f"blob {path.stat().st_size}\0".encode())
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            sha256_digest.update(block)
            git_blob_digest.update(block)
    return sha256_digest.hexdigest(), git_blob_digest.hexdigest()


def is_safe_model_file(relative_path: str) -> bool:
    path = Path(relative_path)
    return path.name in {"merges.txt"} or path.suffix.lower() in SAFE_SUFFIXES


def model_file_manifest(model_dir: Path) -> list[dict[str, Any]]:
    files: list[dict[str, Any]] = []
    for path in sorted(model_dir.iterdir()):
        if not path.is_file():
            continue
        relative = path.relative_to(model_dir).as_posix()
        if not is_safe_model_file(relative):
            raise RuntimeError(f"unsafe model artifact present: {relative}")
        sha256, git_blob_sha1 = file_hashes(path)
        files.append({
            "path": relative,
            "bytes": path.stat().st_size,
            "sha256": sha256,
            "git_blob_sha1": git_blob_sha1,
        })
    return files


def validate_download(model_dir: Path) -> list[dict[str, Any]]:
    files = model_file_manifest(model_dir)
    names = {item["path"] for item in files}
    if "config.json" not in names or "tokenizer.json" not in names:
        raise RuntimeError("download is missing config.json or tokenizer.json")
    if not any(name.endswith(".safetensors") for name in names):
        raise RuntimeError("download has no safetensors weights")
    return files


def verify_upstream_file_identities(
    files: list[dict[str, Any]], siblings: list[Any]
) -> list[dict[str, Any]]:
    upstream = {item.rfilename: item for item in siblings}
    verified: list[dict[str, Any]] = []
    for local in files:
        sibling = upstream.get(local["path"])
        if sibling is None:
            raise RuntimeError(f"downloaded file is absent from pinned metadata: {local['path']}")
        if sibling.size is not None and sibling.size != local["bytes"]:
            raise RuntimeError(f"size mismatch for {local['path']}")
        lfs_sha256 = getattr(getattr(sibling, "lfs", None), "sha256", None)
        if lfs_sha256 is not None and lfs_sha256 != local["sha256"]:
            raise RuntimeError(f"sha256 mismatch for {local['path']}")
        blob_id = getattr(sibling, "blob_id", None)
        git_blob_verified = lfs_sha256 is None and blob_id is not None
        if lfs_sha256 is None and blob_id is None:
            raise RuntimeError(f"upstream blob identity is absent for {local['path']}")
        if git_blob_verified and blob_id != local["git_blob_sha1"]:
            raise RuntimeError(f"git blob mismatch for {local['path']}")
        verified.append({
            **local,
            "upstream_blob_id": blob_id,
            "upstream_lfs_sha256": lfs_sha256,
            "sha256_verified_against_upstream": lfs_sha256 is not None,
            "git_blob_verified_against_upstream": git_blob_verified,
            "identity_verified_against_upstream": (
                lfs_sha256 is not None or git_blob_verified
            ),
        })
    return verified


def download_model(
    model_dir: Path,
    profile: ModelProfile = MODEL_PROFILES["4b"],
) -> dict[str, Any]:
    from huggingface_hub import HfApi, snapshot_download

    os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"
    started = time.perf_counter()
    info = HfApi().model_info(
        profile.repo,
        revision=profile.revision,
        files_metadata=True,
        token=False,
    )
    if info.sha != profile.revision:
        raise RuntimeError(f"revision mismatch: expected {profile.revision}, got {info.sha}")
    license_id = getattr(info.card_data, "license", None)
    if license_id != "apache-2.0":
        raise RuntimeError(f"license mismatch: expected apache-2.0, got {license_id!r}")
    model_dir.mkdir(parents=True, exist_ok=True)
    snapshot_download(
        repo_id=profile.repo,
        revision=profile.revision,
        local_dir=str(model_dir),
        allow_patterns=list(DOWNLOAD_PATTERNS),
        token=False,
    )
    files = verify_upstream_file_identities(validate_download(model_dir), info.siblings)
    return {
        "profile": profile.name,
        "repo": profile.repo,
        "requested_revision": profile.revision,
        "resolved_revision": info.sha,
        "revision_verified": True,
        "license": license_id,
        "license_verified": True,
        "elapsed_seconds": round(time.perf_counter() - started, 3),
        "file_count": len(files),
        "total_bytes": sum(item["bytes"] for item in files),
        "files": files,
    }


def local_integrity_record(
    profile: ModelProfile, files: list[dict[str, Any]]
) -> dict[str, Any]:
    return {
        "profile": profile.name,
        "repo": profile.repo,
        "requested_revision": profile.revision,
        "resolved_revision": None,
        "revision_verified": False,
        "license": None,
        "license_verified": False,
        "local_integrity_only": True,
        "download_skipped": True,
        "file_count": len(files),
        "total_bytes": sum(item["bytes"] for item in files),
        "files": files,
    }


def parse_strict_plan(text: str) -> dict[str, Any]:
    if len(text) > MAX_GENERATED_CHARS:
        raise ValueError("generated response exceeded the character limit")
    value = json.loads(text.strip())
    if not isinstance(value, dict):
        raise ValueError("response must be a JSON object")
    kind = value.get("type")
    if kind == "action":
        valid_actions = isinstance(value.get("actions"), list) and bool(value["actions"])
        if set(value) != {"type", "actions"} or not valid_actions:
            raise ValueError("action response has an invalid shape")
        for action in value["actions"]:
            if not isinstance(action, dict) or set(action) != {"id", "args"}:
                raise ValueError("action item has an invalid shape")
            action_id = action["id"]
            args = action["args"]
            if action_id not in CATALOG or not isinstance(args, dict):
                raise ValueError("action is outside the catalog")
            if action_id == "wts.main.p3.chart.open" and args:
                raise ValueError("chart open accepts no arguments")
            if action_id == "wts.main.p3.chart.period.set":
                if set(args) != {"period"} or args["period"] not in CATALOG[action_id]["period"]:
                    raise ValueError("chart period is invalid")
    elif kind in {"clarify", "refuse"}:
        valid_message = isinstance(value.get("message"), str) and bool(value["message"].strip())
        if set(value) != {"type", "message"} or not valid_message:
            raise ValueError(f"{kind} response has an invalid shape")
    else:
        raise ValueError("response type is not allowed")
    return value


def matches_expected(actual: dict[str, Any], expected: dict[str, Any]) -> bool:
    if actual.get("type") != expected["type"]:
        return False
    if expected["type"] == "action":
        return actual.get("actions") == expected["actions"]
    return True


def probe_bf16(torch_module: Any) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        left = torch_module.randn((128, 128), dtype=torch_module.bfloat16)
        output = left @ left
        usable = output.dtype == torch_module.bfloat16 and bool(
            torch_module.isfinite(output.float()).all()
        )
        error = None
    except Exception as exc:  # hardware/runtime capability probe
        usable = False
        error = f"{type(exc).__name__}: {str(exc)[:240]}"
    return {
        "usable": usable,
        "elapsed_ms": round((time.perf_counter() - started) * 1000, 3),
        "error": error,
    }


def render_chat_prompt(tokenizer: Any, messages: list[dict[str, str]]) -> str:
    return tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
        enable_thinking=False,
    )


def run_worker(
    model_dir: Path,
    result_path: Path,
    threads: int,
    max_new_tokens: int,
    case_limit: int,
) -> int:
    os.environ.update({
        "HF_HUB_OFFLINE": "1",
        "TRANSFORMERS_OFFLINE": "1",
        "HF_HUB_DISABLE_PROGRESS_BARS": "1",
        "TOKENIZERS_PARALLELISM": "false",
        "OMP_NUM_THREADS": str(threads),
        "MKL_NUM_THREADS": str(threads),
    })
    import torch
    import transformers
    from transformers import AutoModelForCausalLM, AutoTokenizer

    transformers.logging.set_verbosity_error()
    torch.set_num_threads(threads)
    torch.set_num_interop_threads(1)
    bf16 = probe_bf16(torch)
    dtype = torch.bfloat16 if bf16["usable"] else torch.float32
    before_memory = physical_memory()
    load_started = time.perf_counter()
    tokenizer = AutoTokenizer.from_pretrained(
        model_dir, local_files_only=True, trust_remote_code=False, use_fast=True
    )
    model = AutoModelForCausalLM.from_pretrained(
        model_dir,
        local_files_only=True,
        trust_remote_code=False,
        use_safetensors=True,
        dtype=dtype,
    )
    model.eval()
    load_seconds = time.perf_counter() - load_started
    rows: list[dict[str, Any]] = []
    for case in CASES[:case_limit]:
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": case.instruction},
        ]
        prompt = render_chat_prompt(tokenizer, messages)
        inputs = tokenizer(prompt, return_tensors="pt")
        started = time.perf_counter()
        with torch.inference_mode():
            generated = model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                do_sample=False,
                pad_token_id=tokenizer.eos_token_id,
            )
        elapsed = time.perf_counter() - started
        new_tokens = generated[0, inputs["input_ids"].shape[1]:]
        raw = tokenizer.decode(new_tokens, skip_special_tokens=True).strip()[:MAX_GENERATED_CHARS]
        try:
            parsed = parse_strict_plan(raw)
            parse_error = None
            correct = matches_expected(parsed, case.expected)
        except (ValueError, json.JSONDecodeError) as exc:
            parsed = None
            parse_error = f"{type(exc).__name__}: {str(exc)[:240]}"
            correct = False
        rows.append({
            "case_id": case.case_id,
            "synthetic_instruction": case.instruction,
            "expected": case.expected,
            "generated": raw,
            "parsed": parsed,
            "strict_json": parse_error is None,
            "correct": correct,
            "parse_error": parse_error,
            "latency_seconds": round(elapsed, 3),
            "generated_tokens": int(new_tokens.shape[0]),
        })
    result = {
        "status": "completed",
        "bf16_probe": bf16,
        "dtype": str(dtype).replace("torch.", ""),
        "threads": threads,
        "load_seconds": round(load_seconds, 3),
        "physical_memory_before_load": before_memory,
        "physical_memory_after_probe": physical_memory(),
        "process_memory_after_probe": process_memory(),
        "cases": rows,
    }
    result_path.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return 0


def run_bounded_probe(
    model_dir: Path,
    *,
    threads: int,
    max_new_tokens: int,
    timeout_seconds: int,
    case_limit: int,
) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="athena-wts-planner-") as temp_dir:
        result_path = Path(temp_dir) / "result.json"
        command = [
            sys.executable,
            str(Path(__file__).resolve()),
            "--worker",
            "--model-dir",
            str(model_dir),
            "--worker-result",
            str(result_path),
            "--threads",
            str(threads),
            "--max-new-tokens",
            str(max_new_tokens),
            "--case-limit",
            str(case_limit),
        ]
        started = time.perf_counter()
        process = subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        try:
            _, stderr = process.communicate(timeout=timeout_seconds)
        except subprocess.TimeoutExpired:
            process.kill()
            _, stderr = process.communicate(timeout=15)
            return {
                "status": "timed_out",
                "timeout_seconds": timeout_seconds,
                "elapsed_seconds": round(time.perf_counter() - started, 3),
                "stderr_tail": stderr[-1000:],
                "cases": [],
            }
        if process.returncode != 0:
            return {
                "status": "error",
                "returncode": process.returncode,
                "elapsed_seconds": round(time.perf_counter() - started, 3),
                "stderr_tail": stderr[-1000:],
                "cases": [],
            }
        if not result_path.is_file():
            return {"status": "error", "error": "worker produced no result", "cases": []}
        return json.loads(result_path.read_text(encoding="utf-8"))


def artifact_payload(download: dict[str, Any], probe: dict[str, Any]) -> dict[str, Any]:
    cases = probe.get("cases", [])
    strict_count = sum(bool(row.get("strict_json")) for row in cases)
    correct_count = sum(bool(row.get("correct")) for row in cases)
    latencies = [float(row["latency_seconds"]) for row in cases if "latency_seconds" in row]
    interactive_latency_gate_seconds = 10.0
    status = probe.get("status")
    if status == "timed_out":
        candidate_status = "probe-timed-out"
        latency_gate_pass = None
    elif status != "completed":
        candidate_status = "probe-error"
        latency_gate_pass = None
    elif not latencies:
        candidate_status = "no-measurement"
        latency_gate_pass = None
    else:
        latency_gate_pass = max(latencies) <= interactive_latency_gate_seconds
        candidate_status = (
            "unqualified-initial-probe"
            if latency_gate_pass
            else "not-qualified-interactive-latency"
        )
    return {
        "schema_version": 1,
        "kind": "wts-local-planner-m1-feasibility-probe",
        "created_at": utc_now(),
        "classification": "experimental-unreviewed-synthetic-dev-probe",
        "claims": {
            "initial_feasibility_only": True,
            "m1_full_qualification": False,
            "model_promoted": False,
            "training_performed": False,
            "browser_execution_performed": False,
            "real_user_or_wts_records_used": False,
        },
        "model": download,
        "runtime": {
            "python": platform.python_version(),
            "platform": platform.platform(),
        },
        "probe": probe,
        "summary": {
            "status": status,
            "case_count": len(cases),
            "strict_json_count": strict_count,
            "correct_count": correct_count,
            "all_cases_correct": bool(cases) and correct_count == len(cases),
            "maximum_case_latency_seconds": max(latencies) if latencies else None,
            "interactive_latency_gate_seconds": interactive_latency_gate_seconds,
            "interactive_latency_gate_pass": latency_gate_pass,
            "candidate_status": candidate_status,
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", choices=tuple(MODEL_PROFILES), default="4b")
    parser.add_argument("--model-dir", type=Path)
    parser.add_argument("--artifact-dir", type=Path, default=DEFAULT_ARTIFACT_DIR)
    parser.add_argument("--threads", type=int, default=4, choices=range(1, 7))
    parser.add_argument(
        "--max-new-tokens", type=int, default=128, choices=range(16, 129)
    )
    parser.add_argument(
        "--case-limit",
        type=int,
        default=len(CASES),
        choices=range(1, len(CASES) + 1),
    )
    parser.add_argument("--timeout-seconds", type=int, default=900)
    parser.add_argument("--skip-download", action="store_true")
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--worker-result", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    profile = MODEL_PROFILES[args.profile]
    model_dir = args.model_dir or (DEFAULT_MODEL_ROOT / profile.relative_dir)

    if args.worker:
        if args.worker_result is None:
            parser.error("--worker-result is required with --worker")
        return run_worker(
            model_dir,
            args.worker_result,
            args.threads,
            args.max_new_tokens,
            args.case_limit,
        )

    if args.timeout_seconds < 30 or args.timeout_seconds > 3600:
        parser.error("--timeout-seconds must be between 30 and 3600")
    started = utc_now()
    if args.skip_download:
        files = validate_download(model_dir)
        download = local_integrity_record(profile, files)
    else:
        download = download_model(model_dir, profile)
    probe = run_bounded_probe(
        model_dir,
        threads=args.threads,
        max_new_tokens=args.max_new_tokens,
        timeout_seconds=args.timeout_seconds,
        case_limit=args.case_limit,
    )
    payload = artifact_payload(download, probe)
    payload["started_at"] = started
    args.artifact_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    artifact = args.artifact_dir / f"wts-local-planner-probe-{stamp}.json"
    artifact.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    case_count = payload["summary"]["case_count"]
    print(json.dumps({
        "artifact": str(artifact),
        "status": payload["summary"]["status"],
        "strict_json": f"{payload['summary']['strict_json_count']}/{case_count}",
        "correct": f"{payload['summary']['correct_count']}/{case_count}",
        "m1_full_qualification": False,
    }, ensure_ascii=False))
    return 0 if probe.get("status") == "completed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
