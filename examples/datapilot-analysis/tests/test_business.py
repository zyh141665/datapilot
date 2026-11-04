import math

import pytest

from datapilot_analysis.datasets import DatasetError, DatasetStore


SALES = "月份,区域,销售额,成本\n2026-09,华东,100,60\n2026-09,华北,100,50\n2026-10,华东,180,90\n2026-10,华北,120,70\n"
MAPPING = {
    "date_column": "月份",
    "revenue_column": "销售额",
    "cost_column": "成本",
    "dimension_column": "区域",
    "unit": "元",
}


@pytest.fixture
def store(tmp_path):
    return DatasetStore(tmp_path / "business.sqlite")


def bind(store, text=SALES):
    item = store.import_file("alice", "sales.csv", text.encode())
    store.bind("alice", "t", item["id"])
    return item


def test_business_metrics_comparison_and_contributions_reconcile(store):
    item = bind(store)
    result = store.business("alice", "t", MAPPING)
    assert result["source"]["sha256"] == item["sha256"]
    assert result["totals"]["revenue"] == 500
    assert result["totals"]["cost"] == 270
    assert result["totals"]["profit"] == 230
    assert result["totals"]["profit_margin_percent"] == 46
    comparison = result["comparison"]
    assert comparison["current_month"] == "2026-10"
    assert comparison["base_month"] == "2026-09"
    assert comparison["delta"] == 100
    assert comparison["growth_percent"] == 50
    assert [r["delta"] for r in comparison["contributions"]] == [80, 20]
    assert sum(r["delta"] for r in comparison["contributions"]) == comparison["delta"]
    assert sum(r["share_percent"] for r in comparison["contributions"]) == 100
    assert result["charts"][0]["points"] == [
        {"label": "2026-09", "value": 200},
        {"label": "2026-10", "value": 300},
    ]


def test_missing_cost_never_becomes_zero_or_partial_profit(store):
    bind(store, SALES.replace("120,70", "120,"))
    result = store.business("alice", "t", MAPPING)
    assert result["totals"]["revenue"] == 500
    assert result["totals"]["cost"] is None
    assert result["totals"]["profit"] is None
    assert result["comparison"]["current"]["profit_margin_percent"] is None
    assert result["warnings"]


def test_missing_revenue_blocks_growth_and_contribution(store):
    bind(store, SALES.replace("120,70", ",70"))
    result = store.business("alice", "t", MAPPING)
    assert result["totals"]["revenue"] is None
    assert result["comparison"]["growth_percent"] is None
    assert result["comparison"]["contributions"] == []


@pytest.mark.parametrize("base", [0, -100])
def test_nonpositive_baseline_has_delta_but_no_growth_percentage(store, base):
    bind(store, f"月份,销售额\n2026-09,{base}\n2026-10,100\n")
    result = store.business(
        "alice", "t", {"date_column": "月份", "revenue_column": "销售额"}
    )
    assert result["comparison"]["delta"] == 100 - base
    assert result["comparison"]["growth_percent"] is None
    assert result["comparison"]["reason"]


def test_missing_month_is_a_gap_and_not_the_previous_observed_month(store):
    bind(store, "日期,销售额\n2026-08-01,50\n2026-10-05,100\n")
    result = store.business(
        "alice", "t", {"date_column": "日期", "revenue_column": "销售额"}
    )
    assert result["trend"][1]["month"] == "2026-09"
    assert result["trend"][1]["revenue"] is None
    assert result["comparison"]["base_month"] == "2026-09"
    assert result["comparison"]["growth_percent"] is None


def test_scope_dates_and_missing_date_rows_are_explicit(store):
    bind(store, SALES + ",华东,50,20\n2025-01,华东,80,40\n")
    result = store.business(
        "alice", "t", {**MAPPING, "from_month": "2026-09", "to_month": "2026-10"}
    )
    assert result["scope"]["included_rows"] == 4
    assert result["scope"]["missing_date_rows"] == 1
    assert result["scope"]["outside_range_rows"] == 1
    assert result["totals"]["revenue"] == 500


def test_entered_and_exited_groups_are_included_with_signed_contributions(store):
    bind(store, "月份,区域,销售额\n2026-09,旧区,100\n2026-10,新区,150\n")
    result = store.business(
        "alice", "t", {k: v for k, v in MAPPING.items() if k != "cost_column"}
    )
    values = {r["label"]: r for r in result["comparison"]["contributions"]}
    assert values["旧区"]["delta"] == -100
    assert values["新区"]["share_percent"] == 300
    assert result["comparison"]["delta"] == 50


