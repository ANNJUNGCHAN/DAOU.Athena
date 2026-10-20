"""In-memory, query-only runtime for the WTS financial child."""

from __future__ import annotations

import asyncio
import copy
import hashlib
import inspect
import secrets
import time
from collections import OrderedDict
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from fastapi import Request, Response
from pydantic import ValidationError

from athena_api.financial_cards import (
    PAGE_MAX_BYTES,
    RESULT_MAX_BYTES,
    CardBuild,
    FinancialCardError,
    arguments_digest,
    build_financial_card_pages,
    canonical_bytes,
    opaque_token,
    utc_now,
    utc_text,
)
from athena_api.generated.registry import TR_REGISTRY
from athena_api.selector.catalog import OperationCatalog
from athena_api.selector.errors import SelectorError
from athena_api.selector.plans import PlanSigner
from athena_api.selector.schemas import CallRequest, DiscoveryIntent, ResolveRequest
from athena_api.selector.service import SelectorService

MAX_JOBS = 16
QUERY_QUEUE_SECONDS = 30
QUERY_RUN_SECONDS = 30
QUERY_TTL_SECONDS = 300
CREDENTIAL_RUN_SECONDS = 20
MAX_CANCELLATIONS_PER_JOB = 128
MAX_CANCELLATIONS_GLOBAL = 2048

_PUBLIC_CODE = {
    "CREDENTIAL_PROFILE_NOT_FOUND": "RESOURCE_NOT_FOUND",
    "CREDENTIAL_PROFILE_NOT_READY": "TOKEN_REFRESHING",
    "CREDENTIAL_REVISION_CONFLICT": "STATE_CONFLICT",
    "CREDENTIAL_RUNTIME_BUSY": "BUSY",
    "CREDENTIAL_TIMEOUT": "OPERATION_TIMEOUT",
    "CREDENTIAL_CONFIGURATION_FAILED": "TOKEN_REJECTED",
    "CREDENTIAL_DELETE_FAILED": "VAULT_UNAVAILABLE",
    "QUERY_RUNTIME_BUSY": "BUSY",
    "QUERY_OPERATION_NOT_ALLOWED": "REQUEST_INVALID",
    "QUERY_ARGUMENTS_INVALID": "REQUEST_INVALID",
    "QUERY_RENDER_UNSUPPORTED": "REQUEST_INVALID",
    "QUERY_PAGE_NOT_FOUND": "RESOURCE_NOT_FOUND",
    "CONTINUATION_NOT_FOUND": "RESOURCE_NOT_FOUND",
    "QUERY_TIMEOUT": "OPERATION_TIMEOUT",
    "QUERY_REJECTED": "REQUEST_INVALID",
    "QUERY_UPSTREAM_UNAVAILABLE": "UPSTREAM_UNAVAILABLE",
}


def public_code(code: str) -> str:
    return _PUBLIC_CODE.get(code, code)


def _query_exception_code(exc: BaseException) -> str:
    code = getattr(exc, "code", None)
    if code == "QUERY_DEADLINE_EXCEEDED":
        return "OPERATION_TIMEOUT"
    if code == "NETWORK_UNAVAILABLE":
        return "NETWORK_UNAVAILABLE"
    if code == "UPSTREAM_RESPONSE_TOO_LARGE":
        return "QUERY_RESULT_TOO_LARGE"
    if code in {"REQUEST_INVALID", "READ_ROUTE_INVALID", "READ_ROUTE_NOT_ALLOWED"}:
        return "REQUEST_INVALID"
    return "UPSTREAM_UNAVAILABLE"


def _credential_exception_code(exc: BaseException, fallback: str) -> str:
    code = getattr(exc, "code", None)
    if code == "NETWORK_UNAVAILABLE":
        return "NETWORK_UNAVAILABLE"
    if code in {"TOKEN_REJECTED", "TOKEN_RESPONSE_INVALID", "TOKEN_UNAVAILABLE"}:
        return "TOKEN_REJECTED"
    if isinstance(code, str) and code.startswith("VAULT_"):
        return "VAULT_UNAVAILABLE"
    return fallback


class FinancialQueryError(RuntimeError):
    def __init__(self, code: str) -> None:
        safe = public_code(code)
        super().__init__(safe)
        self.code = safe


@dataclass(slots=True)
class QueryProfile:
    profile_id: str
    environment: str
    client: Any
    ready: bool = True


@dataclass(slots=True)
class _Continuation:
    token: str
    parent_job_id: str
    profile_id: str
    operation_ref: str
    next_plan_token: str
    expires_at: datetime
    consumed_submission_id: str | None = None
    child_job_id: str | None = None
    child_ready: asyncio.Event = field(default_factory=asyncio.Event)
    creation_error: str | None = None


@dataclass(slots=True)
class _Page:
    token: str
    job_id: str
    job_revision: int
    index: int
    expires_at: datetime


@dataclass(slots=True)
class _Job:
    job_id: str
    submission_id: str
    parent_job_id: str | None
    profile_id: str
    operation_ref: str
    arguments: dict[str, Any]
    digest: str
    state: str
    revision: int
    created_at: datetime
    updated_at: datetime
    queue_deadline_at: datetime
    run_deadline_at: datetime | None = None
    terminal_at: datetime | None = None
    error_code: str | None = None
    pages: tuple[dict[str, Any], ...] = ()
    initial_index: int = 0
    task: asyncio.Task[None] | None = None
    cancel_requested: bool = False


