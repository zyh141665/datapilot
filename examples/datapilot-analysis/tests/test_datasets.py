import io
import json

import pytest
from openpyxl import Workbook

from datapilot_analysis.datasets import DatasetError, DatasetStore


CSV = b"region,revenue,cost\nEast,100,60\nWest,200,90\nEast,50,\n"


@pytest.fixture
def store(tmp_path):
    return DatasetStore(tmp_path / "datasets.sqlite")


def upload(store, owner="alice"):
    return store.import_file(owner, "sales.csv", CSV)


def test_persistence_and_ownership(store):
    item = upload(store)
    restored = DatasetStore(store.path)
    assert restored.profile("alice", item["id"])["row_count"] == 3
    assert restored.list("bob") == []
    with pytest.raises(DatasetError):
        restored.profile("bob", item["id"])


def test_thread_binding_is_immutable_and_owner_scoped(store):
    item = upload(store)
    store.bind("alice", "thread-1", item["id"])
    assert store.selected("alice", "thread-1")["id"] == item["id"]
    store.bind("alice", "thread-1", item["id"])
    other = upload(store)
    with pytest.raises(DatasetError):
        store.bind("alice", "thread-1", other["id"])
    with pytest.raises(DatasetError):
        store.selected("bob", "thread-1")
    with pytest.raises(DatasetError):
        store.bind("bob", "thread-1", item["id"])


def test_query_filters_grouping_and_provenance(store):
    item = upload(store)
    store.bind("alice", "t", item["id"])
    result = store.query(
        "alice",
        "t",
        {
            "metric": "revenue",
            "aggregation": "sum",
            "group_by": ["region"],
            "order_by": "value",
            "descending": True,
        },
    )
    assert result["rows"] == [
        {"region": "West", "value": 200.0},
        {"region": "East", "value": 150.0},
    ]
    assert result["source"]["sha256"] == item["sha256"]
    filtered = store.query(
        "alice",
        "t",
        {
            "filters": [{"column": "revenue", "op": "gte", "value": 100}],
            "select": ["region", "revenue"],
        },
    )
    assert len(filtered["rows"]) == 2
    count = store.query("alice", "t", {"aggregation": "count"})
    assert count["rows"] == [{"value": 3}]


@pytest.mark.parametrize(
    "query",
    [
        {"sql": "DROP TABLE datasets"},
        {"select": ["region; DROP TABLE x"]},
        {"limit": 1000},
        {"limit": True},
        {"metric": "region", "aggregation": "sum"},
        {"aggregation": "execute", "metric": "revenue"},
        {"filters": [{"column": "revenue", "op": "exec", "value": 1}]},
    ],
)
def test_query_rejects_invalid_inputs(store, query):
    item = upload(store)
    store.bind("alice", "t", item["id"])
    with pytest.raises(DatasetError):
        store.query("alice", "t", query)


def test_limit_and_missing_cells(store):
    item = upload(store)
    assert item["missing_count"] == 1
    store.bind("alice", "t", item["id"])
    result = store.query("alice", "t", {"limit": 1})
    assert len(result["rows"]) == 1 and result["has_more"]


def excel_bytes(*, formula=False, multiple=False):
    book = Workbook()
    book.active.title = "销售"
    book.active.append(["区域", "金额"])
    book.active.append(["华东", "=1+1" if formula else 12.5])
    if multiple:
        book.create_sheet("退款").append(["订单", "金额"])
    target = io.BytesIO()
    book.save(target)
    book.close()
    return target.getvalue()


def test_xlsx_sheet_selection_and_values(store):
    data = excel_bytes(multiple=True)
    choices = store.import_file("alice", "sales.xlsx", data)
    assert choices["requires_sheet"] and choices["sheets"] == ["销售", "退款"]
    assert store.list("alice") == []
    item = store.import_file("alice", "sales.xlsx", data, sheet="销售")
    assert item["sheet"] == "销售" and item["row_count"] == 1
    assert store.profile("alice", item["id"])["preview"][0]["金额"] == 12.5


def test_formula_requires_explicit_values(store):
    with pytest.raises(DatasetError, match="公式"):
        store.import_file("alice", "formula.xlsx", excel_bytes(formula=True))


@pytest.mark.parametrize(
    "filename,data",
    [
        ("x.xls", CSV),
        ("x.csv", b"a,a\n1,2"),
        ("x.csv", b"Amount,amount\n1,2"),
        ("x.csv", b"a,b\n1"),
        ("x.csv", b"a\n\xff"),
        ("x.csv", b"a\nNaN"),
        ("x.xlsx", b"not a workbook"),
    ],
)
def test_invalid_imports_are_not_saved(store, filename, data):
    with pytest.raises(DatasetError):
        store.import_file("alice", filename, data)
    assert store.list("alice") == []


def test_numeric_identifiers_and_null_group_names_are_preserved(store):
    item = store.import_file("alice", "ids.csv", b"id,amount\n001,3\n002,4")
    assert item["columns"][0]["type"] == "text"
    store.bind("alice", "t", item["id"])
    assert store.query("alice", "t", {"select": ["id"]})["rows"][0]["id"] == "001"


def test_query_handles_quotes_and_like_wildcards_as_data(store):
    item = store.import_file("alice", "names.csv", b"name,value\n100% off,2\nother,3\n")
    store.bind("alice", "t", item["id"])
    result = store.query(
        "alice", "t", {"filters": [{"column": "name", "op": "contains", "value": "%"}]}
    )
    assert result["rows"] == [{"name": "100% off", "value": 2.0}]


def test_model_profile_is_bounded_even_for_wide_unicode_data(store):
    headers = [str(i) + "数" * 98 for i in range(50)]
    content = (",".join(headers) + "\n" + ",".join(["值" * 1024] * 50)).encode()
    item = store.import_file("alice", "wide.csv", content)
    store.bind("alice", "t", item["id"])
    result = store.selected("alice", "t")
    assert (
        len(json.dumps({"ok": True, "data": result}, ensure_ascii=False).encode())
        < 64 * 1024
    )
    assert len(result["preview"][0]) == 10
    assert all(len(v) == 40 for v in result["preview"][0].values())
