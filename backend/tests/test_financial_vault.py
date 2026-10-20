from __future__ import annotations

import json
import os
import subprocess
import threading
import uuid
from contextlib import contextmanager
from pathlib import Path

import pytest

import athena_api.financial_vault as module
from athena_api.financial_vault import (
    CurrentUserDpapi,
    FinancialCredential,
    FinancialVault,
    FinancialVaultError,
    VaultCommitControl,
    VaultCommitOutcome,
    VaultCommitPhase,
    VaultSnapshot,
)


def _credential(**changes: object) -> FinancialCredential:
    values: dict[str, object] = {
        "profile_id": str(uuid.uuid4()),
        "label": "테스트 프로필",
        "environment": "mock",
        "app_key": "SYNTHETIC_APP_KEY_CANARY",
        "secret_key": "SYNTHETIC_SECRET_KEY_CANARY",
        "revision": 1,
    }
    values.update(changes)
    return FinancialCredential(**values)  # type: ignore[arg-type]


def _vault(tmp_path: Path) -> FinancialVault:
    return FinancialVault(tmp_path / "financial-read-v1")


def test_current_user_dpapi_round_trip_uses_synthetic_bytes_only() -> None:
    protector = CurrentUserDpapi()
    plaintext = b"athena-financial-vault-synthetic-roundtrip"
    ciphertext = protector.protect(plaintext)
    assert ciphertext != plaintext
    assert protector.unprotect(ciphertext) == plaintext


def test_commit_control_arbitrates_abort_and_gate_with_clock_under_lock() -> None:
    clock_entered = threading.Event()
    release_clock = threading.Event()
    begin_result: list[bool] = []
    abort_result: list[bool] = []

    def blocked_clock() -> float:
        clock_entered.set()
        assert release_clock.wait(5)
        return 1.0

    control = VaultCommitControl(deadline=2.0, clock=blocked_clock)
    begin_thread = threading.Thread(
        target=lambda: begin_result.append(control.try_begin_commit())
    )
    abort_thread = threading.Thread(target=lambda: abort_result.append(control.try_abort()))
    begin_thread.start()
    assert clock_entered.wait(5)
    abort_thread.start()
    assert not abort_result
    release_clock.set()
    begin_thread.join(5)
    abort_thread.join(5)
    assert begin_result == [True]
    assert abort_result == [False]
    assert control.phase is VaultCommitPhase.COMMITTING

    aborted = VaultCommitControl(deadline=2.0, clock=lambda: 1.0)
    assert aborted.try_abort()
    assert not aborted.try_begin_commit()
    assert aborted.phase is VaultCommitPhase.ABORTED


def test_expired_commit_gate_aborts_without_publication(tmp_path: Path) -> None:
    vault = _vault(tmp_path)
    original = VaultSnapshot(profiles=(_credential(),))
    vault.commit_snapshot(original)
    updated = VaultSnapshot(
        profiles=(
            _credential(profile_id=original.profiles[0].profile_id, revision=2),
        )
    )
    control = VaultCommitControl(deadline=1.0, clock=lambda: 1.0)
    outcome = vault.commit_snapshot_bounded(updated, control)
    assert outcome is VaultCommitOutcome.ABORTED_BEFORE_COMMIT
    assert control.phase is VaultCommitPhase.FINISHED
    assert vault.read_snapshot() == original
    assert not vault.pending_path.exists()
    assert not list(vault.data_dir.glob("*.tmp"))


