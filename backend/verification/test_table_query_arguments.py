"""A table's next hydration must retain the original verified query criteria."""

from types import SimpleNamespace

from athena_api.api.canvas_push import _chart_reload_metadata


def test_table_preserves_sort_issuer_lp_and_underlying_criteria():
    args = {'sort_tp': '5', 'isscomp_cd': '000000000003', 'lpcd': '003', 'bsis_aset_cd': '201'}
    result = _chart_reload_metadata('table', SimpleNamespace(dataset_id=None, delivery_id=None), args)
    assert result['operation_args'] == args
    assert result['operation_args'] is not args
    assert 'correlation' not in result


def test_facts_and_chart_preserve_criteria_but_only_chart_adds_reload_correlation():
    payload = SimpleNamespace(dataset_id=None, delivery_id='synthetic-chart')
    args = {'stk_cd': '123456', 'amt_qty_tp': '2', 'unit_tp': '1000'}
    assert _chart_reload_metadata('facts', payload, args) == {'operation_args': args}
    chart = _chart_reload_metadata('chart', payload, args)
    assert chart['operation_args'] == args
    assert chart['correlation']['dataset_id'] == 'synthetic-chart'
