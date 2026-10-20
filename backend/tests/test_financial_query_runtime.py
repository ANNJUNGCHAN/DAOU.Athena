from __future__ import annotations

import asyncio
import threading
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

import athena_api.financial_query_runtime as query_runtime_module
from athena_api.canvas_transform import resolve_screen_render_contract
from athena_api.financial_query_runtime import (
    MAX_CANCELLATIONS_PER_JOB,
    FinancialCredentialRuntime,
    FinancialQueryError,
    FinancialQueryRuntime,
    QueryProfile,
    _CredentialRuntimeProfile,
)
from athena_api.financial_vault import FinancialCredential, VaultSnapshot
from athena_api.generated.registry import TR_REGISTRY
from athena_api.kiwoom.client import ResponseEnvelope
from athena_api.selector.catalog import build_operation_catalog


class FakeClient:
    def __init__(self, body: dict, *, wait: asyncio.Event | None = None) -> None:
        self.body = body
        self.wait = wait
        self.calls = 0

    async def post_with_headers(self, api_id, endpoint, data=None, options=None):
        assert TR_REGISTRY[api_id].kind == "query"
        assert TR_REGISTRY[api_id].upstream_path == endpoint
        self.calls += 1
        if self.wait:
            await self.wait.wait()
        return ResponseEnvelope(body=self.body, cont_yn="N", next_key=None)


class CodedError(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class ErrorClient(FakeClient):
    def __init__(self, code: str) -> None:
        super().__init__({})
        self.code = code

    async def post_with_headers(self, api_id, endpoint, data=None, options=None):
        raise CodedError(self.code)


async def _terminal(runtime: FinancialQueryRuntime, job_id: str) -> dict:
    for _ in range(100):
        snapshot = await runtime.status(job_id)
        if snapshot["state"] in {"completed", "failed", "cancelled"}:
            return snapshot
        await asyncio.sleep(0.01)
    raise AssertionError("job did not become terminal")


def test_full_query_catalog_has_exact_read_route_and_render_family() -> None:
    catalog = build_operation_catalog()
    counts = {"facts": 0, "table": 0, "compound": 0, "chart": 0}
    for document in catalog.documents:
        if document.kind != "query" or not document.generic_callable:
            continue
        spec = TR_REGISTRY[document.tr_id]
        assert spec.kind == "query"
        assert spec.upstream_path.startswith("/api/")
        resolved = resolve_screen_render_contract(document.operation_ref)
        assert not isinstance(resolved, str), document.operation_ref
        counts[resolved[0]] += 1
    assert counts == {"facts": 114, "table": 114, "compound": 17, "chart": 19}


@pytest.mark.asyncio
async def test_signed_query_executes_once_and_duplicate_submission_replays_snapshot() -> None:
    catalog = build_operation_catalog()
    profile_id = str(uuid4())
    client = FakeClient({"acctNo": "synthetic"})
    runtime = FinancialQueryRuntime(
        catalog,
        lambda requested: QueryProfile(requested, "mock", client),
        signing_secret=b"test-financial-query-secret",
    )
    submission_id = str(uuid4())
    first = await runtime.start(
        submission_id=submission_id,
        profile_id=profile_id,
        operation_ref="base:ka00001",
        arguments={},
    )
    terminal = await _terminal(runtime, first["jobId"])
    assert terminal["state"] == "completed"
    assert terminal["card"]["renderKind"] == "facts"
    duplicate = await runtime.start(
        submission_id=submission_id,
        profile_id=profile_id,
        operation_ref="base:ka00001",
        arguments={},
    )
    assert duplicate == terminal
    assert client.calls == 1
    with pytest.raises(FinancialQueryError, match="IDEMPOTENCY_CONFLICT"):
        await runtime.start(
            submission_id=submission_id,
            profile_id=profile_id,
            operation_ref="base:ka00001",
            arguments={"extra": "rejected"},
        )
    await runtime.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("operation_ref", "arguments", "body", "kind"),
    [
        ("base:ka00001", {}, {"acctNo": "synthetic"}, "facts"),
        (
            "base:ka00198",
            {"qry_tp": "1"},
            {"item_inq_rank": [{"stk_nm": "테스트", "bigd_rank": "1"}]},
            "table",
        ),
        (
            "base:ka01300",
            {},
            {"rtcd": "0", "nofi": [{"gcod": "A", "name": "테스트"}]},
            "compound",
        ),
        (
            "base:ka10079",
            {"stk_cd": "000000", "tic_scope": "1", "upd_stkpc_tp": "0"},
            {
                "stk_cd": "000000",
                "last_tic_cnt": "1",
                "stk_tic_chart_qry": [
                    {
                        "cur_prc": "100",
                        "trde_qty": "10",
                        "cntr_tm": "20261019120000",
                        "open_pric": "90",
                        "high_pric": "110",
                        "low_pric": "80",
                    }
                ],
            },
            "chart",
        ),
    ],
)
async def test_signed_selector_to_public_card_covers_every_render_family(
    operation_ref: str, arguments: dict, body: dict, kind: str
) -> None:
    catalog = build_operation_catalog()
    client = FakeClient(body)
    runtime = FinancialQueryRuntime(
        catalog,
        lambda requested: QueryProfile(requested, "mock", client),
        signing_secret=b"test-financial-query-secret",
    )
    started = await runtime.start(
        submission_id=str(uuid4()),
        profile_id=str(uuid4()),
        operation_ref=operation_ref,
        arguments=arguments,
    )
    terminal = await _terminal(runtime, started["jobId"])
    assert terminal["state"] == "completed"
    assert terminal["card"]["renderKind"] == kind
    assert terminal["card"]["data"]["kind"] == kind
    assert client.calls == 1
    await runtime.aclose()


