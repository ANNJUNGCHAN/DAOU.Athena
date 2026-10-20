from __future__ import annotations

import json
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest

from athena_api.canvas_transform import build_facts, build_table
from athena_api.financial_cards import (
    PROTECTED_ACCOUNT_VALUE,
    FinancialCardError,
    build_financial_card_pages,
)
from athena_api.selector.catalog import build_operation_catalog


@pytest.mark.parametrize(
    ("operation_ref", "payload", "symbol", "kind"),
    [
        ("base:ka00001", {"acctNo": "synthetic"}, None, "facts"),
        (
            "base:ka00198",
            {"item_inq_rank": [{"stk_nm": "테스트", "bigd_rank": "1"}]},
            None,
            "table",
        ),
        (
            "base:ka01300",
            {"rtcd": "0", "nofi": [{"gcod": "A", "name": "테스트"}]},
            None,
            "compound",
        ),
        (
            "base:ka10079",
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
            "000000",
            "chart",
        ),
    ],
)
def test_all_four_financial_card_families_are_canonical(
    operation_ref: str, payload: dict, symbol: str | None, kind: str
) -> None:
    catalog = build_operation_catalog()
    job_id = str(uuid4())
    submission_id = str(uuid4())
    profile_id = str(uuid4())
    built = build_financial_card_pages(
        document=catalog.by_ref[operation_ref],
        response_data=payload,
        symbol=symbol,
        job_id=job_id,
        submission_id=submission_id,
        profile_id=profile_id,
        environment="mock",
        catalog_version=catalog.version,
        arguments_sha256="sha256:" + "0" * 64,
        continuation_available=False,
        continuation_token=None,
    )
    page = built.pages[built.initial_index]
    assert page["renderKind"] == kind
    assert page["data"]["kind"] == kind
    assert page["provenance"]["environment"] == "mock"
    assert "raw_data" not in page
    assert "arguments" not in page


def test_strict_financial_chart_rejects_one_bad_row_instead_of_skipping_it() -> None:
    catalog = build_operation_catalog()
    payload = {
        "stk_cd": "000000",
        "stk_tic_chart_qry": [
            {
                "cur_prc": "100",
                "trde_qty": "10",
                "cntr_tm": "bad",
                "open_pric": "90",
                "high_pric": "110",
                "low_pric": "80",
            }
        ],
    }
    with pytest.raises(FinancialCardError, match="QUERY_RESULT_UNSUPPORTED_VALUE"):
        build_financial_card_pages(
            document=catalog.by_ref["base:ka10079"],
            response_data=payload,
            symbol="000000",
            job_id=str(uuid4()),
            submission_id=str(uuid4()),
            profile_id=str(uuid4()),
            environment="mock",
            catalog_version=catalog.version,
            arguments_sha256="sha256:" + "0" * 64,
            continuation_available=False,
            continuation_token=None,
        )


def test_financial_full_collection_options_do_not_change_legacy_transform_limits() -> None:
    facts_payload = {f"field_{index}": index for index in range(60)}
    legacy_facts = build_facts(facts_payload)
    full_facts = build_facts(facts_payload, limit=None)
    assert not isinstance(legacy_facts, str)
    assert not isinstance(full_facts, str)
    assert len(legacy_facts[0]["fields"]) == 40
    assert len(full_facts[0]["fields"]) == 60

    table_payload = {"rows": [{"value": index} for index in range(60)]}
    legacy_table = build_table(table_payload)
    full_table = build_table(table_payload, limit=None)
    assert not isinstance(legacy_table, str)
    assert not isinstance(full_table, str)
    assert len(legacy_table[0]["rows"]) == 50
    assert len(full_table[0]["rows"]) == 60


@pytest.mark.parametrize(
    ("operation_ref", "payload"),
    [
        (
            "base:ka00001",
            {"acctNo": "REAL-ACCOUNT-CANARY", "acnt_no": "REAL-ACCOUNT-CANARY"},
        ),
        (
            "base:ka00198",
            {
                "item_inq_rank": [
                    {
                        "acctNo": "REAL-ACCOUNT-CANARY",
                        "acnt_print": "REAL-ACCOUNT-CANARY",
                    }
                ]
            },
        ),
        (
            "base:ka01300",
            {
                "9201": "REAL-ACCOUNT-CANARY",
                "nofi": [{"acnt_no": "REAL-ACCOUNT-CANARY"}],
            },
        ),
    ],
)
def test_account_identifier_alias_values_are_protected_in_serialized_cards(
    operation_ref: str, payload: dict
) -> None:
    built = build_financial_card_pages(
        document=build_operation_catalog().by_ref[operation_ref],
        response_data=payload,
        symbol=None,
        job_id=str(uuid4()),
        submission_id=str(uuid4()),
        profile_id=str(uuid4()),
        environment="mock",
        catalog_version="test",
        arguments_sha256="sha256:" + "0" * 64,
        continuation_available=False,
        continuation_token=None,
    )
    serialized = json.dumps(built.pages, ensure_ascii=False)
    assert "REAL-ACCOUNT-CANARY" not in serialized
    assert PROTECTED_ACCOUNT_VALUE in serialized


