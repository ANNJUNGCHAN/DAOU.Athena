"""Public schema fixtures only; no account response or credentials are used."""

from athena_api.card_surface_contract import bind_surface_values, build_board_surface_contract
from athena_api.card_surface_templates import get_registry


def contract_values(board_id, responses):
    bound = {}
    for operation, response in responses.items():
        bound.update(bind_surface_values(operation, response))
    contract = build_board_surface_contract(
        board_id, bound_values=bound, active_operation_refs=list(responses)
    )
    assert contract is not None, board_id
    return {entry["slot_id"]: entry["value"] for entry in contract["slot_values"]}


def test_account_kpis_do_not_substitute_cash_for_assets_or_stock_valuation():
    values = contract_values("2SCE-1", {
        "detail:kt00004:cash_and_assets": {
            "entr": "101", "aset_evlt_amt": "202", "tot_est_amt": "303",
        },
        "detail:kt00001:withdrawal_and_order_capacity": {"ord_alow_amt": "404"},
        "detail:kt00001:settlement_forecast": {"d2_pymn_alow_amt": "505"},
        "detail:kt00018:portfolio_summary": {
            "tot_evlt_amt": "606", "tot_evlt_pl": "707", "tot_pur_amt": "808", "tot_prft_rt": "9.09",
        },
    })
    assert values["s012"] == "202"
    assert values["s015"] == "404"
    assert values["s018"] == "303"
    assert values["s021"] == "707"
    assert values["s022"] == "808"
    assert values["s013"] == "9.09"


def test_holdings_alternatives_keep_field_meanings_and_do_not_invent_credit_names():
    rows = [{"stk_nm": f"합성 종목 {i}", "stk_cd": f"A10000{i}", "rmnd_qty": str(10+i),
             "cur_prc": str(20+i), "avg_prc": str(30+i), "pur_amt": str(40+i),
             "evlt_amt": str(50+i)} for i in range(3)]
    values = contract_values("2SCE-1", {"detail:kt00004:position_valuation": {"stk_acnt_evlt_prst": rows}})
    for i in range(3):
        start = 35 + 15*i
        assert values[f"s{start:03}"] == f"합성 종목 {i}"
        assert values[f"s{start+1:03}"] == f"A10000{i}"
        assert f"s{start+2:03}" not in values  # credit name cannot be a code or stock name
        assert f"s{start+4:03}" not in values  # available quantity is not total holding quantity
        assert values[f"s{start+6:03}"] == str(40+i)  # purchase amount is not unit price
        assert f"s{start+8:03}" not in values  # previous close is not current price
        assert f"s{start+10:03}" not in values  # allocation is not market value


def test_credit_names_and_prior_day_fields_are_kept_when_their_actual_fields_arrive():
    row = {"stk_nm": "합성 이름", "stk_cd": "A100001", "crd_tp_nm": "합성 신용구분",
           "pred_close_pric": "123", "tdy_buyq": "4", "pred_buyq": "5", "pred_sellq": "6"}
    values = contract_values("2SCE-1", {"detail:kt00018:holdings": {"acnt_evlt_remn_indv_tot": [row]}})
    assert values["s037"] == "합성 신용구분"
    assert values["s043"] == "123"
    assert values["s048"] == "4"
    assert values["s049"] == "5"


def test_asset_history_never_uses_current_balance_as_prior_days_and_keeps_title_fixed():
    values = contract_values("2SKU-1", {
        "detail:kt00004:cash_and_assets": {"aset_evlt_amt": "202", "prsm_dpst_aset_amt": "909"},
        "detail:kt00018:portfolio_summary": {"prsm_dpst_aset_amt": "1010"},
    })
    assert values["s012"] == "202"
    assert not ({"s190", "s191", "s192", "s193", "s194", "s195", "s196", "s197"} & values.keys())


def test_copied_account_kpis_use_the_same_semantic_fields_across_all_stock_tabs():
    registry = get_registry()
    # Includes all 12 stock-account states; the two gold-account surfaces differ.
    for board_id in ["133H-2", "2SCE-1", "2SKU-1", "2SRV-1", "2SYW-1", "3GRO-0",
                     "3IGR-0", "3K7K-0", "3LGC-0", "3MTJ-0", "3NVG-0", "3UTA-0"]:
        values = contract_values(board_id, {
            "detail:kt00004:cash_and_assets": {"aset_evlt_amt": "202", "tot_est_amt": "303"},
            "detail:kt00001:withdrawal_and_order_capacity": {"ord_alow_amt": "404"},
        })
        board = registry.boards[board_id]
        for slot in board.slots:
            expected = {"124,580,240원": "202", "89,760,240원": "303", "31,240,000원": "404"}.get(slot.paper_text)
            if expected is not None and slot.region == "kpi":
                assert values[slot.slot_id] == expected, (board_id, slot.slot_id)


def test_each_settlement_day_uses_its_own_cash_and_capacity_fields():
    responses = {
        "detail:kt00001:cash_and_margin": {"entr": "101"},
        "detail:kt00001:withdrawal_and_order_capacity": {"pymn_alow_amt": "202"},
        "detail:kt00001:settlement_forecast": {
            "d1_entra": "303", "d1_pymn_alow_amt": "404",
            "d2_entra": "505", "d2_pymn_alow_amt": "606", "d2_slby_exct_amt": "707",
        },
    }
    for board, slots in [("2SKU-1", ["s053", "s052", "s060", "s059", "s068", "s067", "s064"]),
                         ("3MTJ-0", ["s042", "s041", "s051", "s050", "s062", "s061", "s058"])]:
        values = contract_values(board, responses)
        assert [values[s] for s in slots] == ["101", "202", "303", "404", "505", "606", "707"]


def test_realized_profit_rows_do_not_inherit_account_summary_rates():
    values = contract_values("2SRV-1", {
        "detail:kt00004:profit_and_loss": {"tdy_lspft_rt": "0"},
        "base:ka10170": {"tot_prft_rt": "0"},
        "base:ka10073": {"dt_stk_rlzt_pl": [
            {"dt": "20260901", "stk_nm": "합성 실현종목", "stk_cd": "100001",
             "tdy_sel_pl": "0", "pl_rt": "0", "tdy_trde_cmsn": "3", "tdy_trde_tax": "4"},
        ]},
    })
    assert [values[s] for s in ["s046", "s047", "s048", "s050", "s052", "s053", "s055"]] == [
        "20260901", "합성 실현종목", "100001", "0", "0", "3", "4",
    ]
    # A genuine zero-profit observation is retained; later absent rows get no summary zero.
    assert not ({f"s{52 + i*11:03}" for i in range(1, 7)} & values.keys())


def test_gold_surfaces_do_not_bind_stock_account_fields():
    registry = get_registry()
    for board_id in ["3ODO-0", "3OIM-0"]:
        for slot in registry.boards[board_id].slots:
            if slot.region == "kpi":
                assert all("kt500" in binding.mapping_id for binding in slot.bindings)
        values = contract_values(board_id, {
            "detail:kt00004:cash_and_assets": {"aset_evlt_amt": "202", "tot_est_amt": "303"},
            "detail:kt00001:withdrawal_and_order_capacity": {"ord_alow_amt": "404"},
        })
        kpis = {slot.slot_id for slot in registry.boards[board_id].slots if slot.region == "kpi"}
        assert not (kpis & values.keys())


def test_all_account_surfaces_remain_valid_after_semantic_mapping_repairs():
    registry = get_registry()
    assert not registry.excluded_boards
    assert sum(board.card_id == "CC-01" for board in registry.boards.values()) == 14