@pytest.mark.asyncio
async def test_running_job_cancel_is_idempotent_and_discards_late_result() -> None:
    catalog = build_operation_catalog()
    gate = asyncio.Event()
    client = FakeClient({"acctNo": "synthetic"}, wait=gate)
    runtime = FinancialQueryRuntime(
        catalog,
        lambda requested: QueryProfile(requested, "mock", client),
        signing_secret=b"test-financial-query-secret",
    )
    started = await runtime.start(
        submission_id=str(uuid4()),
        profile_id=str(uuid4()),
        operation_ref="base:ka00001",
        arguments={},
    )
    for _ in range(100):
        if (await runtime.status(started["jobId"]))["state"] == "running":
            break
        await asyncio.sleep(0.01)
    cancellation_id = str(uuid4())
    first = await runtime.cancel(job_id=started["jobId"], cancellation_id=cancellation_id)
    second = await runtime.cancel(job_id=started["jobId"], cancellation_id=cancellation_id)
    assert first == second
    assert first["accepted"] is True
    terminal = await _terminal(runtime, started["jobId"])
    assert terminal["state"] == "cancelled"
    assert terminal["errorCode"] == "QUERY_CANCELLED"
    gate.set()
    await runtime.aclose()


@pytest.mark.asyncio
async def test_cancellation_id_cache_is_bounded_minimal_and_removed_with_expired_job() -> None:
    now = [datetime(2026, 10, 19, tzinfo=UTC)]
    runtime = FinancialQueryRuntime(
        build_operation_catalog(),
        lambda requested: QueryProfile(requested, "mock", FakeClient({"value": "ok"})),
        signing_secret=b"test-financial-query-secret",
        now=lambda: now[0],
    )
    started = await runtime.start(
        submission_id=str(uuid4()),
        profile_id=str(uuid4()),
        operation_ref="base:ka00001",
        arguments={},
    )
    await _terminal(runtime, started["jobId"])
    for _ in range(100):
        result = await runtime.cancel(
            job_id=started["jobId"], cancellation_id=str(uuid4())
        )
        assert result["accepted"] is False
    assert len(runtime._cancellations) == 100
    assert len(runtime._cancellations) <= MAX_CANCELLATIONS_PER_JOB
    assert all(isinstance(value[1], bool) for value in runtime._cancellations.values())

    now[0] += timedelta(seconds=301)
    with pytest.raises(FinancialQueryError, match="QUERY_JOB_NOT_FOUND"):
        await runtime.status(started["jobId"])
    assert not runtime._cancellations
    assert not runtime._job_cancellations


