import importlib.util
from pathlib import Path

import yaml


spec = importlib.util.spec_from_file_location(
    "datapilot_setup", Path(__file__).parents[3] / "scripts/datapilot_setup.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_setup_is_idempotent_and_preserves_existing_settings():
    original = "# keep comment\nmodels:\n  - name: demo\n    api_key: $DEMO_KEY\ntools:\n  - name: existing\n    group: search\n    use: example:tool\ntool_groups:\n  - name: search\n"
    changed = module.configure(original)
    assert module.configure(changed) == changed
    parsed = yaml.safe_load(changed)
    assert parsed["models"][0]["api_key"] == "$DEMO_KEY"
    assert {t["name"] for t in parsed["tools"]} == {"existing", "analyze_csv"}
    assert "# keep comment" in changed
    assert parsed["plugins"][0]["use"] == "datapilot_analysis.plugin:install"
    assert Path(parsed["plugins"][0]["config"]["storage_path"]).is_absolute()


def test_indentless_yaml_sequences_from_setup_wizard():
    original = "tool_groups:\n- name: web\ntools:\n- name: search\n  group: web\n  use: existing:search\n"
    parsed = yaml.safe_load(module.configure(original))
    assert len(parsed["tools"]) == 2
    assert len(parsed["tool_groups"]) == 2