def _request() -> Request:
    async def receive() -> dict[str, Any]:
        return {"type": "http.request", "body": b"", "more_body": False}

    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": "/api/v1/financial/query",
            "raw_path": b"/api/v1/financial/query",
            "query_string": b"",
            "headers": [],
            "client": ("127.0.0.1", 0),
            "server": ("127.0.0.1", 0),
        },
        receive,
    )


class FinancialQueryRuntime:
    def __init__(
        self,
        catalog: OperationCatalog,
        profile_resolver: Callable[[str], QueryProfile | Any],
        *,
        signing_secret: bytes | None = None,
        now: Callable[[], datetime] = utc_now,
    ) -> None:
        self.catalog = catalog
        self.profile_resolver = profile_resolver
        self._now = now
        self._selector = SelectorService(
            catalog, PlanSigner(signing_secret or secrets.token_bytes(32), ttl_seconds=300)
        )
        self._jobs: dict[str, _Job] = {}
        self._submissions: dict[str, tuple[str, str]] = {}
        self._pages: dict[str, _Page] = {}
        self._continuations: dict[str, _Continuation] = {}
        self._cancellations: OrderedDict[str, tuple[str, bool]] = OrderedDict()
        self._job_cancellations: dict[str, OrderedDict[str, None]] = {}
        self._global_slots = asyncio.Semaphore(2)
        self._profile_slots: dict[str, asyncio.Semaphore] = {}
        self._lock = asyncio.Lock()

    async def _profile(self, profile_id: str) -> QueryProfile:
        value = self.profile_resolver(profile_id)
        if inspect.isawaitable(value):
            value = await value
        if value is None:
            raise FinancialQueryError("CREDENTIAL_PROFILE_NOT_FOUND")
        if isinstance(value, QueryProfile):
            profile = value
        else:
            profile = QueryProfile(
                profile_id=profile_id,
                environment=str(value.environment),
                client=value.client,
                ready=bool(getattr(value, "ready", getattr(value, "state", "") == "ready")),
            )
        if not profile.ready:
            raise FinancialQueryError("CREDENTIAL_PROFILE_NOT_READY")
        return profile

    def _cleanup(self) -> None:
        now = self._now()
        expired_jobs = [
            job_id
            for job_id, job in self._jobs.items()
            if job.terminal_at is not None
            and job.terminal_at + timedelta(seconds=QUERY_TTL_SECONDS) <= now
        ]
        for job_id in expired_jobs:
            self._jobs.pop(job_id, None)
            for cancellation_id in self._job_cancellations.pop(job_id, {}):
                self._cancellations.pop(cancellation_id, None)
            for submission_id, (_, linked_job_id) in list(self._submissions.items()):
                if linked_job_id == job_id:
                    self._submissions.pop(submission_id, None)
        for token, page in list(self._pages.items()):
            if page.expires_at <= now or page.job_id not in self._jobs:
                self._pages.pop(token, None)
        for token, continuation in list(self._continuations.items()):
            if continuation.expires_at <= now or continuation.parent_job_id not in self._jobs:
                self._continuations.pop(token, None)

    def _snapshot(self, job: _Job) -> dict[str, Any]:
        card = None
        if job.state == "completed":
            card = copy.deepcopy(job.pages[job.initial_index])
        return {
            "jobId": job.job_id,
            "submissionId": job.submission_id,
            "parentJobId": job.parent_job_id,
            "profileId": job.profile_id,
            "operationRef": job.operation_ref,
            "state": job.state,
            "revision": job.revision,
            "createdAt": utc_text(job.created_at),
            "updatedAt": utc_text(job.updated_at),
            "queueDeadlineAt": utc_text(job.queue_deadline_at),
            "runDeadlineAt": utc_text(job.run_deadline_at) if job.run_deadline_at else None,
            "terminalAt": utc_text(job.terminal_at) if job.terminal_at else None,
            "errorCode": job.error_code,
            "card": card,
        }

    def _transition(self, job: _Job, state: str, *, error_code: str | None = None) -> None:
        now = self._now()
        job.state = state
        job.revision += 1
        job.updated_at = now
        job.error_code = public_code(error_code) if error_code else None
        if state == "running":
            job.run_deadline_at = now + timedelta(seconds=QUERY_RUN_SECONDS)
        if state in {"completed", "failed", "cancelled"}:
            job.terminal_at = now

    async def start(
        self,
        *,
        submission_id: str,
        profile_id: str,
        operation_ref: str,
        arguments: dict[str, Any],
        parent_job_id: str | None = None,
        continuation_plan_token: str | None = None,
    ) -> dict[str, Any]:
        self._cleanup()
        digest = arguments_digest(profile_id, operation_ref, arguments)
        async with self._lock:
            prior = self._submissions.get(submission_id)
            if prior is not None:
                prior_digest, job_id = prior
                if prior_digest != digest:
                    raise FinancialQueryError("IDEMPOTENCY_CONFLICT")
                job = self._jobs.get(job_id)
                if job is None:
                    raise FinancialQueryError("QUERY_JOB_NOT_FOUND")
                return self._snapshot(job)
        await self._profile(profile_id)
        async with self._lock:
            prior = self._submissions.get(submission_id)
            if prior is not None:
                prior_digest, job_id = prior
                if prior_digest != digest:
                    raise FinancialQueryError("IDEMPOTENCY_CONFLICT")
                job = self._jobs.get(job_id)
                if job is None:
                    raise FinancialQueryError("QUERY_JOB_NOT_FOUND")
                return self._snapshot(job)
            if len(self._jobs) >= MAX_JOBS:
                raise FinancialQueryError("QUERY_RUNTIME_BUSY")
            document = self.catalog.find_exact(operation_ref)
            if (
                document is None
                or document.kind != "query"
                or not document.generic_callable
                or document.tr_id not in TR_REGISTRY
                or TR_REGISTRY[document.tr_id].kind != "query"
            ):
                raise FinancialQueryError("QUERY_OPERATION_NOT_ALLOWED")
            try:
                validated = document.request_model.model_validate(arguments)
            except ValidationError as exc:
                raise FinancialQueryError("QUERY_ARGUMENTS_INVALID") from exc
            present = validated.model_dump(by_alias=True, exclude_unset=True)
            if canonical_bytes(present) != canonical_bytes(arguments):
                raise FinancialQueryError("QUERY_ARGUMENTS_INVALID")
            now = self._now()
            job = _Job(
                job_id=str(__import__("uuid").uuid4()),
                submission_id=submission_id,
                parent_job_id=parent_job_id,
                profile_id=profile_id,
                operation_ref=operation_ref,
                arguments=copy.deepcopy(arguments),
                digest=digest,
                state="queued",
                revision=0,
                created_at=now,
                updated_at=now,
                queue_deadline_at=now + timedelta(seconds=QUERY_QUEUE_SECONDS),
            )
            self._jobs[job.job_id] = job
            self._submissions[submission_id] = (digest, job.job_id)
            job.task = asyncio.create_task(self._run(job, continuation_plan_token))
            return self._snapshot(job)

    async def _run(self, job: _Job, continuation_plan_token: str | None) -> None:
        profile_slot = self._profile_slots.setdefault(job.profile_id, asyncio.Semaphore(1))
        try:
            timeout = max(0.0, (job.queue_deadline_at - self._now()).total_seconds())
            async with asyncio.timeout(timeout):
                async with self._global_slots:
                    async with profile_slot:
                        if job.cancel_requested:
                            self._transition(job, "cancelled", error_code="QUERY_CANCELLED")
                            return
                        self._transition(job, "running")
                        async with asyncio.timeout(QUERY_RUN_SECONDS):
                            profile = await self._profile(job.profile_id)
                            document = self.catalog.find_exact(job.operation_ref)
                            if document is None:
                                raise FinancialQueryError("QUERY_OPERATION_NOT_ALLOWED")
                            if continuation_plan_token is None:
                                resolved = self._selector.resolve(
                                    ResolveRequest(
                                        question=job.operation_ref,
                                        intent=DiscoveryIntent.QUERY,
                                        candidate_refs=[job.operation_ref],
                                        preferred_ref=job.operation_ref,
                                        detail_group=document.group_id,
                                        arguments=job.arguments,
                                    ),
                                    account=job.profile_id,
                                )
                                plan_token = resolved.plan_token
                            else:
                                plan_token = continuation_plan_token
                            call = await self._selector.call(
                                CallRequest(plan_token=plan_token),
                                _request(),
                                Response(),
                                profile.client,
                                account=job.profile_id,
                                query_only=True,
                            )
                            continuation_token = None
                            next_plan_token = call.continuation.next_plan_token
                            if next_plan_token:
                                continuation_token = opaque_token()
                                self._continuations[continuation_token] = _Continuation(
                                    token=continuation_token,
                                    parent_job_id=job.job_id,
                                    profile_id=job.profile_id,
                                    operation_ref=job.operation_ref,
                                    next_plan_token=next_plan_token,
                                    expires_at=self._now() + timedelta(seconds=QUERY_TTL_SECONDS),
                                )
                            built = build_financial_card_pages(
                                document=document,
                                response_data=call.data,
                                symbol=call.canvas_context.symbol,
                                job_id=job.job_id,
                                submission_id=job.submission_id,
                                profile_id=job.profile_id,
                                environment=profile.environment,
                                catalog_version=self.catalog.version,
                                arguments_sha256=job.digest,
                                continuation_available=continuation_token is not None,
                                continuation_token=continuation_token,
                                now=self._now(),
                            )
                            if job.cancel_requested:
                                self._transition(job, "cancelled", error_code="QUERY_CANCELLED")
                                return
                            self._install_pages(job, built)
                            self._transition(job, "completed")
        except asyncio.CancelledError:
            if job.state not in {"completed", "failed", "cancelled"}:
                self._transition(job, "cancelled", error_code="QUERY_CANCELLED")
        except TimeoutError:
            if job.state not in {"completed", "cancelled"}:
                self._transition(job, "failed", error_code="QUERY_TIMEOUT")
        except FinancialCardError as exc:
            self._transition(job, "failed", error_code=exc.code)
        except FinancialQueryError as exc:
            self._transition(job, "failed", error_code=exc.code)
        except (SelectorError, ValidationError):
            self._transition(job, "failed", error_code="QUERY_REJECTED")
        except Exception as exc:
            self._transition(job, "failed", error_code=_query_exception_code(exc))

    def _install_pages(self, job: _Job, built: CardBuild) -> None:
        expires = self._now() + timedelta(seconds=QUERY_TTL_SECONDS)
        pages = [copy.deepcopy(page) for page in built.pages]
        tokens = [opaque_token() for _ in pages]
        next_revision = job.revision + 1
        for index, page in enumerate(pages):
            page["page"]["previousPageToken"] = tokens[index - 1] if index else None
            page["page"]["nextPageToken"] = tokens[index + 1] if index + 1 < len(pages) else None
            if len(canonical_bytes(page)) > PAGE_MAX_BYTES:
                raise FinancialCardError("QUERY_RESULT_ITEM_TOO_LARGE")
            self._pages[tokens[index]] = _Page(
                token=tokens[index],
                job_id=job.job_id,
                job_revision=next_revision,
                index=index,
                expires_at=expires,
            )
        if sum(len(canonical_bytes(page)) for page in pages) > RESULT_MAX_BYTES:
            for token in tokens:
                self._pages.pop(token, None)
            raise FinancialCardError("QUERY_RESULT_TOO_LARGE")
        job.pages = tuple(pages)
        job.initial_index = built.initial_index

    async def status(self, job_id: str) -> dict[str, Any]:
        self._cleanup()
        job = self._jobs.get(job_id)
        if job is None:
            raise FinancialQueryError("QUERY_JOB_NOT_FOUND")
        return self._snapshot(job)

    async def page(self, job_id: str, page_token: str) -> dict[str, Any]:
        self._cleanup()
        page = self._pages.get(page_token)
        job = self._jobs.get(job_id)
        if page is None or job is None or page.job_id != job_id or job.state != "completed":
            raise FinancialQueryError("QUERY_PAGE_NOT_FOUND")
        if page.job_revision != job.revision:
            raise FinancialQueryError("QUERY_PAGE_NOT_FOUND")
        return {
            "jobId": job_id,
            "jobRevision": job.revision,
            "card": copy.deepcopy(job.pages[page.index]),
        }

    async def continue_query(
        self, *, submission_id: str, parent_job_id: str, continuation_token: str
    ) -> dict[str, Any]:
        self._cleanup()
        first_consumer = False
        async with self._lock:
            continuation = self._continuations.get(continuation_token)
            if continuation is None or continuation.parent_job_id != parent_job_id:
                raise FinancialQueryError("CONTINUATION_NOT_FOUND")
            if continuation.consumed_submission_id is not None:
                if continuation.consumed_submission_id != submission_id:
                    raise FinancialQueryError("CONTINUATION_ALREADY_USED")
            else:
                continuation.consumed_submission_id = submission_id
                first_consumer = True
        if not first_consumer:
            await continuation.child_ready.wait()
            if continuation.creation_error:
                raise FinancialQueryError(continuation.creation_error)
            child = self._jobs.get(continuation.child_job_id or "")
            if child is None:
                raise FinancialQueryError("QUERY_JOB_NOT_FOUND")
            return self._snapshot(child)
        try:
            child = await self.start(
                submission_id=submission_id,
                profile_id=continuation.profile_id,
                operation_ref=continuation.operation_ref,
                arguments=self._jobs[parent_job_id].arguments,
                parent_job_id=parent_job_id,
                continuation_plan_token=continuation.next_plan_token,
            )
            continuation.child_job_id = child["jobId"]
            return child
        except FinancialQueryError as exc:
            continuation.creation_error = exc.code
            raise
        finally:
            continuation.child_ready.set()

    async def cancel(
        self, *, job_id: str, cancellation_id: str
    ) -> dict[str, Any]:
        self._cleanup()
        prior = self._cancellations.get(cancellation_id)
        if prior is not None:
            if prior[0] != job_id:
                raise FinancialQueryError("IDEMPOTENCY_CONFLICT")
            job = self._jobs.get(job_id)
            if job is None:
                raise FinancialQueryError("QUERY_JOB_NOT_FOUND")
            self._cancellations.move_to_end(cancellation_id)
            return {
                "job": self._snapshot(job),
                "cancellationId": cancellation_id,
                "accepted": prior[1],
            }
        job = self._jobs.get(job_id)
        if job is None:
            raise FinancialQueryError("QUERY_JOB_NOT_FOUND")
        linked = self._job_cancellations.get(job_id)
        if (
            (linked is not None and len(linked) >= MAX_CANCELLATIONS_PER_JOB)
            or len(self._cancellations) >= MAX_CANCELLATIONS_GLOBAL
        ):
            raise FinancialQueryError("QUERY_RUNTIME_BUSY")
        accepted = False
        if job.state == "queued":
            job.cancel_requested = True
            if job.task:
                job.task.cancel()
            self._transition(job, "cancelled", error_code="QUERY_CANCELLED")
            accepted = True
        elif job.state == "running":
            job.cancel_requested = True
            self._transition(job, "cancelling")
            if job.task:
                job.task.cancel()
            accepted = True
        result = {
            "job": self._snapshot(job),
            "cancellationId": cancellation_id,
            "accepted": accepted,
        }
        self._remember_cancellation(cancellation_id, job_id, accepted)
        return result

    def _remember_cancellation(
        self, cancellation_id: str, job_id: str, accepted: bool
    ) -> None:
        self._cancellations[cancellation_id] = (job_id, accepted)
        linked = self._job_cancellations.setdefault(job_id, OrderedDict())
        linked[cancellation_id] = None

    async def cancel_profile(self, profile_id: str) -> None:
        tasks = []
        for job in list(self._jobs.values()):
            if job.profile_id == profile_id and job.state in {"queued", "running", "cancelling"}:
                job.cancel_requested = True
                if job.task:
                    job.task.cancel()
                    tasks.append(job.task)
        if tasks:
            await asyncio.wait(tasks, timeout=2)

    async def aclose(self) -> None:
        tasks = [job.task for job in self._jobs.values() if job.task and not job.task.done()]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)


