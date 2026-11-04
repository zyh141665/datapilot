"""Wire local DataPilot tools without reading or printing API credentials.

Run from any directory with the backend Python after installing dependencies.
Only inserts public tool/group declarations; other configuration bytes are kept.
"""

from pathlib import Path
import json
import re
import textwrap

import yaml


ROOT = Path(__file__).resolve().parents[1]


def add_entry(text: str, key: str, marker: str, entry: str) -> str:
    if marker in text:
        return text
    match = re.search(rf"^{key}:[ \t]*(?:#.*)?$", text, re.MULTILINE)
    if match:
        tail = text[match.end() :]
        next_line = next(
            (
                line
                for line in tail.splitlines()
                if line.strip() and not line.lstrip().startswith("#")
            ),
            "",
        )
        if next_line.lstrip().startswith("-"):
            indent = next_line[: len(next_line) - len(next_line.lstrip())]
            entry = textwrap.indent(textwrap.dedent(entry), indent)
        return text[: match.end()] + "\n" + entry.rstrip() + text[match.end() :]
    if re.search(rf"^{key}:", text, re.MULTILINE):
        raise ValueError(
            f"{key} uses inline YAML; merge datapilot.config.yaml manually."
        )
    return text.rstrip() + f"\n\n{key}:\n" + entry


def configure(text: str) -> str:
    text = add_entry(text, "tool_groups", "name: datapilot", "  - name: datapilot\n")
    text = add_entry(
        text,
        "tools",
        "datapilot_analysis.tools:analyze_csv_tool",
        "  - name: analyze_csv\n    group: datapilot\n    use: datapilot_analysis.tools:analyze_csv_tool\n",
    )
    storage = json.dumps(
        str(ROOT / "backend" / ".deer-flow" / "data" / "datapilot.sqlite"),
        ensure_ascii=True,
    )
    text = add_entry(
        text,
        "plugins",
        "datapilot_analysis.plugin:install",
        "  - use: datapilot_analysis.plugin:install\n    enabled: true\n    required: true\n    config:\n      enabled: true\n      storage_path: "
        + storage
        + "\n",
    )
    try:
        yaml.safe_load(text)
    except yaml.YAMLError:
        raise ValueError(
            "Configuration YAML is invalid; no file has been written."
        ) from None
    return text


if __name__ == "__main__":
    target = ROOT / "config.yaml"
    if not target.is_file():
        raise SystemExit("Create config.yaml with make setup first.")
    original = target.read_text(encoding="utf-8")
    updated = configure(original)
    if updated != original:
        # A private local backup is ignored by Git and never printed.
        backup = ROOT / "config.yaml.datapilot-backup"
        if not backup.exists():
            backup.write_text(original, encoding="utf-8")
        target.write_text(updated, encoding="utf-8")
    print("DataPilot tool declarations ready. Restart Gateway to load the tool.")