@pytest.mark.asyncio
async def test_cancellation_ids_are_not_evicted_before_the_linked_job_expires() -> None:
    runtime = FinancialQueryRuntime(
        build_operation_catalog(),
        lambda requested: QueryProfile(requested, "mock", FakeClient({"value": "ok"})),
        signing_secret=b"test-financial-query-secret",
    )
    first = await runtime.start(
        submission_id=str(uuid4()),
        profile_id=str(uuid4()),
        operation_ref="base:ka00001",
        arguments={},
    )
    second = await runtime.start(
        submission_id=str(uuid4()),
        profile_id=str(uuid4()),
        operation_ref="base:ka00001",
        arguments={},
    )
    await _terminal(runtime, first["jobId"])
    await _terminal(runtime, second["jobId"])

    retained_id = str(uuid4())
    retained = await runtime.cancel(
        job_id=first["jobId"], cancellation_id=retained_id
    )
    for _ in range(MAX_CANCELLATIONS_PER_JOB - 1):
        await runtime.cancel(
            job_id=first["jobId"], cancellation_id=str(uuid4())
        )

    with pytest.raises(FinancialQueryError, match="BUSY"):
        await runtime.cancel(
            job_id=first["jobId"], cancellation_id=str(uuid4())
        )
    assert (
        await runtime.cancel(job_id=first["jobId"], cancellation_id=retained_id)
    ) == retained
    with pytest.raises(FinancialQueryError, match="IDEMPOTENCY_CONFLICT"):
        await runtime.cancel(job_id=second["jobId"], cancellation_id=retained_id)
    assert len(runtime._cancellations) == MAX_CANCELLATIONS_PER_JOB
    await runtime.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("source_code", "published_code"),
    [
        ("QUERY_DEADLINE_EXCEEDED", "OPERATION_TIMEOUT"),
        ("NETWORK_UNAVAILABLE", "NETWORK_UNAVAILABLE"),
        ("UPSTREAM_RESPONSE_TOO_LARGE", "QUERY_RESULT_TOO_LARGE"),
    ],
)
async def test_query_transport_error_semantics_are_preserved(
    source_code: str, published_code: str
) -> None:
    runtime = FinancialQueryRuntime(
        build_operation_catalog(),
        lambda requested: QueryProfile(requested, "mock", ErrorClient(source_code)),
        signing_secret=b"test-financial-query-secret",
    )
    started = await runtime.start(
        submission_id=str(uuid4()),
        profile_id=str(uuid4()),
        operation_ref="base:ka00001",
        arguments={},
    )
    terminal = await _terminal(runtime, started["jobId"])
    assert terminal["state"] == "failed"
    assert terminal["errorCode"] == published_code


class FakeVault:
    def __init__(self, snapshot: VaultSnapshot) -> None:
        self.snapshot = snapshot

    def read_snapshot(self) -> VaultSnapshot:
        return self.snapshot

    def commit_snapshot(self, snapshot: VaultSnapshot) -> None:
        self.snapshot = snapshot

    def commit_snapshot_bounded(self, snapshot: VaultSnapshot, control):
        from athena_api.financial_vault import VaultCommitOutcome

        assert control.try_begin_commit()
        self.snapshot = snapshot
        control.finish()
        return VaultCommitOutcome.TARGET_VERIFIED


class BlockingVault(FakeVault):
    def __init__(self, snapshot: VaultSnapshot, *, admit_commit: bool) -> None:
        super().__init__(snapshot)
        self.admit_commit = admit_commit
        self.started = threading.Event()
        self.admitted = threading.Event()
        self.proceed = threading.Event()

    def commit_snapshot_bounded(self, snapshot: VaultSnapshot, control):
        from athena_api.financial_vault import VaultCommitOutcome

        self.started.set()
        if self.admit_commit:
            assert control.try_begin_commit()
            self.admitted.set()
        assert self.proceed.wait(5)
        if not self.admit_commit and not control.try_begin_commit():
            control.finish()
            return VaultCommitOutcome.ABORTED_BEFORE_COMMIT
        self.snapshot = snapshot
        control.finish()
        return VaultCommitOutcome.TARGET_VERIFIED


