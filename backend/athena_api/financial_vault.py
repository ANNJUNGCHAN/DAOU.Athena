"""Windows CurrentUser DPAPI vault for the WTS financial-read profile.

Only this module sees plaintext App/Secret keys.  The public snapshot API is
small on purpose so the asynchronous profile manager can own lifecycle and
idempotency without teaching the vault about jobs or HTTP.
"""

from __future__ import annotations

import base64
import ctypes
import json
import math
import os
import threading
import time
import uuid
from collections.abc import Callable
from contextlib import ExitStack, contextmanager
from ctypes import wintypes
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Protocol

SCHEMA_VERSION = 1
MAX_PROFILES = 16
MAX_RECORD_BYTES = 3 * 1024 * 1024
VAULT_FILENAME = "credentials.dpapi"
PENDING_FILENAME = ".credentials.dpapi.pending"
PRODUCT_ENTROPY = b"ATHENA/WTS/FinancialReadVault/v1"

CRYPTPROTECT_UI_FORBIDDEN = 0x00000001
FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400
FILE_FLAG_BACKUP_SEMANTICS = 0x02000000
FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000
MOVEFILE_WRITE_THROUGH = 0x00000008
REPLACEFILE_FLAGS = 0


class FinancialVaultError(RuntimeError):
    """A secret-safe vault failure with a stable code."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class VaultCommitPhase(StrEnum):
    PREPARING = "preparing"
    ABORTED = "aborted"
    COMMITTING = "committing"
    FINISHED = "finished"


class VaultCommitOutcome(StrEnum):
    ABORTED_BEFORE_COMMIT = "aborted_before_commit"
    TARGET_VERIFIED = "target_verified"
    PRIOR_VERIFIED = "prior_verified"
    STATE_UNCERTAIN = "state_uncertain"


class VaultCommitControl:
    """Thread-safe publication gate for one credential mutation."""

    def __init__(
        self,
        *,
        deadline: float,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if isinstance(deadline, bool) or not isinstance(deadline, (int, float)):
            raise ValueError("deadline must be a monotonic timestamp")
        if math.isnan(float(deadline)):
            raise ValueError("deadline must be a monotonic timestamp")
        self._deadline = float(deadline)
        self._clock = clock
        self._phase = VaultCommitPhase.PREPARING
        self._lock = threading.Lock()

    @property
    def deadline(self) -> float:
        return self._deadline

    @property
    def phase(self) -> VaultCommitPhase:
        with self._lock:
            return self._phase

    def try_abort(self) -> bool:
        with self._lock:
            if self._phase is not VaultCommitPhase.PREPARING:
                return False
            self._phase = VaultCommitPhase.ABORTED
            return True

    def try_begin_commit(self) -> bool:
        with self._lock:
            if self._phase is not VaultCommitPhase.PREPARING:
                return False
            if self._clock() >= self._deadline:
                self._phase = VaultCommitPhase.ABORTED
                return False
            self._phase = VaultCommitPhase.COMMITTING
            return True

    def is_aborted(self) -> bool:
        with self._lock:
            return self._phase is VaultCommitPhase.ABORTED

    def finish(self) -> None:
        with self._lock:
            self._phase = VaultCommitPhase.FINISHED


class _CommitAborted(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class FinancialCredential:
    profile_id: str
    label: str
    environment: str
    app_key: str
    secret_key: str
    revision: int


@dataclass(frozen=True, slots=True)
class VaultSnapshot:
    schema_version: int = SCHEMA_VERSION
    profiles: tuple[FinancialCredential, ...] = ()


class DataProtector(Protocol):
    def protect(self, plaintext: bytes) -> bytes: ...

    def unprotect(self, ciphertext: bytes) -> bytes: ...


class _DATA_BLOB(ctypes.Structure):
    _fields_ = [
        ("cbData", wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_ubyte)),
    ]


class _FILE_ATTRIBUTE_TAG_INFO(ctypes.Structure):
    _fields_ = [
        ("FileAttributes", wintypes.DWORD),
        ("ReparseTag", wintypes.DWORD),
    ]


class _BY_HANDLE_FILE_INFORMATION(ctypes.Structure):
    _fields_ = [
        ("dwFileAttributes", wintypes.DWORD),
        ("ftCreationTime", wintypes.FILETIME),
        ("ftLastAccessTime", wintypes.FILETIME),
        ("ftLastWriteTime", wintypes.FILETIME),
        ("dwVolumeSerialNumber", wintypes.DWORD),
        ("nFileSizeHigh", wintypes.DWORD),
        ("nFileSizeLow", wintypes.DWORD),
        ("nNumberOfLinks", wintypes.DWORD),
        ("nFileIndexHigh", wintypes.DWORD),
        ("nFileIndexLow", wintypes.DWORD),
    ]


class _ACL_SIZE_INFORMATION(ctypes.Structure):
    _fields_ = [
        ("AceCount", wintypes.DWORD),
        ("AclBytesInUse", wintypes.DWORD),
        ("AclBytesFree", wintypes.DWORD),
    ]


class _ACE_HEADER(ctypes.Structure):
    _fields_ = [
        ("AceType", ctypes.c_ubyte),
        ("AceFlags", ctypes.c_ubyte),
        ("AceSize", wintypes.WORD),
    ]


class _ACCESS_ALLOWED_ACE(ctypes.Structure):
    _fields_ = [
        ("Header", _ACE_HEADER),
        ("Mask", wintypes.DWORD),
        ("SidStart", wintypes.DWORD),
    ]


def _input_blob(data: bytes) -> tuple[_DATA_BLOB, ctypes.Array[ctypes.c_char]]:
    buffer = ctypes.create_string_buffer(data, len(data))
    return (
        _DATA_BLOB(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte))),
        buffer,
    )


class CurrentUserDpapi:
    """DPAPI wrapper with current-user scope and forbidden UI."""

    def __init__(self) -> None:
        if os.name != "nt":
            raise FinancialVaultError("VAULT_PLATFORM_UNSUPPORTED")
        self._crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
        self._kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        self._crypt32.CryptProtectData.argtypes = [
            ctypes.POINTER(_DATA_BLOB),
            wintypes.LPCWSTR,
            ctypes.POINTER(_DATA_BLOB),
            ctypes.c_void_p,
            ctypes.c_void_p,
            wintypes.DWORD,
            ctypes.POINTER(_DATA_BLOB),
        ]
        self._crypt32.CryptProtectData.restype = wintypes.BOOL
        self._crypt32.CryptUnprotectData.argtypes = [
            ctypes.POINTER(_DATA_BLOB),
            ctypes.POINTER(wintypes.LPWSTR),
            ctypes.POINTER(_DATA_BLOB),
            ctypes.c_void_p,
            ctypes.c_void_p,
            wintypes.DWORD,
            ctypes.POINTER(_DATA_BLOB),
        ]
        self._crypt32.CryptUnprotectData.restype = wintypes.BOOL
        self._kernel32.LocalFree.argtypes = [wintypes.HLOCAL]
        self._kernel32.LocalFree.restype = wintypes.HLOCAL

    def protect(self, plaintext: bytes) -> bytes:
        return self._call("CryptProtectData", plaintext, "VAULT_PROTECT_FAILED")

    def unprotect(self, ciphertext: bytes) -> bytes:
        return self._call("CryptUnprotectData", ciphertext, "VAULT_UNPROTECT_FAILED")

    def _call(self, function_name: str, value: bytes, error_code: str) -> bytes:
        source, source_buffer = _input_blob(value)
        entropy, entropy_buffer = _input_blob(PRODUCT_ENTROPY)
        output = _DATA_BLOB()
        try:
            function = getattr(self._crypt32, function_name)
            ctypes.set_last_error(0)
            if not function(
                ctypes.byref(source),
                None,
                ctypes.byref(entropy),
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                ctypes.byref(output),
            ):
                raise FinancialVaultError(error_code)
            return ctypes.string_at(output.pbData, output.cbData)
        finally:
            _ = source_buffer, entropy_buffer
            if output.pbData:
                self._kernel32.LocalFree(ctypes.cast(output.pbData, wintypes.HLOCAL))


def _validate_profile(profile: FinancialCredential) -> None:
    if not all(
        isinstance(value, str)
        for value in (
            profile.profile_id,
            profile.label,
            profile.environment,
            profile.app_key,
            profile.secret_key,
        )
    ):
        raise FinancialVaultError("VAULT_RECORD_INVALID")
    try:
        parsed_id = uuid.UUID(profile.profile_id)
    except (ValueError, AttributeError) as exc:
        raise FinancialVaultError("VAULT_RECORD_INVALID") from exc
    if str(parsed_id) != profile.profile_id:
        raise FinancialVaultError("VAULT_RECORD_INVALID")
    if not (1 <= len(profile.label) <= 64):
        raise FinancialVaultError("VAULT_RECORD_INVALID")
    if profile.environment not in {"mock", "real"}:
        raise FinancialVaultError("VAULT_RECORD_INVALID")
    if not (1 <= len(profile.app_key) <= 256 and 1 <= len(profile.secret_key) <= 256):
        raise FinancialVaultError("VAULT_RECORD_INVALID")
    if (
        not isinstance(profile.revision, int)
        or isinstance(profile.revision, bool)
        or profile.revision < 1
    ):
        raise FinancialVaultError("VAULT_RECORD_INVALID")


def _validate_snapshot(snapshot: VaultSnapshot) -> None:
    if snapshot.schema_version != SCHEMA_VERSION or len(snapshot.profiles) > MAX_PROFILES:
        raise FinancialVaultError("VAULT_RECORD_INVALID")
    profile_ids: set[str] = set()
    for profile in snapshot.profiles:
        _validate_profile(profile)
        if profile.profile_id in profile_ids:
            raise FinancialVaultError("VAULT_RECORD_INVALID")
        profile_ids.add(profile.profile_id)


def _snapshot_bytes(snapshot: VaultSnapshot) -> bytes:
    _validate_snapshot(snapshot)
    document = {
        "schemaVersion": snapshot.schema_version,
        "profiles": [
            {
                "profileId": profile.profile_id,
                "label": profile.label,
                "environment": profile.environment,
                "appKey": profile.app_key,
                "secretKey": profile.secret_key,
                "revision": profile.revision,
            }
            for profile in snapshot.profiles
        ],
    }
    return json.dumps(
        document, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")


def _snapshot_from_bytes(payload: bytes) -> VaultSnapshot:
    try:
        document = json.loads(payload)
        if not isinstance(document, dict) or set(document) != {"schemaVersion", "profiles"}:
            raise ValueError
        if document["schemaVersion"] != SCHEMA_VERSION or not isinstance(
            document["profiles"], list
        ):
            raise ValueError
        profiles: list[FinancialCredential] = []
        for item in document["profiles"]:
            if not isinstance(item, dict) or set(item) != {
                "profileId",
                "label",
                "environment",
                "appKey",
                "secretKey",
                "revision",
            }:
                raise ValueError
            profiles.append(
                FinancialCredential(
                    profile_id=item["profileId"],
                    label=item["label"],
                    environment=item["environment"],
                    app_key=item["appKey"],
                    secret_key=item["secretKey"],
                    revision=item["revision"],
                )
            )
        snapshot = VaultSnapshot(profiles=tuple(profiles))
        _validate_snapshot(snapshot)
        return snapshot
    except (FinancialVaultError, TypeError, UnicodeDecodeError, ValueError) as exc:
        raise FinancialVaultError("VAULT_RECORD_INVALID") from exc


def _envelope_bytes(ciphertext: bytes) -> bytes:
    return json.dumps(
        {
            "ciphertext": base64.b64encode(ciphertext).decode("ascii"),
            "schemaVersion": SCHEMA_VERSION,
        },
        separators=(",", ":"),
        sort_keys=True,
    ).encode("ascii")


def _ciphertext_from_envelope(payload: bytes) -> bytes:
    try:
        document = json.loads(payload)
        if not isinstance(document, dict) or set(document) != {
            "ciphertext",
            "schemaVersion",
        }:
            raise ValueError
        if document["schemaVersion"] != SCHEMA_VERSION or not isinstance(
            document["ciphertext"], str
        ):
            raise ValueError
        return base64.b64decode(document["ciphertext"], validate=True)
    except (TypeError, UnicodeDecodeError, ValueError) as exc:
        raise FinancialVaultError("VAULT_RECORD_INVALID") from exc


def _kernel32() -> ctypes.WinDLL:
    return ctypes.WinDLL("kernel32", use_last_error=True)


@contextmanager
def _open_path_handle(
    path: Path, *, access: int = 0, share: int = 0x00000007
):
    kernel32 = _kernel32()
    kernel32.CreateFileW.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        ctypes.c_void_p,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.HANDLE,
    ]
    kernel32.CreateFileW.restype = wintypes.HANDLE
    kernel32.GetFileInformationByHandleEx.argtypes = [
        wintypes.HANDLE,
        ctypes.c_int,
        ctypes.c_void_p,
        wintypes.DWORD,
    ]
    kernel32.GetFileInformationByHandleEx.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    handle = kernel32.CreateFileW(
        str(path),
        access,
        share,
        None,
        3,
        FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
        None,
    )
    if handle == wintypes.HANDLE(-1).value:
        raise FinancialVaultError("VAULT_PATH_UNSAFE")
    try:
        yield kernel32, handle
    finally:
        kernel32.CloseHandle(handle)


def _path_from_handle(kernel32: ctypes.WinDLL, handle: int) -> Path:
    kernel32.GetFinalPathNameByHandleW.argtypes = [
        wintypes.HANDLE,
        wintypes.LPWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
    ]
    kernel32.GetFinalPathNameByHandleW.restype = wintypes.DWORD
    required = kernel32.GetFinalPathNameByHandleW(handle, None, 0, 0)
    if required == 0:
        raise FinancialVaultError("VAULT_PATH_UNSAFE")
    buffer = ctypes.create_unicode_buffer(required + 1)
    written = kernel32.GetFinalPathNameByHandleW(handle, buffer, len(buffer), 0)
    if written == 0 or written >= len(buffer):
        raise FinancialVaultError("VAULT_PATH_UNSAFE")
    value = buffer.value
    if value.startswith("\\\\?\\UNC\\"):
        value = "\\\\" + value[8:]
    elif value.startswith("\\\\?\\"):
        value = value[4:]
    return Path(os.path.abspath(value))


def _validate_open_handle(
    kernel32: ctypes.WinDLL,
    handle: int,
    expected_path: Path,
    *,
    expected_identity: tuple[int, int] | None = None,
) -> tuple[int, int]:
    tag_info = _FILE_ATTRIBUTE_TAG_INFO()
    if not kernel32.GetFileInformationByHandleEx(
        handle, 9, ctypes.byref(tag_info), ctypes.sizeof(tag_info)
    ) or tag_info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT:
        raise FinancialVaultError("VAULT_PATH_UNSAFE")
    actual_path = _path_from_handle(kernel32, handle)
    expected = Path(os.path.abspath(expected_path))
    if os.path.normcase(str(actual_path)) != os.path.normcase(str(expected)):
        raise FinancialVaultError("VAULT_PATH_UNSAFE")
    kernel32.GetFileInformationByHandle.argtypes = [
        wintypes.HANDLE,
        ctypes.POINTER(_BY_HANDLE_FILE_INFORMATION),
    ]
    kernel32.GetFileInformationByHandle.restype = wintypes.BOOL
    information = _BY_HANDLE_FILE_INFORMATION()
    if not kernel32.GetFileInformationByHandle(handle, ctypes.byref(information)):
        raise FinancialVaultError("VAULT_PATH_UNSAFE")
    identity = (
        information.dwVolumeSerialNumber,
        (information.nFileIndexHigh << 32) | information.nFileIndexLow,
    )
    if expected_identity is not None and identity != expected_identity:
        raise FinancialVaultError("VAULT_PATH_UNSAFE")
    return identity


@contextmanager
def _hold_directory_boundary(path: Path):
    """Hold the full physical directory chain without delete sharing."""
    if not path.is_absolute():
        raise FinancialVaultError("VAULT_PATH_INVALID")
    normalized = Path(os.path.abspath(path))
    if os.path.normcase(str(normalized)) != os.path.normcase(str(path)):
        raise FinancialVaultError("VAULT_PATH_INVALID")
    chain: list[Path] = []
    current = path.parent
    while current != current.parent:
        chain.append(current)
        current = current.parent
    chain.append(current)
    with ExitStack() as stack:
        for component in reversed(chain):
            if not os.path.lexists(component):
                raise FinancialVaultError("VAULT_PATH_INVALID")
            kernel32, handle = stack.enter_context(
                _open_path_handle(component, share=0x00000003)
            )
            _validate_open_handle(kernel32, handle, component)

        created = not os.path.lexists(path)
        if created:
            try:
                path.mkdir(mode=0o700)
            except OSError as exc:
                raise FinancialVaultError("VAULT_PATH_INVALID") from exc
        if not path.is_dir():
            raise FinancialVaultError("VAULT_PATH_INVALID")
        kernel32, handle = stack.enter_context(
            _open_path_handle(
                path,
                access=0x00020000 | (0x00040000 | 0x00080000 if created else 0),
                share=0x00000003,
            )
        )
        identity = _validate_open_handle(kernel32, handle, path)
        _set_and_verify_acl_handle(handle, apply=created, expected_path=path)
        yield kernel32, handle, identity


def _reject_reparse(path: Path) -> None:
    if not os.path.lexists(path):
        return
    with _open_path_handle(path) as (kernel32, handle):
        tag_info = _FILE_ATTRIBUTE_TAG_INFO()
        if not kernel32.GetFileInformationByHandleEx(
            handle, 9, ctypes.byref(tag_info), ctypes.sizeof(tag_info)
        ):
            raise FinancialVaultError("VAULT_PATH_UNSAFE")
        if tag_info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT:
            raise FinancialVaultError("VAULT_PATH_UNSAFE")


def _validate_physical_path(path: Path, *, may_not_exist: bool = False) -> None:
    if not path.is_absolute():
        raise FinancialVaultError("VAULT_PATH_INVALID")
    normalized = Path(os.path.abspath(path))
    if os.path.normcase(str(normalized)) != os.path.normcase(str(path)):
        raise FinancialVaultError("VAULT_PATH_INVALID")
    resolved = path.resolve(strict=False)
    if os.path.normcase(str(resolved)) != os.path.normcase(str(path)):
        raise FinancialVaultError("VAULT_PATH_UNSAFE")
    chain: list[Path] = []
    current = path if os.path.lexists(path) else path.parent
    while current != current.parent:
        chain.append(current)
        current = current.parent
    chain.append(current)
    for component in reversed(chain):
        if os.path.lexists(component):
            _reject_reparse(component)
        elif component != path or not may_not_exist:
            raise FinancialVaultError("VAULT_PATH_INVALID")


def _move_first(source: Path, target: Path) -> None:
    kernel32 = _kernel32()
    kernel32.MoveFileExW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD]
    kernel32.MoveFileExW.restype = wintypes.BOOL
    if not kernel32.MoveFileExW(
        str(source), str(target), MOVEFILE_WRITE_THROUGH
    ):
        raise FinancialVaultError("VAULT_COMMIT_FAILED")


def _replace_file(target: Path, replacement: Path, backup: Path | None) -> None:
    kernel32 = _kernel32()
    kernel32.ReplaceFileW.argtypes = [
        wintypes.LPCWSTR,
        wintypes.LPCWSTR,
        wintypes.LPCWSTR,
        wintypes.DWORD,
        ctypes.c_void_p,
        ctypes.c_void_p,
    ]
    kernel32.ReplaceFileW.restype = wintypes.BOOL
    if not kernel32.ReplaceFileW(
        str(target),
        str(replacement),
        str(backup) if backup else None,
        REPLACEFILE_FLAGS,
        None,
        None,
    ):
        raise FinancialVaultError("VAULT_COMMIT_FAILED")


def _flush_file(path: Path) -> None:
    with path.open("r+b") as handle:
        os.fsync(handle.fileno())


def _read_checked(path: Path, *, max_bytes: int = MAX_RECORD_BYTES) -> bytes:
    """Read an already validated non-reparse file while denying replacement."""
    _validate_physical_path(path)
    with _open_path_handle(path, access=0x80000000, share=0x00000001) as (
        kernel32,
        handle,
    ):
        identity = _validate_open_handle(kernel32, handle, path)
        _set_and_verify_acl_handle(handle, apply=False, expected_path=path)
        size = ctypes.c_longlong()
        kernel32.GetFileSizeEx.argtypes = [wintypes.HANDLE, ctypes.POINTER(ctypes.c_longlong)]
        kernel32.GetFileSizeEx.restype = wintypes.BOOL
        if not kernel32.GetFileSizeEx(handle, ctypes.byref(size)):
            raise FinancialVaultError("VAULT_READ_FAILED")
        if size.value <= 0 or size.value > max_bytes:
            raise FinancialVaultError("VAULT_RECORD_INVALID")
        buffer = ctypes.create_string_buffer(size.value)
        read = wintypes.DWORD()
        kernel32.ReadFile.argtypes = [
            wintypes.HANDLE,
            ctypes.c_void_p,
            wintypes.DWORD,
            ctypes.POINTER(wintypes.DWORD),
            ctypes.c_void_p,
        ]
        kernel32.ReadFile.restype = wintypes.BOOL
        if not kernel32.ReadFile(
            handle, buffer, size.value, ctypes.byref(read), None
        ) or read.value != size.value:
            raise FinancialVaultError("VAULT_READ_FAILED")
        _validate_open_handle(
            kernel32, handle, path, expected_identity=identity
        )
        return buffer.raw[: read.value]


def _flush_directory_advisory(path: Path) -> bool:
    """Attempt a directory flush; return False where Windows filesystems refuse it.

    File fsync plus MoveFileExW WRITE_THROUGH/ReplaceFileW remain authoritative.
    Windows commonly returns ERROR_INVALID_FUNCTION or ERROR_ACCESS_DENIED for a
    directory handle, so this call is recorded as advisory rather than claimed as
    a power-loss durability guarantee.
    """
    kernel32 = _kernel32()
    kernel32.CreateFileW.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        ctypes.c_void_p,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.HANDLE,
    ]
    kernel32.CreateFileW.restype = wintypes.HANDLE
    kernel32.FlushFileBuffers.argtypes = [wintypes.HANDLE]
    kernel32.FlushFileBuffers.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    handle = kernel32.CreateFileW(
        str(path), 0x80000000, 0x00000007, None, 3, 0x02000000, None
    )
    invalid_handle = wintypes.HANDLE(-1).value
    if handle == invalid_handle:
        return False
    try:
        ctypes.set_last_error(0)
        if kernel32.FlushFileBuffers(handle):
            return True
        if ctypes.get_last_error() not in {1, 5}:
            raise FinancialVaultError("VAULT_FLUSH_FAILED")
        return False
    finally:
        kernel32.CloseHandle(handle)


def _current_user_sid() -> str:
    advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel32 = _kernel32()
    kernel32.GetCurrentProcess.argtypes = []
    kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [wintypes.HLOCAL]
    kernel32.LocalFree.restype = wintypes.HLOCAL
    advapi32.OpenProcessToken.argtypes = [
        wintypes.HANDLE,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.HANDLE),
    ]
    advapi32.OpenProcessToken.restype = wintypes.BOOL
    advapi32.GetTokenInformation.argtypes = [
        wintypes.HANDLE,
        ctypes.c_int,
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD),
    ]
    advapi32.GetTokenInformation.restype = wintypes.BOOL
    advapi32.ConvertSidToStringSidW.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(wintypes.LPWSTR),
    ]
    advapi32.ConvertSidToStringSidW.restype = wintypes.BOOL
    token = wintypes.HANDLE()
    if not advapi32.OpenProcessToken(kernel32.GetCurrentProcess(), 0x0008, ctypes.byref(token)):
        raise FinancialVaultError("VAULT_ACL_FAILED")
    try:
        required = wintypes.DWORD()
        advapi32.GetTokenInformation(token, 1, None, 0, ctypes.byref(required))
        buffer = ctypes.create_string_buffer(required.value)
        if not advapi32.GetTokenInformation(
            token, 1, buffer, required, ctypes.byref(required)
        ):
            raise FinancialVaultError("VAULT_ACL_FAILED")
        sid_pointer = ctypes.c_void_p.from_buffer(buffer).value
        sid_string = wintypes.LPWSTR()
        if not advapi32.ConvertSidToStringSidW(sid_pointer, ctypes.byref(sid_string)):
            raise FinancialVaultError("VAULT_ACL_FAILED")
        try:
            return sid_string.value
        finally:
            kernel32.LocalFree(sid_string)
    finally:
        kernel32.CloseHandle(token)


def _set_and_verify_acl_handle(
    handle: int, *, apply: bool = True, expected_path: Path | None = None
) -> None:
    advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel32 = _kernel32()
    if expected_path is not None:
        _validate_open_handle(kernel32, handle, expected_path)
    kernel32.LocalFree.argtypes = [wintypes.HLOCAL]
    kernel32.LocalFree.restype = wintypes.HLOCAL
    advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        ctypes.POINTER(ctypes.c_void_p),
        ctypes.POINTER(wintypes.DWORD),
    ]
    advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW.restype = wintypes.BOOL
    advapi32.ConvertStringSidToSidW.argtypes = [
        wintypes.LPCWSTR,
        ctypes.POINTER(ctypes.c_void_p),
    ]
    advapi32.ConvertStringSidToSidW.restype = wintypes.BOOL
    advapi32.GetSecurityDescriptorDacl.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(wintypes.BOOL),
        ctypes.POINTER(ctypes.c_void_p),
        ctypes.POINTER(wintypes.BOOL),
    ]
    advapi32.GetSecurityDescriptorDacl.restype = wintypes.BOOL
    advapi32.SetSecurityInfo.argtypes = [
        wintypes.HANDLE,
        ctypes.c_int,
        wintypes.DWORD,
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_void_p,
    ]
    advapi32.SetSecurityInfo.restype = wintypes.DWORD
    advapi32.GetSecurityInfo.argtypes = [
        wintypes.HANDLE,
        ctypes.c_int,
        wintypes.DWORD,
        ctypes.POINTER(ctypes.c_void_p),
        ctypes.POINTER(ctypes.c_void_p),
        ctypes.POINTER(ctypes.c_void_p),
        ctypes.POINTER(ctypes.c_void_p),
        ctypes.POINTER(ctypes.c_void_p),
    ]
    advapi32.GetSecurityInfo.restype = wintypes.DWORD
    advapi32.EqualSid.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    advapi32.EqualSid.restype = wintypes.BOOL
    advapi32.GetSecurityDescriptorControl.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(wintypes.WORD),
        ctypes.POINTER(wintypes.DWORD),
    ]
    advapi32.GetSecurityDescriptorControl.restype = wintypes.BOOL
    advapi32.GetAclInformation.argtypes = [
        ctypes.c_void_p,
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.c_int,
    ]
    advapi32.GetAclInformation.restype = wintypes.BOOL
    advapi32.GetAce.argtypes = [
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.POINTER(ctypes.c_void_p),
    ]
    advapi32.GetAce.restype = wintypes.BOOL
    advapi32.ConvertSidToStringSidW.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(wintypes.LPWSTR),
    ]
    advapi32.ConvertSidToStringSidW.restype = wintypes.BOOL

    sid = _current_user_sid()
    security_descriptor = ctypes.c_void_p()
    size = wintypes.DWORD()
    sddl = f"D:P(A;;FA;;;SY)(A;;FA;;;{sid})"
    if not advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW(
        sddl, 1, ctypes.byref(security_descriptor), ctypes.byref(size)
    ):
        raise FinancialVaultError("VAULT_ACL_FAILED")
    owner_sid = ctypes.c_void_p()
    if not advapi32.ConvertStringSidToSidW(sid, ctypes.byref(owner_sid)):
        kernel32.LocalFree(security_descriptor)
        raise FinancialVaultError("VAULT_ACL_FAILED")
    try:
        dacl_present = wintypes.BOOL()
        dacl_defaulted = wintypes.BOOL()
        dacl = ctypes.c_void_p()
        if not advapi32.GetSecurityDescriptorDacl(
            security_descriptor,
            ctypes.byref(dacl_present),
            ctypes.byref(dacl),
            ctypes.byref(dacl_defaulted),
        ) or not dacl_present:
            raise FinancialVaultError("VAULT_ACL_FAILED")
        if apply:
            security_information = 0x00000001 | 0x00000004 | 0x80000000
            result = advapi32.SetSecurityInfo(
                handle, 1, security_information, owner_sid, None, dacl, None
            )
            if result != 0:
                raise FinancialVaultError("VAULT_ACL_FAILED")

        actual_owner = ctypes.c_void_p()
        actual_dacl = ctypes.c_void_p()
        actual_descriptor = ctypes.c_void_p()
        result = advapi32.GetSecurityInfo(
            handle,
            1,
            0x00000001 | 0x00000004,
            ctypes.byref(actual_owner),
            None,
            ctypes.byref(actual_dacl),
            None,
            ctypes.byref(actual_descriptor),
        )
        if result != 0 or not advapi32.EqualSid(owner_sid, actual_owner):
            raise FinancialVaultError("VAULT_ACL_FAILED")
        try:
            control = wintypes.WORD()
            control_revision = wintypes.DWORD()
            if not advapi32.GetSecurityDescriptorControl(
                actual_descriptor,
                ctypes.byref(control),
                ctypes.byref(control_revision),
            ) or not control.value & 0x1000:
                raise FinancialVaultError("VAULT_ACL_FAILED")
            acl_info = _ACL_SIZE_INFORMATION()
            if not advapi32.GetAclInformation(
                actual_dacl,
                ctypes.byref(acl_info),
                ctypes.sizeof(acl_info),
                2,
            ) or acl_info.AceCount != 2:
                raise FinancialVaultError("VAULT_ACL_FAILED")
            actual_entries: set[tuple[str, int, int, int]] = set()
            for index in range(acl_info.AceCount):
                ace_pointer = ctypes.c_void_p()
                if not advapi32.GetAce(
                    actual_dacl, index, ctypes.byref(ace_pointer)
                ):
                    raise FinancialVaultError("VAULT_ACL_FAILED")
                ace = ctypes.cast(
                    ace_pointer, ctypes.POINTER(_ACCESS_ALLOWED_ACE)
                ).contents
                sid_pointer = ctypes.c_void_p(
                    ace_pointer.value + _ACCESS_ALLOWED_ACE.SidStart.offset
                )
                sid_string = wintypes.LPWSTR()
                if not advapi32.ConvertSidToStringSidW(
                    sid_pointer, ctypes.byref(sid_string)
                ):
                    raise FinancialVaultError("VAULT_ACL_FAILED")
                try:
                    actual_entries.add(
                        (
                            sid_string.value,
                            ace.Header.AceType,
                            ace.Header.AceFlags,
                            ace.Mask,
                        )
                    )
                finally:
                    kernel32.LocalFree(sid_string)
            expected_entries = {
                ("S-1-5-18", 0, 0, 0x001F01FF),
                (sid, 0, 0, 0x001F01FF),
            }
            if actual_entries != expected_entries:
                raise FinancialVaultError("VAULT_ACL_FAILED")
        finally:
            if actual_descriptor:
                kernel32.LocalFree(actual_descriptor)
    finally:
        kernel32.LocalFree(owner_sid)
        kernel32.LocalFree(security_descriptor)


def _set_and_verify_acl(path: Path, *, apply: bool = True) -> None:
    access = 0x00020000
    if apply:
        access |= 0x00040000 | 0x00080000
    with _open_path_handle(path, access=access, share=0x00000001) as (
        kernel32,
        handle,
    ):
        identity = _validate_open_handle(kernel32, handle, path)
        _set_and_verify_acl_handle(handle, apply=apply, expected_path=path)
        _validate_open_handle(
            kernel32, handle, path, expected_identity=identity
        )


class FinancialVault:
    def __init__(self, data_dir: Path, *, dpapi: DataProtector | None = None) -> None:
        if os.name != "nt":
            raise FinancialVaultError("VAULT_PLATFORM_UNSUPPORTED")
        raw_path = Path(data_dir)
        if not raw_path.is_absolute() or raw_path.name in {"", ".", ".."}:
            raise FinancialVaultError("VAULT_PATH_INVALID")
        _validate_physical_path(raw_path, may_not_exist=True)
        self.data_dir = raw_path
        self.path = raw_path / VAULT_FILENAME
        self.pending_path = raw_path / PENDING_FILENAME
        self._dpapi = dpapi or CurrentUserDpapi()

    def read_snapshot(self) -> VaultSnapshot:
        with _hold_directory_boundary(self.data_dir) as boundary:
            self._require_recovered()
            if not os.path.lexists(self.path):
                return VaultSnapshot()
            encrypted = _read_checked(self.path)
            _validate_open_handle(
                boundary[0],
                boundary[1],
                self.data_dir,
                expected_identity=boundary[2],
            )
            return self._snapshot_from_encrypted(encrypted)

    def _snapshot_from_encrypted(self, payload: bytes) -> VaultSnapshot:
        plaintext = self._dpapi.unprotect(_ciphertext_from_envelope(payload))
        try:
            return _snapshot_from_bytes(plaintext)
        finally:
            # bytes are immutable; scope the reference tightly and never retain it.
            del plaintext

    def commit_snapshot(self, snapshot: VaultSnapshot) -> None:
        control = VaultCommitControl(deadline=math.inf)
        outcome, error = self._commit_snapshot_bounded_result(snapshot, control)
        if outcome is VaultCommitOutcome.TARGET_VERIFIED:
            return
        if outcome is VaultCommitOutcome.PRIOR_VERIFIED:
            if isinstance(error, FinancialVaultError):
                raise error
            raise FinancialVaultError("VAULT_COMMIT_FAILED") from error
        if outcome is VaultCommitOutcome.STATE_UNCERTAIN:
            raise FinancialVaultError("VAULT_ROLLBACK_FAILED") from error
        raise FinancialVaultError("VAULT_COMMIT_FAILED")

    def commit_snapshot_bounded(
        self, snapshot: VaultSnapshot, control: VaultCommitControl
    ) -> VaultCommitOutcome:
        outcome, _ = self._commit_snapshot_bounded_result(snapshot, control)
        return outcome

    def _commit_snapshot_bounded_result(
        self, snapshot: VaultSnapshot, control: VaultCommitControl
    ) -> tuple[VaultCommitOutcome, Exception | None]:
        try:
            try:
                with _hold_directory_boundary(self.data_dir) as boundary:
                    return self._commit_snapshot_controlled(snapshot, control, boundary)
            except _CommitAborted:
                return VaultCommitOutcome.ABORTED_BEFORE_COMMIT, None
        finally:
            control.finish()

    def _commit_snapshot_controlled(
        self,
        snapshot: VaultSnapshot,
        control: VaultCommitControl,
        boundary: tuple[ctypes.WinDLL, int, tuple[int, int]],
    ) -> tuple[VaultCommitOutcome, Exception | None]:
        self._require_recovered()
        self._raise_if_aborted(control)
        plaintext = _snapshot_bytes(snapshot)
        try:
            envelope = _envelope_bytes(self._dpapi.protect(plaintext))
        finally:
            del plaintext
        self._raise_if_aborted(control)
        if len(envelope) > MAX_RECORD_BYTES:
            raise FinancialVaultError("VAULT_RECORD_TOO_LARGE")

        temp_path = self.data_dir / f".{VAULT_FILENAME}.{uuid.uuid4().hex}.tmp"
        backup_path = self.data_dir / f".{VAULT_FILENAME}.{uuid.uuid4().hex}.bak"
        existed = os.path.lexists(self.path)
        old_payload = _read_checked(self.path) if existed else None
        old_snapshot = (
            self._snapshot_from_encrypted(old_payload)
            if old_payload is not None
            else None
        )
        gate_entered = False
        rollback_discard: Path | None = None
        try:
            self._raise_if_aborted(control)
            with temp_path.open("xb") as handle:
                handle.write(envelope)
                handle.flush()
                os.fsync(handle.fileno())
            self._raise_if_aborted(control)
            _set_and_verify_acl(temp_path)
            _flush_file(temp_path)
            _validate_physical_path(self.data_dir)
            _reject_reparse(temp_path)
            self._raise_if_aborted(control)
            if not control.try_begin_commit():
                raise _CommitAborted
            gate_entered = True
            self._write_pending_marker()
            if existed:
                _validate_physical_path(self.path)
                _replace_file(self.path, temp_path, backup_path)
                _validate_physical_path(backup_path)
                _set_and_verify_acl(backup_path, apply=False)
                if _read_checked(backup_path) != old_payload:
                    raise FinancialVaultError("VAULT_BACKUP_INVALID")
            else:
                _move_first(temp_path, self.path)
            _validate_physical_path(self.path)
            _flush_file(self.path)
            _flush_directory_advisory(self.data_dir)
            if self._snapshot_from_encrypted(_read_checked(self.path)) != snapshot:
                raise FinancialVaultError("VAULT_VERIFY_FAILED")
            verified_backup = False
            if os.path.lexists(backup_path):
                _validate_physical_path(backup_path)
                _set_and_verify_acl(backup_path, apply=False)
                if old_payload is None or _read_checked(backup_path) != old_payload:
                    raise FinancialVaultError("VAULT_BACKUP_INVALID")
                verified_backup = True
            _validate_open_handle(
                boundary[0],
                boundary[1],
                self.data_dir,
                expected_identity=boundary[2],
            )
            _flush_directory_advisory(self.data_dir)
            self._remove_pending_marker()
            self._cleanup_paths_best_effort(
                temp_path, backup_path if verified_backup else None
            )
            return VaultCommitOutcome.TARGET_VERIFIED, None
        except _CommitAborted:
            self._cleanup_paths_best_effort(temp_path)
            return VaultCommitOutcome.ABORTED_BEFORE_COMMIT, None
        except Exception as exc:
            if not gate_entered:
                self._cleanup_paths_best_effort(temp_path)
                if control.is_aborted():
                    return VaultCommitOutcome.ABORTED_BEFORE_COMMIT, None
                raise
            if self._matches_snapshot(snapshot):
                try:
                    self._finalize_authoritative_state(boundary)
                except Exception as finalize_exc:
                    return VaultCommitOutcome.STATE_UNCERTAIN, finalize_exc
                self._cleanup_paths_best_effort(temp_path, backup_path)
                return VaultCommitOutcome.TARGET_VERIFIED, exc
            try:
                rollback_discard = self._rollback(existed, backup_path, old_payload)
                if not self._matches_prior(existed, old_payload, old_snapshot):
                    raise FinancialVaultError("VAULT_ROLLBACK_FAILED")
                self._finalize_authoritative_state(boundary)
            except Exception as rollback_exc:
                return VaultCommitOutcome.STATE_UNCERTAIN, rollback_exc
            self._cleanup_paths_best_effort(
                temp_path, backup_path, rollback_discard
            )
            return VaultCommitOutcome.PRIOR_VERIFIED, exc

    @staticmethod
    def _raise_if_aborted(control: VaultCommitControl) -> None:
        if control.is_aborted():
            raise _CommitAborted

    def _matches_snapshot(self, snapshot: VaultSnapshot) -> bool:
        try:
            return (
                os.path.lexists(self.path)
                and self._snapshot_from_encrypted(_read_checked(self.path)) == snapshot
            )
        except Exception:
            return False

    def _matches_prior(
        self,
        existed: bool,
        old_payload: bytes | None,
        old_snapshot: VaultSnapshot | None,
    ) -> bool:
        if not existed:
            return not os.path.lexists(self.path)
        if (
            old_payload is None
            or old_snapshot is None
            or not os.path.lexists(self.path)
        ):
            return False
        try:
            restored_payload = _read_checked(self.path)
            return (
                restored_payload == old_payload
                and self._snapshot_from_encrypted(restored_payload) == old_snapshot
            )
        except Exception:
            return False

    def _finalize_authoritative_state(
        self, boundary: tuple[ctypes.WinDLL, int, tuple[int, int]]
    ) -> None:
        _validate_open_handle(
            boundary[0],
            boundary[1],
            self.data_dir,
            expected_identity=boundary[2],
        )
        _flush_directory_advisory(self.data_dir)
        self._remove_pending_marker()

    @staticmethod
    def _cleanup_paths_best_effort(*paths: Path | None) -> None:
        for path in paths:
            if path is None:
                continue
            try:
                if os.path.lexists(path):
                    _reject_reparse(path)
                    path.unlink()
            except Exception:
                pass

    def _require_recovered(self) -> None:
        if os.path.lexists(self.pending_path):
            _validate_physical_path(self.pending_path)
            _set_and_verify_acl(self.pending_path, apply=False)
            raise FinancialVaultError("VAULT_RECOVERY_REQUIRED")

    def _write_pending_marker(self) -> None:
        _validate_physical_path(self.data_dir)
        with self.pending_path.open("xb") as handle:
            handle.write(b"pending\n")
            handle.flush()
            os.fsync(handle.fileno())
        _set_and_verify_acl(self.pending_path)
        _flush_file(self.pending_path)
        _flush_directory_advisory(self.data_dir)

    def _remove_pending_marker(self) -> None:
        if os.path.lexists(self.pending_path):
            _validate_physical_path(self.pending_path)
            _set_and_verify_acl(self.pending_path, apply=False)
            self.pending_path.unlink()

    def _rollback(
        self, existed: bool, backup_path: Path, old_payload: bytes | None
    ) -> Path | None:
        rollback_discard: Path | None = None
        if existed:
            if old_payload is None:
                raise FinancialVaultError("VAULT_ROLLBACK_FAILED")
            current_is_old = False
            if os.path.lexists(self.path):
                current_is_old = _read_checked(self.path) == old_payload
            if not current_is_old:
                if not os.path.lexists(backup_path):
                    raise FinancialVaultError("VAULT_ROLLBACK_FAILED")
                _validate_physical_path(backup_path)
                _set_and_verify_acl(backup_path, apply=False)
                if _read_checked(backup_path) != old_payload:
                    raise FinancialVaultError("VAULT_ROLLBACK_FAILED")
                restore_path = (
                    self.data_dir / f".{VAULT_FILENAME}.{uuid.uuid4().hex}.restore"
                )
                restore_published = False
                try:
                    with restore_path.open("xb") as handle:
                        handle.write(old_payload)
                        handle.flush()
                        os.fsync(handle.fileno())
                    _set_and_verify_acl(restore_path)
                    _flush_file(restore_path)
                    if os.path.lexists(self.path):
                        rollback_discard = (
                            self.data_dir
                            / f".{VAULT_FILENAME}.{uuid.uuid4().hex}.rollback"
                        )
                        _replace_file(self.path, restore_path, rollback_discard)
                    else:
                        _move_first(restore_path, self.path)
                    restore_published = True
                finally:
                    if restore_published and os.path.lexists(restore_path):
                        _reject_reparse(restore_path)
                        restore_path.unlink()
            _validate_physical_path(self.path)
            _set_and_verify_acl(self.path, apply=False)
            _flush_file(self.path)
            if _read_checked(self.path) != old_payload:
                raise FinancialVaultError("VAULT_ROLLBACK_FAILED")
        elif os.path.lexists(self.path):
            _validate_physical_path(self.path)
            _set_and_verify_acl(self.path, apply=False)
            self.path.unlink()
            if os.path.lexists(self.path):
                raise FinancialVaultError("VAULT_ROLLBACK_FAILED")
        _flush_directory_advisory(self.data_dir)
        return rollback_discard