def test_wire_strings_use_utf16_units_and_total_retained_pages_are_bounded() -> None:
    catalog = build_operation_catalog()
    accepted = "😀" * 4096
    built = build_financial_card_pages(
        document=catalog.by_ref["base:ka00001"],
        response_data={"value": accepted},
        symbol=None,
        job_id=str(uuid4()),
        submission_id=str(uuid4()),
        profile_id=str(uuid4()),
        environment="mock",
        catalog_version="test",
        arguments_sha256="sha256:" + "0" * 64,
        continuation_available=False,
        continuation_token=None,
    )
    assert built.pages[0]["data"]["fields"][0]["value"] == accepted

    with pytest.raises(FinancialCardError, match="QUERY_RESULT_UNSUPPORTED_VALUE"):
        build_financial_card_pages(
            document=catalog.by_ref["base:ka00001"],
            response_data={"value": accepted + "😀"},
            symbol=None,
            job_id=str(uuid4()),
            submission_id=str(uuid4()),
            profile_id=str(uuid4()),
            environment="mock",
            catalog_version="test",
            arguments_sha256="sha256:" + "0" * 64,
            continuation_available=False,
            continuation_token=None,
        )


def test_all_four_generated_card_families_pass_the_canonical_protocol_validator() -> None:
    catalog = build_operation_catalog()
    profile_id = str(uuid4())
    job_id = str(uuid4())
    submission_id = str(uuid4())
    cases = [
        ("base:ka00001", {"value": "ok"}, None),
        ("base:ka00198", {"item_inq_rank": [{"name": "ok"}]}, None),
        ("base:ka01300", {"rtcd": "0", "nofi": [{"name": "ok"}]}, None),
        (
            "base:ka10079",
            {
                "stk_tic_chart_qry": [
                    {
                        "cur_prc": "100",
                        "trde_qty": "10",
                        "cntr_tm": "20261019120000",
                        "open_pric": "90",
                        "high_pric": "110",
                        "low_pric": "80",
                    }
                ]
            },
            "000000",
        ),
    ]
    cards = []
    for operation_ref, payload, symbol in cases:
        built = build_financial_card_pages(
            document=catalog.by_ref[operation_ref],
            response_data=payload,
            symbol=symbol,
            job_id=job_id,
            submission_id=submission_id,
            profile_id=profile_id,
            environment="mock",
            catalog_version=catalog.version,
            arguments_sha256="sha256:" + "0" * 64,
            continuation_available=False,
            continuation_token=None,
            now=datetime(2099, 10, 19, 12, tzinfo=UTC),
        )
        cards.append(built.pages[built.initial_index])

    script = r"""
import { readFile } from 'node:fs/promises';
import { createProtocolValidator } from './contracts/wts-foundation.mjs';
const schema = JSON.parse(
  await readFile('./contracts/wts-foundation.protocol.schema.json', 'utf8'),
);
const validator = createProtocolValidator(schema);
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const cards = JSON.parse(Buffer.concat(chunks).toString('utf8'));
for (const card of cards) {
  validator.validateResponse({
    protocolVersion: 8,
    requestId: 'req-card-validator-1',
    method: 'source.query.status',
    ok: true,
    result: { job: {
      jobId: card.jobId,
      submissionId: card.submissionId,
      parentJobId: null,
      profileId: card.provenance.profileId,
      operationRef: card.operationRef,
      state: 'completed',
      revision: 3,
      createdAt: '2099-10-19T11:59:58.000Z',
      updatedAt: '2099-10-19T12:00:00.000Z',
      queueDeadlineAt: '2099-10-19T12:00:28.000Z',
      runDeadlineAt: '2099-10-19T12:00:29.000Z',
      terminalAt: '2099-10-19T12:00:00.000Z',
      errorCode: null,
      card,
    } },
  });
}
"""
    completed = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=Path(__file__).resolve().parents[2],
        input=json.dumps(cards, ensure_ascii=False).encode("utf-8"),
        capture_output=True,
        timeout=20,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr.decode(errors="replace")

    oversized = {f"field_{index}": "x" * 8192 for index in range(260)}
    with pytest.raises(FinancialCardError, match="QUERY_RESULT_TOO_LARGE"):
        build_financial_card_pages(
            document=catalog.by_ref["base:ka00001"],
            response_data=oversized,
            symbol=None,
            job_id=str(uuid4()),
            submission_id=str(uuid4()),
            profile_id=str(uuid4()),
            environment="mock",
            catalog_version="test",
            arguments_sha256="sha256:" + "0" * 64,
            continuation_available=False,
            continuation_token=None,
        )
