"""Offline tests for the DataPilot business tools, independent of the harness."""

import json

import pytest

from datapilot_analysis.analysis import analyze_csv


CSV = "region,revenue,cost\nEast,100,60\nWest,200,90\nEast,50,\n"


def test_profile_and_missing_values():
    result = analyze_csv(CSV)
    assert result["row_count"] == 3
    assert result["columns"]["cost"]["missing"] == 1
    assert result["columns"]["revenue"]["sum"] == 350
    assert result["columns"]["region"]["type"] == "text"
    json.dumps(result, allow_nan=False)


@pytest.mark.parametrize(
    "operation, expected",
    [("sum", 150), ("mean", 75), ("count", 2), ("min", 50), ("max", 100)],
)
def test_grouping(operation, expected):
    result = analyze_csv(
        CSV, group_by="region", metric="revenue", aggregation=operation
    )
    assert result["groups"][0] == {
        "group": "East",
        "value": expected,
        "valid_count": 2,
        "missing_count": 0,
    }


def test_quoted_newlines_and_bom():
    result = analyze_csv('\ufeffname,value\n"a,b",2\n"multi\nline",4\n')
    assert result["row_count"] == 2
    assert result["columns"]["value"]["mean"] == 3


@pytest.mark.parametrize(
    "content",
    [
        "",
        "a,a\n1,2",
        "a,\n1,2",
        "a,b\n1",
        "a,b\n1,2,3",
        'a\n"unfinished',
        "a\nInfinity",
        "a\nNaN",
    ],
)
def test_invalid_data_is_rejected(content):
    with pytest.raises(ValueError):
        analyze_csv(content)


@pytest.mark.parametrize(
    "kwargs",
    [
        {"group_by": "unknown", "metric": "revenue"},
        {"group_by": "region"},
        {"metric": "revenue"},
        {"group_by": "region", "metric": "region"},
        {"group_by": "region", "metric": "revenue", "aggregation": "execute"},
    ],
)
def test_invalid_group_requests_are_rejected(kwargs):
    with pytest.raises(ValueError):
        analyze_csv(CSV, **kwargs)


def test_header_only_has_no_fabricated_statistics():
    result = analyze_csv("name,value\n")
    assert result["row_count"] == 0
    assert result["columns"]["value"]["type"] == "empty"


def test_missing_group_values_do_not_collide_with_literal_names():
    result = analyze_csv("g,v\n,2\nmissing,3", group_by="g", metric="v")
    assert [g["group"] for g in result["groups"]] == [None, "missing"]


@pytest.mark.parametrize(
    "content",
    [
        "a\n" + "x" * 200_001,
        "a\n" + "1\n" * 10_001,
        ",".join(f"c{i}" for i in range(51)),
    ],
    ids=["bytes", "rows", "columns"],
)
def test_resource_limits(content):
    with pytest.raises(ValueError):
        analyze_csv(content)


def test_tool_returns_structured_error_instead_of_crashing():
    from datapilot_analysis.tools import analyze_csv_tool

    assert analyze_csv_tool.invoke({"csv_text": "a,a\n1,2"})["ok"] is False
    assert analyze_csv_tool.invoke({"csv_text": CSV})["ok"] is True