class OutcomeVault(FakeVault):
    def __init__(self, snapshot: VaultSnapshot, outcome) -> None:
        super().__init__(snapshot)
        self.outcome = outcome

    def commit_snapshot_bounded(self, snapshot: VaultSnapshot, control):
        assert control.try_begin_commit()
        if self.outcome.value == "target_verified":
            self.snapshot = snapshot
        control.finish()
        return self.outcome


class FakeAuth:
    expires_at = datetime(2026, 10, 20, tzinfo=UTC)

    def __init__(self, **kwargs) -> None:
        pass

    async def ensure_token(self) -> str:
        return "token"


class FailingCleanupClient:
    async def aclose(self) -> None:
        raise RuntimeError("cleanup failure")


class FailingReleaseLock:
    def release(self) -> None:
        raise RuntimeError("release failure")


async def _mutation_terminal(runtime: FinancialCredentialRuntime, mutation_id: str) -> dict:
    for _ in range(100):
        mutation = (await runtime.status(mutation_id))["mutation"]
        if mutation["state"] in {"succeeded", "failed"}:
            return mutation
        await asyncio.sleep(0.01)
    raise AssertionError("mutation did not become terminal")


def _credential_runtime() -> tuple[FinancialCredentialRuntime, FakeVault, FinancialCredential]:
    credential = FinancialCredential(
        profile_id=str(uuid4()),
        label="test",
        environment="mock",
        app_key="app",
        secret_key="secret",
        revision=1,
    )
    vault = FakeVault(VaultSnapshot(profiles=()))
    runtime = FinancialCredentialRuntime(
        vault,
        build_operation_catalog(),
        auth_factory=FakeAuth,
        client_factory=lambda **kwargs: FailingCleanupClient(),
    )
    runtime._profiles[credential.profile_id] = _CredentialRuntimeProfile(
        credential=credential,
        client=FailingCleanupClient(),
        state="ready",
        reason_code=None,
        process_lock=FailingReleaseLock(),
    )
    return runtime, vault, credential


def _configure_payload(credential: FinancialCredential, mutation_id: str) -> dict:
    return {
        "mutationId": mutation_id,
        "profileId": credential.profile_id,
        "expectedRevision": 1,
        "label": credential.label,
        "environment": credential.environment,
        "appKey": credential.app_key,
        "secretKey": credential.secret_key,
    }


@pytest.mark.asyncio
async def test_post_commit_cleanup_failure_cannot_reverse_configure_success() -> None:
    runtime, vault, credential = _credential_runtime()
    mutation_id = str(uuid4())
    await runtime.configure(_configure_payload(credential, mutation_id))
    mutation = await _mutation_terminal(runtime, mutation_id)
    assert mutation["state"] == "succeeded"
    assert vault.snapshot.profiles[0].revision == 2
    assert runtime._profiles[credential.profile_id].credential.revision == 2


@pytest.mark.asyncio
async def test_post_commit_cleanup_failure_cannot_reverse_delete_success() -> None:
    runtime, vault, credential = _credential_runtime()
    vault.snapshot = VaultSnapshot(profiles=(credential,))
    mutation_id = str(uuid4())
    await runtime.delete(
        {
            "mutationId": mutation_id,
            "profileId": credential.profile_id,
            "expectedRevision": 1,
        }
    )
    mutation = await _mutation_terminal(runtime, mutation_id)
    assert mutation["state"] == "succeeded"
    assert vault.snapshot.profiles == ()
    assert credential.profile_id not in runtime._profiles


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("state", "reason_code", "deleting", "published_code"),
    [
        ("locked", "LOCK_CONFLICT", False, "LOCK_CONFLICT"),
        ("refreshing", "TOKEN_REFRESHING", False, "TOKEN_REFRESHING"),
        ("error", "NETWORK_UNAVAILABLE", False, "NETWORK_UNAVAILABLE"),
        ("ready", None, True, "DELETING"),
    ],
)
async def test_profile_unavailability_keeps_specific_public_reason(
    state: str, reason_code: str | None, deleting: bool, published_code: str
) -> None:
    runtime, _, credential = _credential_runtime()
    profile = runtime._profiles[credential.profile_id]
    profile.state = state
    profile.reason_code = reason_code
    profile.deleting = deleting
    with pytest.raises(FinancialQueryError, match=published_code):
        await runtime.get_query_profile(credential.profile_id)


