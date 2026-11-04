"""Bounded CSV calculations. No model, network, filesystem or code execution."""

import csv
import io
import math
from collections import defaultdict

MAX_BYTES = 200_000
MAX_ROWS = 10_000
MAX_COLUMNS = 50
MAX_GROUPS = 50
OPERATIONS = {"sum", "mean", "count", "min", "max"}


def _number(value: str) -> float | None:
    try:
        number = float(value)
    except ValueError:
        return None
    if not math.isfinite(number):
        raise ValueError("NaN and Infinity are not accepted as numeric values.")
    return number


def _stats(values: list[float]) -> dict:
    if not values:
        return {"sum": None, "mean": None, "min": None, "max": None}
    try:
        total = math.fsum(values)
    except OverflowError as exc:
        raise ValueError("Numeric total exceeds the supported range.") from exc
    if not math.isfinite(total):
        raise ValueError("Numeric total exceeds the supported range.")
    return {
        "sum": total,
        "mean": total / len(values),
        "min": min(values),
        "max": max(values),
    }


def analyze_csv(
    csv_text: str,
    *,
    group_by: str | None = None,
    metric: str | None = None,
    aggregation: str = "sum",
) -> dict:
    """Profile a comma-separated UTF-8 table and optionally aggregate a numeric column."""
    if len(csv_text.encode("utf-8")) > MAX_BYTES:
        raise ValueError("CSV must be at most 200,000 UTF-8 bytes.")
    if aggregation not in OPERATIONS:
        raise ValueError("Aggregation must be sum, mean, count, min or max.")
    reader = csv.reader(io.StringIO(csv_text.lstrip("\ufeff"), newline=""), strict=True)
    try:
        headers = [cell.strip() for cell in next(reader, [])]
        if (
            not headers
            or any(not h for h in headers)
            or len(set(headers)) != len(headers)
        ):
            raise ValueError("CSV headers must be non-empty and unique.")
        if len(headers) > MAX_COLUMNS:
            raise ValueError("CSV supports at most 50 columns.")
        rows = []
        for row in reader:
            if not row:
                continue
            if len(row) != len(headers):
                raise ValueError(
                    "Every row must have the same number of fields as the header."
                )
            rows.append([v.strip() for v in row])
            if len(rows) > MAX_ROWS:
                raise ValueError("CSV supports at most 10,000 rows.")
    except csv.Error as exc:
        raise ValueError("CSV quoting or field syntax is invalid.") from exc

    columns = {}
    numeric_columns = {}
    for index, name in enumerate(headers):
        present = [row[index] for row in rows if row[index] != ""]
        numbers = [_number(v) for v in present]
        is_numeric = bool(present) and all(v is not None for v in numbers)
        column = {
            "type": "number" if is_numeric else "text" if present else "empty",
            "missing": len(rows) - len(present),
            "non_empty": len(present),
        }
        if is_numeric:
            numeric_columns[name] = True
            column.update(_stats(numbers))
        columns[name] = column

    output = {"row_count": len(rows), "column_count": len(headers), "columns": columns}
    if group_by is None and metric is None:
        return output
    if not group_by or not metric or group_by not in headers or metric not in headers:
        raise ValueError(
            "Grouping requires both an existing group_by and metric column."
        )
    if metric not in numeric_columns:
        raise ValueError(
            "The metric column must contain numeric values and may contain empty cells."
        )
    groups = defaultdict(list)
    missing = defaultdict(int)
    group_index, metric_index = headers.index(group_by), headers.index(metric)
    for row in rows:
        key = row[group_index] or None
        groups[key]
        if len(groups) > MAX_GROUPS:
            raise ValueError("Grouping supports at most 50 distinct groups.")
        if row[metric_index] == "":
            missing[key] += 1
        else:
            groups[key].append(_number(row[metric_index]))
    output.update(group_by=group_by, metric=metric, aggregation=aggregation)
    output["groups"] = [
        {
            "group": key,
            "value": len(values)
            if aggregation == "count"
            else _stats(values)[aggregation],
            "valid_count": len(values),
            "missing_count": missing[key],
        }
        for key, values in groups.items()
    ]
    return output