@dataclass(slots=True)
class _CredentialRuntimeProfile:
    credential: Any
    auth: Any | None = None
    client: Any | None = None
    state: str = "refreshing"
    reason_code: str | None = "TOKEN_REFRESHING"
    token_expires_at: datetime | None = None
    deleting: bool = False
    process_lock: Any | None = None

    @property
    def environment(self) -> str:
        return str(self.credential.environment)

    @property
    def ready(self) -> bool:
        return self.state == "ready" and self.client is not None


@dataclass(slots=True)
class _Mutation:
    mutation_id: str
    kind: str
    profile_id: str
    digest: str
    state: str
    revision: int
    created_at: datetime
    updated_at: datetime
    queue_deadline_at: datetime
    run_deadline_at: datetime | None = None
    terminal_at: datetime | None = None
    error_code: str | None = None
    commit_control: Any | None = None
    commit_future: asyncio.Future[Any] | None = None


class _MutationFinalized(RuntimeError):
    pass


@dataclass(slots=True)
class _CleanupDebt:
    runtime: _CredentialRuntimeProfile
    close_client: bool
    release_lock: bool


class FinancialCredentialRuntime:
    """Small mutation owner around the credential lane's DPAPI vault primitives."""

    def __init__(
        self,
        vault: Any,
        catalog: OperationCatalog,
        *,
        now: Callable[[], datetime] = utc_now,
        auth_factory: Callable[..., Any] | None = None,
        client_factory: Callable[..., Any] | None = None,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self.vault = vault
        self.catalog = catalog
        self._now = now
        self._auth_factory = auth_factory
        self._client_factory = client_factory
        self._monotonic = monotonic
        self._profiles: dict[str, _CredentialRuntimeProfile] = {}
        self._mutations: dict[str, _Mutation] = {}
        self._worker_lock = asyncio.Lock()
        self._tasks: set[asyncio.Task[None]] = set()
        self._task_mutations: dict[asyncio.Task[None], _Mutation] = {}
        self._vault_executor = ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="athena-financial-vault"
        )
        self._cleanup_pending = False
        self._cleanup_debt: list[_CleanupDebt] = []
        self._fatal_vault_unavailable = False
        self._retained_uncertain: list[_CredentialRuntimeProfile] = []
        self.query_runtime: FinancialQueryRuntime | None = None
        snapshot = vault.read_snapshot()
        self._vault_schema_version = snapshot.schema_version
        for credential in snapshot.profiles:
            runtime = _CredentialRuntimeProfile(credential)
            try:
                runtime.process_lock = self._acquire_lock(credential)
            except RuntimeError:
                runtime.state = "locked"
                runtime.reason_code = "LOCK_CONFLICT"
            self._profiles[str(credential.profile_id)] = runtime

    def attach_query_runtime(self, runtime: FinancialQueryRuntime) -> None:
        self.query_runtime = runtime

    def start_refresh(self) -> None:
        for profile_id in tuple(self._profiles):
            task = asyncio.create_task(self._refresh(profile_id))
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)

    def _mutation_snapshot(self, mutation: _Mutation) -> dict[str, Any]:
        return {
            "mutationId": mutation.mutation_id,
            "kind": mutation.kind,
            "profileId": mutation.profile_id,
            "state": mutation.state,
            "revision": mutation.revision,
            "createdAt": utc_text(mutation.created_at),
            "updatedAt": utc_text(mutation.updated_at),
            "queueDeadlineAt": utc_text(mutation.queue_deadline_at),
            "runDeadlineAt": (
                utc_text(mutation.run_deadline_at) if mutation.run_deadline_at else None
            ),
            "terminalAt": utc_text(mutation.terminal_at) if mutation.terminal_at else None,
            "errorCode": mutation.error_code,
        }

    def _profile_summary(
        self, profile_id: str, runtime: _CredentialRuntimeProfile
    ) -> dict[str, Any]:
        credential = runtime.credential
        return {
            "profileId": profile_id,
            "label": credential.label,
            "environment": credential.environment,
            "revision": credential.revision,
            "state": "deleting" if runtime.deleting else runtime.state,
            "reasonCode": "DELETING" if runtime.deleting else runtime.reason_code,
            "tokenExpiresAt": (
                utc_text(runtime.token_expires_at) if runtime.token_expires_at else None
            ),
            "keyCharacterCounts": {
                "appKey": len(credential.app_key),
                "secretKey": len(credential.secret_key),
            },
        }

    async def status(self, mutation_id: str | None = None) -> dict[str, Any]:
        if self._fatal_vault_unavailable:
            if mutation_id is not None:
                raise FinancialQueryError("CREDENTIAL_MUTATION_NOT_FOUND")
            raise FinancialQueryError("VAULT_UNAVAILABLE")
        self._cleanup_mutations()
        if mutation_id is None:
            mutation = None
        else:
            record = self._mutations.get(mutation_id)
            if record is None:
                raise FinancialQueryError("CREDENTIAL_MUTATION_NOT_FOUND")
            mutation = self._mutation_snapshot(record)
        return {
            "profile": "wts-financial-read-v1",
            "apiVersion": "selector-financial-read-v1",
            "catalogVersion": self.catalog.version,
            "profiles": [
                self._profile_summary(profile_id, runtime)
                for profile_id, runtime in sorted(self._profiles.items())
            ],
            "mutation": mutation,
        }

    async def get_query_profile(self, profile_id: str) -> QueryProfile:
        self.assert_available()
        runtime = self._profiles.get(profile_id)
        if runtime is None:
            raise FinancialQueryError("CREDENTIAL_PROFILE_NOT_FOUND")
        if runtime.deleting:
            raise FinancialQueryError("DELETING")
        if runtime.state == "locked":
            raise FinancialQueryError("LOCK_CONFLICT")
        if runtime.state == "refreshing":
            raise FinancialQueryError("TOKEN_REFRESHING")
        if not runtime.ready:
            raise FinancialQueryError(runtime.reason_code or "TOKEN_REJECTED")
        return QueryProfile(profile_id, runtime.environment, runtime.client, True)

    def _mutation(
        self, *, mutation_id: str, kind: str, profile_id: str, payload: dict[str, Any]
    ) -> tuple[_Mutation, bool]:
        self._cleanup_mutations()
        digest = hashlib.sha256(canonical_bytes(payload)).hexdigest()
        prior = self._mutations.get(mutation_id)
        self.assert_available()
        if prior is not None:
            if prior.digest != digest:
                raise FinancialQueryError("IDEMPOTENCY_CONFLICT")
            return prior, False
        if self._cleanup_pending:
            raise FinancialQueryError("CREDENTIAL_RUNTIME_BUSY")
        if len(self._mutations) >= 16:
            raise FinancialQueryError("CREDENTIAL_RUNTIME_BUSY")
        now = self._now()
        mutation = _Mutation(
            mutation_id=mutation_id,
            kind=kind,
            profile_id=profile_id,
            digest=digest,
            state="queued",
            revision=0,
            created_at=now,
            updated_at=now,
            queue_deadline_at=now + timedelta(seconds=10),
        )
        self._mutations[mutation_id] = mutation
        return mutation, True

    def _cleanup_mutations(self) -> None:
        now = self._now()
        for mutation_id, mutation in list(self._mutations.items()):
            control = mutation.commit_control
            if (
                self._cleanup_pending
                and control is not None
                and control.phase.value != "finished"
            ):
                continue
            if (
                mutation.terminal_at is not None
                and mutation.terminal_at + timedelta(seconds=300) <= now
            ):
                self._mutations.pop(mutation_id, None)

    async def _acquire_mutation_worker(self, mutation: _Mutation) -> bool:
        timeout = max(0.0, (mutation.queue_deadline_at - self._now()).total_seconds())
        try:
            await asyncio.wait_for(self._worker_lock.acquire(), timeout=timeout)
        except TimeoutError:
            self._mutation_transition(mutation, "failed", "OPERATION_TIMEOUT")
            return False
        return True

    async def configure(self, payload: dict[str, Any]) -> dict[str, Any]:
        mutation, created = self._mutation(
            mutation_id=payload["mutationId"],
            kind="configure",
            profile_id=payload["profileId"],
            payload=payload,
        )
        if created:
            task = asyncio.create_task(self._configure(mutation, copy.deepcopy(payload)))
            self._tasks.add(task)
            self._task_mutations[task] = mutation
            task.add_done_callback(self._task_done)
        return {"mutation": self._mutation_snapshot(mutation)}

    async def delete(self, payload: dict[str, Any]) -> dict[str, Any]:
        mutation, created = self._mutation(
            mutation_id=payload["mutationId"],
            kind="delete",
            profile_id=payload["profileId"],
            payload=payload,
        )
        if created:
            task = asyncio.create_task(self._delete(mutation, copy.deepcopy(payload)))
            self._tasks.add(task)
            self._task_mutations[task] = mutation
            task.add_done_callback(self._task_done)
        return {"mutation": self._mutation_snapshot(mutation)}

    def _mutation_transition(
        self, mutation: _Mutation, state: str, error: str | None = None
    ) -> None:
        now = self._now()
        mutation.state = state
        mutation.revision += 1
        mutation.updated_at = now
        mutation.error_code = public_code(error) if error else None
        if state == "running":
            mutation.run_deadline_at = now + timedelta(seconds=CREDENTIAL_RUN_SECONDS)
        if state in {"succeeded", "failed"}:
            mutation.terminal_at = now

    def _task_done(self, task: asyncio.Task[None]) -> None:
        self._tasks.discard(task)
        self._task_mutations.pop(task, None)

    def assert_available(self) -> None:
        if self._fatal_vault_unavailable:
            raise FinancialQueryError("VAULT_UNAVAILABLE")

    def _new_commit_control(self) -> Any:
        from athena_api.financial_vault import VaultCommitControl

        return VaultCommitControl(
            deadline=self._monotonic() + CREDENTIAL_RUN_SECONDS,
            clock=self._monotonic,
        )

    def _remaining(self, mutation: _Mutation) -> float:
        return max(0.0, mutation.commit_control.deadline - self._monotonic())

    def _factories(self) -> tuple[Callable[..., Any], Callable[..., Any]]:
        if self._auth_factory is not None and self._client_factory is not None:
            return self._auth_factory, self._client_factory
        from athena_api.kiwoom.read_auth import FinancialReadAuth
        from athena_api.kiwoom.read_client import FinancialReadClient

        return FinancialReadAuth, FinancialReadClient

    @staticmethod
    def _acquire_lock(credential: Any) -> Any:
        from athena_api.process_lock import CredentialProcessLock

        fingerprint = hashlib.sha256(
            credential.app_key.encode("utf-8")
            + b"\0"
            + credential.secret_key.encode("utf-8")
        ).hexdigest()[:16]
        process_lock = CredentialProcessLock.for_credentials(
            fingerprint, label=credential.label
        )
        process_lock.acquire()
        return process_lock

    async def _build_runtime(
        self, credential: Any, *, process_lock: Any | None = None
    ) -> _CredentialRuntimeProfile:
        auth_factory, client_factory = self._factories()
        auth = auth_factory(
            environment=credential.environment,
            app_key=credential.app_key,
            secret_key=credential.secret_key,
        )
        allowed = {
            tr_id: spec.upstream_path for tr_id, spec in TR_REGISTRY.items() if spec.kind == "query"
        }
        client = client_factory(
            auth=auth, environment=credential.environment, allowed_routes=allowed
        )
        try:
            await auth.ensure_token()
        except BaseException:
            try:
                await client.aclose()
            except BaseException:
                pass
            raise
        expires = getattr(auth, "expires_at", None)
        if not isinstance(expires, datetime):
            expires = self._now() + timedelta(hours=1)
        return _CredentialRuntimeProfile(
            credential=credential,
            auth=auth,
            client=client,
            state="ready",
            reason_code=None,
            token_expires_at=expires,
            process_lock=process_lock,
        )

    async def _refresh(self, profile_id: str) -> None:
        prior = self._profiles.get(profile_id)
        if prior is None or prior.state == "locked":
            return
        try:
            replacement = await self._build_runtime(
                prior.credential, process_lock=prior.process_lock
            )
        except Exception as exc:
            prior.state = "error"
            prior.reason_code = _credential_exception_code(exc, "TOKEN_REJECTED")
        else:
            self._profiles[profile_id] = replacement
            await self._cleanup_replaced_profile(prior, release_lock=False)

    async def _cleanup_replaced_profile(
        self,
        runtime: _CredentialRuntimeProfile | None,
        *,
        release_lock: bool,
        retain_debt: bool = True,
    ) -> None:
        if runtime is None:
            return
        close_client = bool(runtime.client)
        if runtime.client:
            try:
                await runtime.client.aclose()
            except BaseException:
                close_client = True
            else:
                close_client = False
        if release_lock and runtime.process_lock:
            try:
                runtime.process_lock.release()
            except BaseException:
                release_lock = True
            else:
                release_lock = False
        if retain_debt and (close_client or release_lock):
            self._cleanup_debt.append(
                _CleanupDebt(runtime, close_client=close_client, release_lock=release_lock)
            )

    async def _commit_snapshot_bounded(
        self, mutation: _Mutation, snapshot: Any
    ) -> Any:
        loop = asyncio.get_running_loop()
        future = loop.run_in_executor(
            self._vault_executor,
            self.vault.commit_snapshot_bounded,
            snapshot,
            mutation.commit_control,
        )
        mutation.commit_future = future
        timer = asyncio.create_task(asyncio.sleep(self._remaining(mutation)))
        done, _ = await asyncio.wait({future, timer}, return_when=asyncio.FIRST_COMPLETED)
        if future in done:
            timer.cancel()
            await asyncio.gather(timer, return_exceptions=True)
            return future.result()
        if mutation.commit_control.try_abort():
            self._cleanup_pending = True
            self._mutation_transition(mutation, "failed", "OPERATION_TIMEOUT")
            try:
                await asyncio.shield(future)
            except BaseException:
                pass
            finally:
                self._cleanup_pending = False
            raise _MutationFinalized
        return await asyncio.shield(future)

    def _finish_precommit_timeout(self, mutation: _Mutation) -> None:
        self._finish_precommit_control(mutation)
        self._mutation_transition(mutation, "failed", "OPERATION_TIMEOUT")

    @staticmethod
    def _finish_precommit_control(mutation: _Mutation) -> None:
        control = mutation.commit_control
        if control is not None and control.try_abort():
            control.finish()

    async def _enter_fatal_uncertain(
        self, *profiles: _CredentialRuntimeProfile | None
    ) -> None:
        self._fatal_vault_unavailable = True
        retained = [profile for profile in profiles if profile is not None]
        self._retained_uncertain.extend(retained)
        if self.query_runtime and retained:
            try:
                await self.query_runtime.cancel_profile(
                    str(retained[0].credential.profile_id)
                )
            except BaseException:
                pass

    def _vault_snapshot(self, credentials: list[Any]) -> Any:
        from athena_api.financial_vault import VaultSnapshot

        return VaultSnapshot(
            schema_version=self._vault_schema_version, profiles=tuple(credentials)
        )

    async def _configure(self, mutation: _Mutation, payload: dict[str, Any]) -> None:
        if not await self._acquire_mutation_worker(mutation):
            return
        replacement = None
        candidate_lock = None
        release_candidate = False
        retain_candidate = False
        try:
            try:
                self._mutation_transition(mutation, "running")
                mutation.commit_control = self._new_commit_control()
                current = self._profiles.get(mutation.profile_id)
                expected = payload["expectedRevision"]
                if current is None and expected is not None:
                    raise FinancialQueryError("CREDENTIAL_REVISION_CONFLICT")
                if current is not None and expected != current.credential.revision:
                    raise FinancialQueryError("CREDENTIAL_REVISION_CONFLICT")
                from athena_api.financial_vault import FinancialCredential

                credential = FinancialCredential(
                    profile_id=payload["profileId"],
                    label=payload["label"],
                    environment=payload["environment"],
                    app_key=payload["appKey"],
                    secret_key=payload["secretKey"],
                    revision=1 if current is None else current.credential.revision + 1,
                )
                same_credentials = bool(
                    current
                    and current.credential.app_key == credential.app_key
                    and current.credential.secret_key == credential.secret_key
                )
                candidate_lock = (
                    current.process_lock
                    if same_credentials
                    else self._acquire_lock(credential)
                )
                release_candidate = not same_credentials
                try:
                    replacement = await asyncio.wait_for(
                        self._build_runtime(credential, process_lock=candidate_lock),
                        timeout=self._remaining(mutation),
                    )
                except TimeoutError:
                    self._finish_precommit_timeout(mutation)
                    return
                credentials = [
                    runtime.credential
                    for profile_id, runtime in self._profiles.items()
                    if profile_id != mutation.profile_id
                ]
                credentials.append(credential)
                snapshot = self._vault_snapshot(credentials)
                if self._remaining(mutation) <= 0:
                    self._finish_precommit_timeout(mutation)
                    return
                outcome = await self._commit_snapshot_bounded(mutation, snapshot)
                from athena_api.financial_vault import VaultCommitOutcome

                prior = self._profiles.get(mutation.profile_id)
                if outcome == VaultCommitOutcome.TARGET_VERIFIED:
                    self._profiles[mutation.profile_id] = replacement
                    replacement = None
                    release_candidate = False
                    self._mutation_transition(mutation, "succeeded")
                    await self._cleanup_replaced_profile(
                        prior,
                        release_lock=bool(prior and prior.process_lock is not candidate_lock),
                    )
                elif outcome == VaultCommitOutcome.PRIOR_VERIFIED:
                    self._mutation_transition(mutation, "failed", "VAULT_UNAVAILABLE")
                elif outcome == VaultCommitOutcome.ABORTED_BEFORE_COMMIT:
                    self._mutation_transition(mutation, "failed", "OPERATION_TIMEOUT")
                else:
                    retain_candidate = True
                    await self._enter_fatal_uncertain(prior, replacement)
            except _MutationFinalized:
                pass
            except FinancialQueryError as exc:
                self._finish_precommit_control(mutation)
                self._mutation_transition(mutation, "failed", exc.code)
            except Exception as exc:
                if mutation.state not in {"succeeded", "failed"}:
                    self._finish_precommit_control(mutation)
                    self._mutation_transition(
                        mutation,
                        "failed",
                        _credential_exception_code(exc, "CREDENTIAL_CONFIGURATION_FAILED"),
                    )
            finally:
                if replacement is not None and not retain_candidate:
                    await self._cleanup_replaced_profile(
                        replacement, release_lock=release_candidate
                    )
                    release_candidate = False
                elif release_candidate and candidate_lock is not None and not retain_candidate:
                    try:
                        candidate_lock.release()
                    except BaseException:
                        self._cleanup_debt.append(
                            _CleanupDebt(
                                _CredentialRuntimeProfile(
                                    credential=credential,
                                    process_lock=candidate_lock,
                                ),
                                close_client=False,
                                release_lock=True,
                            )
                        )
        finally:
            self._worker_lock.release()

    async def _delete(self, mutation: _Mutation, payload: dict[str, Any]) -> None:
        if not await self._acquire_mutation_worker(mutation):
            return
        try:
            try:
                self._mutation_transition(mutation, "running")
                mutation.commit_control = self._new_commit_control()
                current = self._profiles.get(mutation.profile_id)
                if current is None:
                    raise FinancialQueryError("CREDENTIAL_PROFILE_NOT_FOUND")
                if payload["expectedRevision"] != current.credential.revision:
                    raise FinancialQueryError("CREDENTIAL_REVISION_CONFLICT")
                current.deleting = True
                if self.query_runtime:
                    await self.query_runtime.cancel_profile(mutation.profile_id)
                if self._remaining(mutation) <= 0:
                    current.deleting = False
                    self._finish_precommit_timeout(mutation)
                    return
                credentials = [
                    runtime.credential
                    for profile_id, runtime in self._profiles.items()
                    if profile_id != mutation.profile_id
                ]
                snapshot = self._vault_snapshot(credentials)
                outcome = await self._commit_snapshot_bounded(mutation, snapshot)
                from athena_api.financial_vault import VaultCommitOutcome

                if outcome == VaultCommitOutcome.TARGET_VERIFIED:
                    removed = self._profiles.pop(mutation.profile_id)
                    self._mutation_transition(mutation, "succeeded")
                    await self._cleanup_replaced_profile(removed, release_lock=True)
                elif outcome == VaultCommitOutcome.PRIOR_VERIFIED:
                    current.deleting = False
                    self._mutation_transition(mutation, "failed", "VAULT_UNAVAILABLE")
                elif outcome == VaultCommitOutcome.ABORTED_BEFORE_COMMIT:
                    current.deleting = False
                    self._mutation_transition(mutation, "failed", "OPERATION_TIMEOUT")
                else:
                    await self._enter_fatal_uncertain(current)
            except _MutationFinalized:
                current = self._profiles.get(mutation.profile_id)
                if current:
                    current.deleting = False
            except FinancialQueryError as exc:
                self._finish_precommit_control(mutation)
                self._mutation_transition(mutation, "failed", exc.code)
            except Exception as exc:
                current = self._profiles.get(mutation.profile_id)
                if current:
                    current.deleting = False
                if mutation.state not in {"succeeded", "failed"}:
                    self._finish_precommit_control(mutation)
                    self._mutation_transition(
                        mutation,
                        "failed",
                        _credential_exception_code(exc, "CREDENTIAL_DELETE_FAILED"),
                    )
        finally:
            self._worker_lock.release()

    async def aclose(self) -> None:
        for task in tuple(self._tasks):
            mutation = self._task_mutations.get(task)
            control = mutation.commit_control if mutation else None
            if control is None:
                task.cancel()
            elif control.try_abort() and mutation.commit_future is None:
                task.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
        self._vault_executor.shutdown(wait=True, cancel_futures=False)
        if self._fatal_vault_unavailable:
            return
        debts, self._cleanup_debt = self._cleanup_debt, []
        for debt in debts:
            runtime = debt.runtime
            if not debt.close_client:
                runtime = _CredentialRuntimeProfile(
                    credential=runtime.credential,
                    process_lock=runtime.process_lock,
                )
            await self._cleanup_replaced_profile(
                runtime, release_lock=debt.release_lock, retain_debt=False
            )
        for runtime in self._profiles.values():
            await self._cleanup_replaced_profile(
                runtime, release_lock=True, retain_debt=False
            )