@pytest.mark.parametrize(
    "changes",
    [
        {"date_column": "不存在"},
        {"revenue_column": "区域"},
        {"current_month": "10月"},
        {"base_month": "2026-13"},
        {"from_month": "2026-10", "to_month": "2026-09"},
        {"sql": "select * from x"},
        {"unit": "x" * 21},
    ],
)
def test_business_rejects_ambiguous_or_invalid_parameters(store, changes):
    bind(store)
    with pytest.raises(DatasetError):
        store.business("alice", "t", {**MAPPING, **changes})


def test_bad_dates_are_reported_instead_of_silently_dropped(store):
    bind(store, SALES.replace("2026-09", "2026-02-30"))
    with pytest.raises(DatasetError, match="日期"):
        store.business("alice", "t", MAPPING)


def test_business_and_chart_cannot_read_another_owners_binding(store):
    bind(store)
    with pytest.raises(DatasetError):
        store.business("bob", "t", MAPPING)
    with pytest.raises(DatasetError):
        store.chart("bob", "t", {"x": "区域", "metric": "销售额"})


def test_chart_uses_real_filtered_grouped_values_and_source(store):
    item = bind(store)
    result = store.chart(
        "alice",
        "t",
        {
            "x": "区域",
            "metric": "销售额",
            "filters": [{"column": "月份", "op": "eq", "value": "2026-10"}],
        },
    )
    assert result["chart"]["points"] == [
        {"label": "华东", "value": 180},
        {"label": "华北", "value": 120},
    ]
    assert result["source"]["sha256"] == item["sha256"]
    assert result["query"]["filters"][0]["value"] == "2026-10"


def test_chart_refuses_silent_category_truncation(store):
    bind(store, "区域,销售额\n" + "\n".join(f"r{i},1" for i in range(51)))
    with pytest.raises(DatasetError, match="50"):
        store.chart("alice", "t", {"x": "区域", "metric": "销售额"})


def test_chart_handles_negative_values_and_count(store):
    bind(store, "区域,销售额\nA,-10\nB,0\nB,20\n")
    result = store.chart("alice", "t", {"x": "区域", "aggregation": "count"})
    assert [p["value"] for p in result["chart"]["points"]] == [2, 1]
    result = store.chart(
        "alice", "t", {"x": "区域", "metric": "销售额", "kind": "line"}
    )
    assert all(math.isfinite(p["value"]) for p in result["chart"]["points"])


def test_business_limits_large_time_ranges_and_group_counts(store):
    bind(store, "月份,销售额\n2020-01,10\n2026-10,20\n")
    with pytest.raises(DatasetError, match="24"):
        store.business(
            "alice", "t", {"date_column": "月份", "revenue_column": "销售额"}
        )


@pytest.mark.parametrize("header", ["value", "Value"])
def test_chart_metric_alias_does_not_conflict_with_group_column(store, header):
    bind(store, f"{header},sales\nA,1\nB,10\n")
    result = store.chart("alice", "t", {"x": header, "metric": "sales"})
    assert result["chart"]["points"] == [
        {"label": "B", "value": 10},
        {"label": "A", "value": 1},
    ]


def test_bound_analysis_loads_dataset_rows_only_once(store, monkeypatch):
    bind(store)
    original = store._read
    calls = []

    def counted(*args, **kwargs):
        calls.append(kwargs.get("include_data", True))
        return original(*args, **kwargs)

    monkeypatch.setattr(store, "_read", counted)
    store.business("alice", "t", MAPPING)
    assert calls.count(True) == 1
    calls.clear()
    store.chart("alice", "t", {"x": "区域", "metric": "销售额"})
    assert calls.count(True) == 1


def test_generic_chart_accepts_numeric_time_slots_without_calendar_conversion(store):
    item = bind(store, "time_slot,value\n1,10\n1,20\n2,40\n")
    result = store.chart_for_dataset(
        "alice",
        item["id"],
        {"x": "time_slot", "metric": "value", "aggregation": "mean", "kind": "line"},
    )
    assert result["chart"]["points"] == [
        {"label": "1.0", "value": 15},
        {"label": "2.0", "value": 40},
    ]
    with pytest.raises(DatasetError):
        store.chart_for_dataset(
            "bob", item["id"], {"x": "time_slot", "metric": "value"}
        )