@pytest.mark.asyncio
async def test_refresh_preserves_network_failure_instead_of_relabeling_token_rejection(
    monkeypatch,
) -> None:
    runtime, _, credential = _credential_runtime()

    async def fail_refresh(*args, **kwargs):
        raise CodedError("NETWORK_UNAVAILABLE")

    monkeypatch.setattr(runtime, "_build_runtime", fail_refresh)
    await runtime._refresh(credential.profile_id)

    profile = runtime._profiles[credential.profile_id]
    assert profile.state == "error"
    assert profile.reason_code == "NETWORK_UNAVAILABLE"


@pytest.mark.asyncio
async def test_precommit_timeout_never_allows_late_publication_and_holds_busy_until_cleanup(
    monkeypatch,
) -> None:
    monkeypatch.setattr(query_runtime_module, "CREDENTIAL_RUN_SECONDS", 0.02)
    runtime, _, credential = _credential_runtime()
    vault = BlockingVault(VaultSnapshot(profiles=(credential,)), admit_commit=False)
    runtime.vault = vault
    mutation_id = str(uuid4())
    await runtime.configure(_configure_payload(credential, mutation_id))
    assert await asyncio.to_thread(vault.started.wait, 2)

    mutation = await _mutation_terminal(runtime, mutation_id)
    assert mutation["state"] == "failed"
    assert mutation["errorCode"] == "OPERATION_TIMEOUT"
    with pytest.raises(FinancialQueryError, match="BUSY"):
        await runtime.configure(_configure_payload(credential, str(uuid4())))
    replay = await runtime.configure(_configure_payload(credential, mutation_id))
    assert replay["mutation"] == mutation

    vault.proceed.set()
    for _ in range(100):
        if not runtime._cleanup_pending:
            break
        await asyncio.sleep(0.01)
    assert vault.snapshot.profiles == (credential,)
    assert (await runtime.status(mutation_id))["mutation"] == mutation
    await runtime.aclose()


@pytest.mark.asyncio
async def test_commit_admitted_before_deadline_stays_running_past_deadline_then_succeeds(
    monkeypatch,
) -> None:
    monkeypatch.setattr(query_runtime_module, "CREDENTIAL_RUN_SECONDS", 0.02)
    runtime, _, credential = _credential_runtime()
    vault = BlockingVault(VaultSnapshot(profiles=(credential,)), admit_commit=True)
    runtime.vault = vault
    mutation_id = str(uuid4())
    await runtime.configure(_configure_payload(credential, mutation_id))
    assert await asyncio.to_thread(vault.admitted.wait, 2)
    await asyncio.sleep(0.04)
    assert (await runtime.status(mutation_id))["mutation"]["state"] == "running"

    vault.proceed.set()
    mutation = await _mutation_terminal(runtime, mutation_id)
    assert mutation["state"] == "succeeded"
    assert vault.snapshot.profiles[0].revision == 2
    await runtime.aclose()


@pytest.mark.asyncio
async def test_state_uncertain_remains_nonterminal_and_makes_runtime_unavailable() -> None:
    from athena_api.financial_vault import VaultCommitOutcome

    runtime, _, credential = _credential_runtime()
    runtime.vault = OutcomeVault(
        VaultSnapshot(profiles=(credential,)), VaultCommitOutcome.STATE_UNCERTAIN
    )
    mutation_id = str(uuid4())
    await runtime.configure(_configure_payload(credential, mutation_id))
    for _ in range(100):
        if runtime._fatal_vault_unavailable:
            break
        await asyncio.sleep(0.01)
    assert runtime._mutations[mutation_id].state == "running"
    with pytest.raises(FinancialQueryError, match="CREDENTIAL_MUTATION_NOT_FOUND"):
        await runtime.status(mutation_id)
    with pytest.raises(FinancialQueryError, match="VAULT_UNAVAILABLE"):
        await runtime.status()
    with pytest.raises(FinancialQueryError, match="VAULT_UNAVAILABLE"):
        await runtime.get_query_profile(credential.profile_id)
    with pytest.raises(FinancialQueryError, match="VAULT_UNAVAILABLE"):
        await runtime.configure(_configure_payload(credential, mutation_id))
    await runtime.aclose()