def test_blocked_preparation_abort_cleans_private_temp_without_publication(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    vault = _vault(tmp_path)
    original = VaultSnapshot(profiles=(_credential(),))
    vault.commit_snapshot(original)
    updated = VaultSnapshot(
        profiles=(
            _credential(profile_id=original.profiles[0].profile_id, revision=2),
        )
    )
    blocked = threading.Event()
    release = threading.Event()
    real_flush = module._flush_file
    result: list[VaultCommitOutcome] = []
    errors: list[BaseException] = []

    def block_temp_flush(path: Path) -> None:
        if path.suffix == ".tmp":
            blocked.set()
            assert release.wait(5)
        real_flush(path)

    def run_commit() -> None:
        try:
            result.append(vault.commit_snapshot_bounded(updated, control))
        except BaseException as exc:
            errors.append(exc)

    monkeypatch.setattr(module, "_flush_file", block_temp_flush)
    control = VaultCommitControl(deadline=module.time.monotonic() + 60)
    worker = threading.Thread(target=run_commit)
    worker.start()
    assert blocked.wait(5)
    assert control.try_abort()
    release.set()
    worker.join(5)
    assert not worker.is_alive()
    assert not errors
    assert result == [VaultCommitOutcome.ABORTED_BEFORE_COMMIT]
    assert control.phase is VaultCommitPhase.FINISHED
    assert vault.read_snapshot() == original
    assert not vault.pending_path.exists()
    assert not list(vault.data_dir.glob("*.tmp"))


def test_commit_gate_winner_cannot_be_aborted_while_publication_is_blocked(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    vault = _vault(tmp_path)
    original = VaultSnapshot(profiles=(_credential(),))
    vault.commit_snapshot(original)
    updated = VaultSnapshot(
        profiles=(
            _credential(profile_id=original.profiles[0].profile_id, revision=2),
        )
    )
    publication_started = threading.Event()
    release = threading.Event()
    real_replace = module._replace_file
    result: list[VaultCommitOutcome] = []

    def block_publication(
        target: Path, replacement: Path, backup: Path | None
    ) -> None:
        publication_started.set()
        assert release.wait(5)
        real_replace(target, replacement, backup)

    monkeypatch.setattr(module, "_replace_file", block_publication)
    control = VaultCommitControl(deadline=1.0, clock=lambda: 0.0)
    worker = threading.Thread(
        target=lambda: result.append(vault.commit_snapshot_bounded(updated, control))
    )
    worker.start()
    assert publication_started.wait(5)
    assert control.phase is VaultCommitPhase.COMMITTING
    assert not control.try_abort()
    release.set()
    worker.join(5)
    assert not worker.is_alive()
    assert result == [VaultCommitOutcome.TARGET_VERIFIED]
    assert control.phase is VaultCommitPhase.FINISHED
    assert vault.read_snapshot() == updated


def test_vault_create_and_replace_round_trip_and_ciphertext_hides_keys(
    tmp_path: Path,
) -> None:
    vault = _vault(tmp_path)
    first = VaultSnapshot(profiles=(_credential(),))
    vault.commit_snapshot(first)
    assert vault.path.name == "credentials.dpapi"
    assert vault.read_snapshot() == first
    stored = vault.path.read_bytes()
    assert first.profiles[0].app_key.encode() not in stored
    assert first.profiles[0].secret_key.encode() not in stored
    assert set(json.loads(stored)) == {"ciphertext", "schemaVersion"}

    updated_profile = _credential(
        profile_id=first.profiles[0].profile_id,
        label="갱신 프로필",
        environment="real",
        app_key="UPDATED_APP_CANARY",
        secret_key="UPDATED_SECRET_CANARY",
        revision=2,
    )
    updated = VaultSnapshot(profiles=(updated_profile,))
    outcome = vault.commit_snapshot_bounded(
        updated, VaultCommitControl(deadline=module.math.inf)
    )
    assert outcome is VaultCommitOutcome.TARGET_VERIFIED
    assert vault.read_snapshot() == updated
    assert not list(vault.data_dir.glob("*.bak"))
    assert not list(vault.data_dir.glob("*.tmp"))


def test_commit_uses_move_for_create_and_replace_with_backup_for_update(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    vault = _vault(tmp_path)
    moved: list[tuple[Path, Path]] = []
    replaced: list[tuple[Path, Path, Path | None]] = []
    real_move = module._move_first
    real_replace = module._replace_file

    def capture_move(source: Path, target: Path) -> None:
        moved.append((source, target))
        real_move(source, target)

    def capture_replace(target: Path, replacement: Path, backup: Path | None) -> None:
        replaced.append((target, replacement, backup))
        real_replace(target, replacement, backup)

    monkeypatch.setattr(module, "_move_first", capture_move)
    monkeypatch.setattr(module, "_replace_file", capture_replace)
    first = VaultSnapshot(profiles=(_credential(),))
    vault.commit_snapshot(first)
    vault.commit_snapshot(
        VaultSnapshot(profiles=(_credential(profile_id=first.profiles[0].profile_id),))
    )
    assert len(moved) == 1
    assert len(replaced) == 1
    assert replaced[0][2] is not None
    assert module.REPLACEFILE_FLAGS == 0


def test_postpublication_failure_reports_verified_target(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    vault = _vault(tmp_path)
    original = VaultSnapshot(profiles=(_credential(),))
    vault.commit_snapshot(original)
    calls = 0
    real_flush_directory = module._flush_directory_advisory

    def fail_once(path: Path) -> None:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise FinancialVaultError("INJECTED_FAILURE")
        real_flush_directory(path)

    monkeypatch.setattr(module, "_flush_directory_advisory", fail_once)
    updated = VaultSnapshot(
        profiles=(
            _credential(
                profile_id=original.profiles[0].profile_id,
                app_key="REPLACEMENT_APP_CANARY",
                secret_key="REPLACEMENT_SECRET_CANARY",
                revision=2,
            ),
        )
    )
    outcome = vault.commit_snapshot_bounded(
        updated, VaultCommitControl(deadline=module.math.inf)
    )
    assert outcome is VaultCommitOutcome.TARGET_VERIFIED
    assert vault.read_snapshot() == updated
    assert not vault.pending_path.exists()


def test_rollback_replace_failure_preserves_backup_and_blocks_reads(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    vault = _vault(tmp_path)
    original = VaultSnapshot(profiles=(_credential(),))
    vault.commit_snapshot(original)
    real_replace = module._replace_file
    replace_calls = 0
    flush_calls = 0
    real_flush = module._flush_directory_advisory

    def replace_then_fail_rollback(
        target: Path, replacement: Path, backup: Path | None
    ) -> None:
        nonlocal replace_calls
        replace_calls += 1
        if replace_calls == 2:
            raise FinancialVaultError("INJECTED_ROLLBACK_FAILURE")
        real_replace(target, replacement, backup)
        target.write_bytes(b"corrupt-target")

    def fail_postcheck(path: Path) -> bool:
        nonlocal flush_calls
        flush_calls += 1
        return real_flush(path)

    monkeypatch.setattr(module, "_replace_file", replace_then_fail_rollback)
    monkeypatch.setattr(module, "_flush_directory_advisory", fail_postcheck)
    outcome = vault.commit_snapshot_bounded(
        VaultSnapshot(
            profiles=(
                _credential(
                    profile_id=original.profiles[0].profile_id,
                    revision=2,
                ),
            )
        ),
        VaultCommitControl(deadline=module.math.inf),
    )
    assert outcome is VaultCommitOutcome.STATE_UNCERTAIN
    assert vault.pending_path.exists()
    assert len(list(vault.data_dir.glob("*.bak"))) == 1
    assert len(list(vault.data_dir.glob("*.restore"))) == 1
    with pytest.raises(FinancialVaultError, match="VAULT_RECOVERY_REQUIRED"):
        vault.read_snapshot()


def test_final_advisory_flush_failure_retries_verified_target_finalization(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    vault = _vault(tmp_path)
    original = VaultSnapshot(profiles=(_credential(),))
    vault.commit_snapshot(original)
    real_replace = module._replace_file
    real_flush = module._flush_directory_advisory
    replace_calls = 0
    flush_calls = 0

    def fail_rollback_replace(
        target: Path, replacement: Path, backup: Path | None
    ) -> None:
        nonlocal replace_calls
        replace_calls += 1
        if replace_calls == 2:
            raise FinancialVaultError("INJECTED_ROLLBACK_FAILURE")
        real_replace(target, replacement, backup)

    def fail_third_flush(path: Path) -> bool:
        nonlocal flush_calls
        flush_calls += 1
        if flush_calls == 3:
            raise FinancialVaultError("INJECTED_FINAL_FLUSH_FAILURE")
        return real_flush(path)

    monkeypatch.setattr(module, "_replace_file", fail_rollback_replace)
    monkeypatch.setattr(module, "_flush_directory_advisory", fail_third_flush)
    updated = VaultSnapshot(
        profiles=(
            _credential(
                profile_id=original.profiles[0].profile_id,
                revision=2,
            ),
        )
    )
    outcome = vault.commit_snapshot_bounded(
        updated, VaultCommitControl(deadline=module.math.inf)
    )
    assert outcome is VaultCommitOutcome.TARGET_VERIFIED
    assert vault.read_snapshot() == updated
    assert not vault.pending_path.exists()
    assert not list(vault.data_dir.glob("*.bak"))


def test_bounded_commit_returns_prior_verified_after_corrupt_publication(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    vault = _vault(tmp_path)
    original = VaultSnapshot(profiles=(_credential(),))
    vault.commit_snapshot(original)
    real_replace = module._replace_file
    replace_calls = 0

    def corrupt_after_publish(
        target: Path, replacement: Path, backup: Path | None
    ) -> None:
        nonlocal replace_calls
        replace_calls += 1
        real_replace(target, replacement, backup)
        if replace_calls == 1:
            target.write_bytes(b"corrupt-target")
            raise FinancialVaultError("INJECTED_POSTPUBLICATION_FAILURE")

    monkeypatch.setattr(module, "_replace_file", corrupt_after_publish)
    updated = VaultSnapshot(
        profiles=(
            _credential(profile_id=original.profiles[0].profile_id, revision=2),
        )
    )
    outcome = vault.commit_snapshot_bounded(
        updated, VaultCommitControl(deadline=module.math.inf)
    )
    assert outcome is VaultCommitOutcome.PRIOR_VERIFIED
    assert vault.read_snapshot() == original
    assert not vault.pending_path.exists()
    assert not list(vault.data_dir.glob("*.bak"))


@pytest.mark.parametrize(
    "postcheck", ["physical_path", "acl_verify", "file_flush", "snapshot_verify"]
)
def test_every_postcheck_failure_restores_verified_old_record(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, postcheck: str
) -> None:
    vault = _vault(tmp_path)
    original = VaultSnapshot(profiles=(_credential(),))
    vault.commit_snapshot(original)
    if postcheck == "physical_path":
        real_validate_path = module._validate_physical_path
        target_checks = 0

        def fail_physical(path: Path, *, may_not_exist: bool = False) -> None:
            nonlocal target_checks
            if path == vault.path:
                target_checks += 1
                if target_checks == 3:
                    raise FinancialVaultError("INJECTED_POSTCHECK_FAILURE")
            real_validate_path(path, may_not_exist=may_not_exist)

        monkeypatch.setattr(module, "_validate_physical_path", fail_physical)
    elif postcheck == "acl_verify":
        real_acl = module._set_and_verify_acl_handle
        target_checks = 0

        def fail_acl(
            handle: int,
            *,
            apply: bool = True,
            expected_path: Path | None = None,
        ) -> None:
            nonlocal target_checks
            if expected_path == vault.path and not apply:
                target_checks += 1
                if target_checks == 2:
                    raise FinancialVaultError("INJECTED_POSTCHECK_FAILURE")
            real_acl(handle, apply=apply, expected_path=expected_path)

        monkeypatch.setattr(module, "_set_and_verify_acl_handle", fail_acl)
    elif postcheck == "file_flush":
        real_flush_file = module._flush_file
        failed = False

        def fail_target(path: Path) -> None:
            nonlocal failed
            if path == vault.path and not failed:
                failed = True
                raise FinancialVaultError("INJECTED_POSTCHECK_FAILURE")
            real_flush_file(path)

        monkeypatch.setattr(module, "_flush_file", fail_target)
    else:
        real_decode = vault._snapshot_from_encrypted

        def fail_verify(_payload: bytes) -> VaultSnapshot:
            raise FinancialVaultError("INJECTED_POSTCHECK_FAILURE")

        monkeypatch.setattr(vault, "_snapshot_from_encrypted", fail_verify)

    updated = VaultSnapshot(
        profiles=(
            _credential(
                profile_id=original.profiles[0].profile_id,
                revision=2,
            ),
        )
    )
    if postcheck == "snapshot_verify":
        with pytest.raises(FinancialVaultError, match="INJECTED_POSTCHECK_FAILURE"):
            vault.commit_snapshot(updated)
        monkeypatch.setattr(vault, "_snapshot_from_encrypted", real_decode)
        assert vault.read_snapshot() == original
    else:
        vault.commit_snapshot(updated)
        assert vault.read_snapshot() == updated
    assert not vault.pending_path.exists()
    assert not list(vault.data_dir.glob("*.bak"))


def test_replace_failure_retains_old_encrypted_record(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    vault = _vault(tmp_path)
    original = VaultSnapshot(profiles=(_credential(),))
    vault.commit_snapshot(original)

    def fail_replace(_target: Path, _replacement: Path, _backup: Path | None) -> None:
        raise FinancialVaultError("INJECTED_FAILURE")

    monkeypatch.setattr(module, "_replace_file", fail_replace)
    with pytest.raises(FinancialVaultError, match="INJECTED_FAILURE"):
        vault.commit_snapshot(
            VaultSnapshot(
                profiles=(
                    _credential(
                        profile_id=original.profiles[0].profile_id,
                        revision=2,
                    ),
                )
            )
        )
    assert vault.read_snapshot() == original


def test_first_create_partial_move_error_reports_verified_target(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    vault = _vault(tmp_path)
    real_move = module._move_first

    def move_then_fail(source: Path, target: Path) -> None:
        real_move(source, target)
        raise FinancialVaultError("INJECTED_FAILURE")

    monkeypatch.setattr(module, "_move_first", move_then_fail)
    snapshot = VaultSnapshot(profiles=(_credential(),))
    vault.commit_snapshot(snapshot)
    assert vault.read_snapshot() == snapshot


@pytest.mark.parametrize(
    "snapshot",
    [
        VaultSnapshot(schema_version=2),
        VaultSnapshot(profiles=tuple(_credential() for _ in range(17))),
        VaultSnapshot(profiles=(_credential(profile_id="not-a-uuid"),)),
        VaultSnapshot(profiles=(_credential(environment="paper"),)),
        VaultSnapshot(profiles=(_credential(app_key=""),)),
        VaultSnapshot(profiles=(_credential(revision=0),)),
    ],
)
def test_invalid_snapshots_fail_with_constant_error(
    tmp_path: Path, snapshot: VaultSnapshot
) -> None:
    with pytest.raises(FinancialVaultError) as caught:
        _vault(tmp_path).commit_snapshot(snapshot)
    assert caught.value.code == "VAULT_RECORD_INVALID"
    assert "CANARY" not in repr(caught.value)


def test_duplicate_profile_id_is_rejected(tmp_path: Path) -> None:
    profile = _credential()
    duplicate = _credential(profile_id=profile.profile_id)
    with pytest.raises(FinancialVaultError, match="VAULT_RECORD_INVALID"):
        _vault(tmp_path).commit_snapshot(VaultSnapshot(profiles=(profile, duplicate)))


def test_corrupt_envelope_is_not_treated_as_empty_vault(tmp_path: Path) -> None:
    vault = _vault(tmp_path)
    vault.commit_snapshot(VaultSnapshot(profiles=(_credential(),)))
    vault.path.write_bytes(b'{"schemaVersion":1,"ciphertext":"not base64"}')
    with pytest.raises(FinancialVaultError, match="VAULT_RECORD_INVALID"):
        vault.read_snapshot()


def test_corrupt_preexisting_record_fails_before_commit_gate(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    vault = _vault(tmp_path)
    original = VaultSnapshot(profiles=(_credential(),))
    vault.commit_snapshot(original)
    vault.path.write_bytes(b"corrupt-prior-but-nonempty")
    replace_calls = 0
    real_replace = module._replace_file

    def capture_replace(
        target: Path, replacement: Path, backup: Path | None
    ) -> None:
        nonlocal replace_calls
        replace_calls += 1
        real_replace(target, replacement, backup)

    monkeypatch.setattr(module, "_replace_file", capture_replace)
    control = VaultCommitControl(deadline=module.math.inf)
    with pytest.raises(FinancialVaultError, match="VAULT_RECORD_INVALID"):
        vault.commit_snapshot_bounded(
            VaultSnapshot(
                profiles=(
                    _credential(
                        profile_id=original.profiles[0].profile_id,
                        revision=2,
                    ),
                )
            ),
            control,
        )
    assert replace_calls == 0
    assert control.phase is VaultCommitPhase.FINISHED
    assert not vault.pending_path.exists()
    assert vault.path.read_bytes() == b"corrupt-prior-but-nonempty"
    with pytest.raises(FinancialVaultError, match="VAULT_RECORD_INVALID"):
        vault.read_snapshot()


def test_extra_everyone_ace_is_rejected(tmp_path: Path) -> None:
    vault = _vault(tmp_path)
    vault.commit_snapshot(VaultSnapshot(profiles=(_credential(),)))
    completed = subprocess.run(
        ["icacls", str(vault.path), "/grant", "*S-1-1-0:(R)"],
        capture_output=True,
        check=False,
    )
    assert completed.returncode == 0
    with pytest.raises(FinancialVaultError, match="VAULT_ACL_FAILED"):
        vault.read_snapshot()


def test_current_user_wrong_rights_are_rejected(tmp_path: Path) -> None:
    vault = _vault(tmp_path)
    vault.commit_snapshot(VaultSnapshot(profiles=(_credential(),)))
    sid = module._current_user_sid()
    completed = subprocess.run(
        ["icacls", str(vault.path), "/grant:r", f"*{sid}:(R)"],
        capture_output=True,
        check=False,
    )
    assert completed.returncode == 0
    with pytest.raises(FinancialVaultError, match="VAULT_ACL_FAILED"):
        vault.read_snapshot()


def test_invalid_backup_acl_does_not_downgrade_verified_target(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    vault = _vault(tmp_path)
    original = VaultSnapshot(profiles=(_credential(),))
    vault.commit_snapshot(original)
    real_replace = module._replace_file

    def broaden_backup(target: Path, replacement: Path, backup: Path | None) -> None:
        real_replace(target, replacement, backup)
        assert backup is not None
        completed = subprocess.run(
            ["icacls", str(backup), "/grant", "*S-1-1-0:(R)"],
            capture_output=True,
            check=False,
        )
        assert completed.returncode == 0

    monkeypatch.setattr(module, "_replace_file", broaden_backup)
    updated = VaultSnapshot(
        profiles=(
            _credential(
                profile_id=original.profiles[0].profile_id,
                revision=2,
            ),
        )
    )
    vault.commit_snapshot(updated)
    assert vault.read_snapshot() == updated
    assert not vault.pending_path.exists()


def test_junction_ancestor_and_post_constructor_swap_are_rejected(tmp_path: Path) -> None:
    physical = tmp_path / "physical"
    physical.mkdir()
    junction = tmp_path / "junction"
    completed = subprocess.run(
        ["cmd", "/c", "mklink", "/J", str(junction), str(physical)],
        capture_output=True,
        check=False,
    )
    assert completed.returncode == 0
    with pytest.raises(FinancialVaultError, match="VAULT_PATH_UNSAFE"):
        FinancialVault(junction / "financial-read-v1")

    stable = tmp_path / "stable"
    vault = FinancialVault(stable)
    stable.mkdir()
    os.rmdir(stable)
    completed = subprocess.run(
        ["cmd", "/c", "mklink", "/J", str(stable), str(physical)],
        capture_output=True,
        check=False,
    )
    assert completed.returncode == 0
    with pytest.raises(FinancialVaultError, match="VAULT_PATH_UNSAFE"):
        vault.read_snapshot()


def test_data_directory_swap_to_junction_before_leaf_open_fails_closed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    vault = _vault(tmp_path)
    original = VaultSnapshot(profiles=(_credential(label="original", revision=1),))
    vault.commit_snapshot(original)
    alternate = FinancialVault(tmp_path / "alternate-financial-read-v1")
    alternate.commit_snapshot(
        VaultSnapshot(profiles=(_credential(label="swapped", revision=7),))
    )
    parked = tmp_path / "parked-financial-read-v1"
    real_open = module._open_path_handle
    attempted = False
    blocked = False

    @contextmanager
    def swap_before_leaf_open(
        path: Path, *, access: int = 0, share: int = 0x00000007
    ):
        nonlocal attempted, blocked
        if path == vault.path and not attempted:
            attempted = True
            try:
                os.replace(vault.data_dir, parked)
            except OSError:
                blocked = True
            else:
                completed = subprocess.run(
                    ["cmd", "/c", "mklink", "/J", str(vault.data_dir), str(alternate.data_dir)],
                    capture_output=True,
                    check=False,
                )
                assert completed.returncode == 0
        with real_open(path, access=access, share=share) as opened:
            yield opened

    monkeypatch.setattr(module, "_open_path_handle", swap_before_leaf_open)
    try:
        result: VaultSnapshot | None = None
        caught: FinancialVaultError | None = None
        try:
            result = vault.read_snapshot()
        except FinancialVaultError as exc:
            caught = exc
        assert attempted
        if blocked:
            assert result == original
            assert caught is None
        else:
            assert result is None
            assert caught is not None
            assert caught.code == "VAULT_PATH_UNSAFE"
    finally:
        if parked.exists():
            if os.path.lexists(vault.data_dir):
                os.rmdir(vault.data_dir)
            os.replace(parked, vault.data_dir)


def test_relative_data_directory_fails_closed() -> None:
    with pytest.raises(FinancialVaultError, match="VAULT_PATH_INVALID"):
        FinancialVault(Path("relative-data-dir"))


def test_non_windows_platform_fails_closed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(module.os, "name", "posix")
    with pytest.raises(FinancialVaultError, match="VAULT_PLATFORM_UNSUPPORTED"):
        FinancialVault(tmp_path / "financial-read-v1")
