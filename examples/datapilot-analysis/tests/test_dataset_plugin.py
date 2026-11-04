import asyncio

import pytest
from deerflow_extension_api import ActionContext, ExtensionPrincipal, ToolContext
from fastapi import FastAPI
from fastapi.testclient import TestClient

from datapilot_analysis.datasets import DatasetStore
from datapilot_analysis.plugin import DatasetPlugin


@pytest.fixture
def plugin(tmp_path):
    return DatasetPlugin(DatasetStore(tmp_path / "test.sqlite"))


def client_for(plugin, user):
    app = FastAPI()
    app.state.deerflow_extension_principal_resolver = lambda req: (
        ExtensionPrincipal(user) if user else None
    )
    app.include_router(plugin.router())
    return TestClient(app)


def test_upload_and_user_isolation_through_real_routes(plugin):
    alice, bob, guest = [client_for(plugin, user) for user in ("alice", "bob", None)]
    assert guest.get("/api/datapilot/datasets").status_code == 401
    response = alice.post(
        "/api/datapilot/datasets?filename=sales.csv",
        content=b"region,revenue\nEast,30\n",
    )
    assert response.status_code == 200
    identifier = response.json()["id"]
    assert len(alice.get("/api/datapilot/datasets").json()["items"]) == 1
    assert bob.get("/api/datapilot/datasets").json()["items"] == []
    assert bob.get(f"/api/datapilot/datasets/{identifier}").status_code == 404
    assert (
        alice.post(
            "/api/datapilot/datasets?filename=bad.csv", content=b"a,a\n1,2"
        ).status_code
        == 422
    )


def test_binding_rechecks_host_thread_authorization(plugin):
    identifier = plugin.store.import_file("alice", "x.csv", b"a\n1")["id"]

    class Denied:
        async def get_state(self, **kwargs):
            raise PermissionError("not your thread")

    context = ActionContext(ExtensionPrincipal("alice"), {}, agent_runs=Denied())
    with pytest.raises(PermissionError):
        asyncio.run(
            plugin.bind({"thread_id": "foreign", "dataset_id": identifier}, context)
        )
    assert (
        asyncio.run(
            plugin.describe({}, ToolContext(ExtensionPrincipal("alice"), {}, "foreign"))
        )["ok"]
        is False
    )


def test_end_to_end_bind_describe_and_query_without_a_model(plugin):
    alice = client_for(plugin, "alice")
    identifier = alice.post(
        "/api/datapilot/datasets?filename=sales.csv",
        content=b"region,revenue\nEast,10\nEast,20\nWest,50",
    ).json()["id"]

    class Allowed:
        async def get_state(self, **kwargs):
            return {"values": {}}

    action = ActionContext(ExtensionPrincipal("alice"), {}, agent_runs=Allowed())
    asyncio.run(plugin.bind({"thread_id": "t", "dataset_id": identifier}, action))
    context = ToolContext(ExtensionPrincipal("alice"), {}, "t")
    assert asyncio.run(plugin.describe({}, context))["data"]["row_count"] == 3
    assert asyncio.run(
        plugin.query({"metric": "revenue", "aggregation": "sum"}, context)
    )["data"]["rows"] == [{"value": 80.0}]
    bob = ToolContext(ExtensionPrincipal("bob"), {}, "t")
    assert asyncio.run(plugin.query({"aggregation": "count"}, bob))["ok"] is False


def test_disabled_plugin_routes_are_closed(plugin):
    plugin.enabled = False
    assert client_for(plugin, "alice").get("/api/datapilot/datasets").status_code == 403


def test_route_rejects_an_account_switch_during_upload(plugin):
    response = client_for(plugin, "bob").post(
        "/api/datapilot/datasets?filename=x.csv",
        content=b"a\n1",
        headers={"X-DeerFlow-Plugin-Viewer": "alice"},
    )
    assert response.status_code == 409
    assert plugin.store.list("bob") == []


def test_real_host_tool_wrapper_preserves_owner_and_thread(plugin):
    from deerflow.extensions.plugin_tools import _build_tool
    from langchain.tools import ToolRuntime

    identifier = plugin.store.import_file(
        "alice", "sales.csv", b"region,revenue\nEast,10\nWest,20"
    )["id"]
    plugin.store.bind("alice", "t", identifier)
    contribution = plugin.contribution()
    declaration = next(t for t in contribution.tools if t.name == "query_dataset")
    tool = _build_tool("datapilot_analysis.plugin:install", contribution, declaration)

    def runtime(owner):
        return ToolRuntime(
            state={},
            context={"user_id": owner, "thread_id": "t"},
            config={"configurable": {"user_id": owner}},
            stream_writer=lambda event: None,
            tool_call_id="call-test",
            store=None,
        )

    import json

    result = json.loads(
        asyncio.run(
            tool.coroutine(runtime("alice"), metric="revenue", aggregation="sum")
        )
    )
    assert result["data"]["rows"] == [{"value": 30.0}]
    other = json.loads(asyncio.run(tool.coroutine(runtime("bob"), aggregation="count")))
    assert other["ok"] is False