@pytest.mark.asyncio
async def test_prior_verified_keeps_prior_profile_and_reports_vault_unavailable() -> None:
    from athena_api.financial_vault import VaultCommitOutcome

    runtime, _, credential = _credential_runtime()
    runtime.vault = OutcomeVault(
        VaultSnapshot(profiles=(credential,)), VaultCommitOutcome.PRIOR_VERIFIED
    )
    mutation_id = str(uuid4())
    await runtime.configure(_configure_payload(credential, mutation_id))
    mutation = await _mutation_terminal(runtime, mutation_id)
    assert mutation["state"] == "failed"
    assert mutation["errorCode"] == "VAULT_UNAVAILABLE"
    assert runtime._profiles[credential.profile_id].credential == credential
    assert runtime.vault.snapshot.profiles == (credential,)
    await runtime.aclose()


@pytest.mark.asyncio
async def test_delete_precommit_timeout_retains_prior_profile_and_lock(monkeypatch) -> None:
    monkeypatch.setattr(query_runtime_module, "CREDENTIAL_RUN_SECONDS", 0.02)
    runtime, _, credential = _credential_runtime()
    prior_lock = runtime._profiles[credential.profile_id].process_lock
    vault = BlockingVault(VaultSnapshot(profiles=(credential,)), admit_commit=False)
    runtime.vault = vault
    mutation_id = str(uuid4())
    await runtime.delete(
        {
            "mutationId": mutation_id,
            "profileId": credential.profile_id,
            "expectedRevision": 1,
        }
    )
    assert await asyncio.to_thread(vault.started.wait, 2)
    mutation = await _mutation_terminal(runtime, mutation_id)
    assert mutation["errorCode"] == "OPERATION_TIMEOUT"
    vault.proceed.set()
    for _ in range(100):
        if not runtime._cleanup_pending:
            break
        await asyncio.sleep(0.01)
    retained = runtime._profiles[credential.profile_id]
    assert retained.credential == credential
    assert retained.process_lock is prior_lock
    assert retained.deleting is False
    await runtime.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("admit_commit", [False, True])
async def test_shutdown_aborts_preparing_but_waits_for_committing_vault_work(
    monkeypatch, admit_commit: bool
) -> None:
    monkeypatch.setattr(query_runtime_module, "CREDENTIAL_RUN_SECONDS", 1.0)
    runtime, _, credential = _credential_runtime()
    vault = BlockingVault(
        VaultSnapshot(profiles=(credential,)), admit_commit=admit_commit
    )
    runtime.vault = vault
    mutation_id = str(uuid4())
    await runtime.configure(_configure_payload(credential, mutation_id))
    expected = vault.admitted if admit_commit else vault.started
    assert await asyncio.to_thread(expected.wait, 2)

    closing = asyncio.create_task(runtime.aclose())
    await asyncio.sleep(0.02)
    assert not closing.done()
    vault.proceed.set()
    await asyncio.wait_for(closing, timeout=2)

    mutation = runtime._mutations[mutation_id]
    if admit_commit:
        assert mutation.state == "succeeded"
    else:
        assert mutation.state == "failed"
        assert mutation.error_code == "OPERATION_TIMEOUT"


@pytest.mark.asyncio
async def test_shutdown_cancels_preparing_network_work_without_waiting_for_transport() -> None:
    started = asyncio.Event()
    cancelled = asyncio.Event()

    class BlockingAuth:
        expires_at = datetime(2026, 10, 20, tzinfo=UTC)

        def __init__(self, **kwargs) -> None:
            pass

        async def ensure_token(self) -> str:
            started.set()
            try:
                await asyncio.Future()
            except asyncio.CancelledError:
                cancelled.set()
                raise

    runtime, _, credential = _credential_runtime()
    runtime._auth_factory = BlockingAuth
    mutation_id = str(uuid4())
    await runtime.configure(_configure_payload(credential, mutation_id))
    await asyncio.wait_for(started.wait(), timeout=1)

    await asyncio.wait_for(runtime.aclose(), timeout=1)

    assert cancelled.is_set()
    assert not runtime._tasks
