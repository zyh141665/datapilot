"""Model-visible tools: data is parsed, never evaluated as code."""

from typing import Literal

from langchain_core.tools import tool

from datapilot_analysis.analysis import analyze_csv


@tool("analyze_csv", parse_docstring=True)
def analyze_csv_tool(
    csv_text: str,
    group_by: str | None = None,
    metric: str | None = None,
    aggregation: Literal["sum", "mean", "count", "min", "max"] = "sum",
) -> dict:
    """Compute CSV data quality and numeric statistics using deterministic Python calculations.

    Use for small CSV tables supplied by the user or read from their attachments.
    Returns row/column counts, missing values, numeric statistics and optional grouped results.
    Maximum 200,000 UTF-8 bytes, 10,000 rows, 50 columns and 50 groups.
    Empty metric cells are excluded from calculations and reported as missing.
    This tool does not read paths, execute code, infer business causes or perform forecasting.

    Args:
        csv_text: Actual comma-separated CSV content including a unique non-empty header row, not a file path.
        group_by: Optional existing column used to group records. Supply together with metric.
        metric: Optional numeric column to aggregate. Supply together with group_by.
        aggregation: Aggregation: sum, mean, count of non-empty metric cells, min or max.
    """
    try:
        return {
            "ok": True,
            "data": analyze_csv(
                csv_text, group_by=group_by, metric=metric, aggregation=aggregation
            ),
        }
    except ValueError as exc:
        return {
            "ok": False,
            "error": str(exc),
            "action": "Correct the CSV or requested columns before retrying.",
        }