def test_business_route_and_model_artifact_share_computed_results(plugin):
    import json

    from deerflow_extension_api import PluginToolResult

    alice, bob = client_for(plugin, "alice"), client_for(plugin, "bob")
    item = alice.post(
        "/api/datapilot/datasets?filename=sales.csv",
        content=b"month,revenue,cost\n2026-09,100,60\n2026-10,150,80",
    ).json()
    mapping = {
        "date_column": "month",
        "revenue_column": "revenue",
        "cost_column": "cost",
    }
    response = alice.post(
        f"/api/datapilot/datasets/{item['id']}/analysis", json=mapping
    )
    assert response.status_code == 200
    assert response.json()["comparison"]["growth_percent"] == 50
    assert (
        bob.post(
            f"/api/datapilot/datasets/{item['id']}/analysis", json=mapping
        ).status_code
        == 404
    )
    plugin.store.bind("alice", "t", item["id"])
    context = ToolContext(ExtensionPrincipal("alice"), {}, "t")
    result = asyncio.run(plugin.business(mapping, context))
    assert isinstance(result, PluginToolResult)
    assert result.artifact["datapilot_analysis"] == response.json()
    assert json.loads(result.content)["data"] == response.json()
    assert (
        len(
            json.dumps(
                {"content": result.content, "artifact": result.artifact},
                ensure_ascii=False,
            ).encode()
        )
        < 64 * 1024
    )
    denied = asyncio.run(
        plugin.business(mapping, ToolContext(ExtensionPrincipal("bob"), {}, "t"))
    )
    assert denied.artifact is None
    assert json.loads(denied.content)["ok"] is False


def test_chart_tool_schema_and_real_host_artifact_envelope(plugin):
    import json

    from deerflow.extensions.plugin_tools import _build_tool
    from jsonschema import Draft202012Validator
    from langchain.tools import ToolRuntime

    item = plugin.store.import_file(
        "alice", "sales.csv", b"region,revenue\nEast,10\nWest,20"
    )
    plugin.store.bind("alice", "t", item["id"])
    contribution = plugin.contribution()
    declaration = next(
        t for t in contribution.tools if t.name == "create_dataset_chart"
    )
    assert not Draft202012Validator(declaration.input_schema).is_valid(
        {"x": "region", "values": [100]}
    )
    tool = _build_tool("datapilot_analysis.plugin:install", contribution, declaration)
    runtime = ToolRuntime(
        state={},
        context={"user_id": "alice", "thread_id": "t"},
        config={"configurable": {"user_id": "alice"}},
        stream_writer=lambda event: None,
        tool_call_id="chart-test",
        store=None,
    )
    content, artifact = asyncio.run(
        tool.coroutine(runtime, x="region", metric="revenue")
    )
    assert json.loads(content)["data"]["chart"]["points"][0] == {
        "label": "West",
        "value": 20,
    }
    assert artifact["datapilot_analysis"]["source"]["id"] == item["id"]
    assert tool.response_format == "content_and_artifact"


def test_frontend_tool_names_match_actual_host_names(plugin):
    from pathlib import Path

    from deerflow.extensions.plugin_tools import plugin_tool_name

    frontend = (
        Path(__file__).parents[3] / "frontend/src/core/datapilot/analysis.ts"
    ).read_text(encoding="utf-8")
    for name in ("analyze_business", "create_dataset_chart"):
        assert plugin_tool_name(plugin.contribution().namespace, name) in frontend


def test_generic_chart_route_and_server_timing(plugin):
    alice = client_for(plugin, "alice")
    item = alice.post(
        "/api/datapilot/datasets?filename=telemetry.csv",
        content=b"time_slot,value\n1,10\n1,20\n2,40",
    ).json()
    response = alice.post(
        f"/api/datapilot/datasets/{item['id']}/chart",
        json={
            "x": "time_slot",
            "metric": "value",
            "aggregation": "mean",
            "kind": "line",
        },
    )
    assert response.status_code == 200
    assert response.json()["chart"]["points"][0]["value"] == 15
    assert response.headers["server-timing"].startswith("datapilot;dur=")
    assert (
        client_for(plugin, "bob")
        .post(f"/api/datapilot/datasets/{item['id']}/chart", json={"x": "time_slot"})
        .status_code
        == 404
    )
