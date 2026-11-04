"""Explicit field mappings, calendar-month metrics and additive change analysis."""

import json
import math
import re
from collections import defaultdict
from datetime import date, datetime

from datapilot_analysis.datasets import DatasetError


def source_of(metadata):
    return {k: metadata[k] for k in ("id", "name", "sheet", "sha256", "row_count")}


def bounded_result(result):
    # Content and artifact both travel in the host's 64 KiB envelope.
    if (
        len(json.dumps(result, ensure_ascii=False, allow_nan=False).encode())
        > 29 * 1024
    ):
        raise DatasetError("分析结果过大，请缩短月份范围或减少分组类别。")
    return result


def _month(value):
    if not isinstance(value, str):
        raise ValueError("not a date")
    text = value.strip()
    match = re.fullmatch(r"(\d{4})(?:[-/]|年)(\d{1,2})月?", text)
    if match:
        parsed = date(int(match[1]), int(match[2]), 1)
    elif re.fullmatch(r"\d{4}/\d{1,2}/\d{1,2}", text):
        parsed = datetime.strptime(text, "%Y/%m/%d").date()
    elif re.fullmatch(r"\d{4}-\d{2}-\d{2}(?:[T ].+)?", text):
        parsed = datetime.fromisoformat(text).date()
    else:
        raise ValueError("ambiguous date")
    return f"{parsed.year:04d}-{parsed.month:02d}"


def _period(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}", value):
        raise DatasetError("月份参数须明确为 YYYY-MM，不能只填写‘10月’。")
    try:
        return _month(value)
    except ValueError:
        raise DatasetError("月份参数无效，请使用 YYYY-MM。") from None


def _previous(month):
    year, number = map(int, month.split("-"))
    return (
        f"{year if number > 1 else year - 1:04d}-{number - 1 if number > 1 else 12:02d}"
    )


def _months(first, last):
    year, month = map(int, first.split("-"))
    end_year, end_month = map(int, last.split("-"))
    count = (end_year - year) * 12 + end_month - month + 1
    if not 1 <= count <= 24:
        raise DatasetError(
            "一次分析支持 1 到 24 个连续月份，请明确 from_month / to_month。"
        )
    return [
        f"{(year * 12 + month - 1 + i) // 12:04d}-{(month - 1 + i) % 12 + 1:02d}"
        for i in range(count)
    ]


def _finite(value):
    if value is not None and not math.isfinite(value):
        raise DatasetError("指标超出数值范围，请缩小分析范围。")
    return value


def _sum(values):
    try:
        return _finite(math.fsum(values))
    except OverflowError:
        raise DatasetError("指标超出数值范围，请缩小分析范围。") from None


def _metrics(rows, revenue, cost):
    missing_revenue = sum(row[revenue] is None for row in rows)
    missing_cost = sum(row[cost] is None for row in rows) if cost is not None else None
    sales = _sum(row[revenue] for row in rows) if rows and not missing_revenue else None
    expense = (
        _sum(row[cost] for row in rows)
        if rows and cost is not None and not missing_cost
        else None
    )
    profit = (
        _finite(sales - expense) if sales is not None and expense is not None else None
    )
    margin = _finite(profit / sales * 100) if profit is not None and sales > 0 else None
    return {
        "rows": len(rows),
        "revenue": sales,
        "cost": expense,
        "profit": profit,
        "profit_margin_percent": margin,
        "missing_revenue": missing_revenue,
        "missing_cost": missing_cost,
    }


def analyze_business(metadata, rows, request):
    allowed = {
        "date_column",
        "revenue_column",
        "cost_column",
        "dimension_column",
        "unit",
        "from_month",
        "to_month",
        "current_month",
        "base_month",
    }
    if not isinstance(request, dict) or set(request) - allowed:
        raise DatasetError("经营分析参数无效；不接受原始 SQL、代码或自定义公式。")
    columns = {c["name"]: c["type"] for c in metadata["columns"]}
    names = list(columns)

    def field(key, numeric=False, optional=False):
        value = request.get(key)
        if optional and value is None:
            return None
        if not isinstance(value, str) or value not in columns:
            raise DatasetError(f"{key} 字段不存在，请先查看结构并确认字段映射。")
        if numeric and columns[value] not in ("number", "empty"):
            raise DatasetError(f"{key} 必须是数值字段。")
        return names.index(value)

    dt, revenue = field("date_column"), field("revenue_column", numeric=True)
    cost = field("cost_column", numeric=True, optional=True)
    dimension = field("dimension_column", optional=True)
    chosen = [i for i in (dt, revenue, cost, dimension) if i is not None]
    if len(chosen) != len(set(chosen)):
        raise DatasetError("日期、销售额、成本和分组字段不能重复。")
    unit = request.get("unit", "原始数值")
    if not isinstance(unit, str) or not 1 <= len(unit.strip()) <= 20:
        raise DatasetError("单位必须是 1 到 20 个字符，请按原始数据确认。")
    dated, invalid, missing = [], [], 0
    for row in rows:
        if row[dt] is None:
            missing += 1
            continue
        try:
            dated.append((_month(row[dt]), row))
        except ValueError:
            invalid.append(str(row[dt])[:40])
    if invalid:
        raise DatasetError(
            f"日期字段有 {len(invalid)} 条无效或歧义日期，例如 {invalid[:3]}；请使用 YYYY-MM、YYYY-MM-DD 或年在前的日期。"
        )
    if not dated:
        raise DatasetError("没有可分析的有效日期数据。")
    first = (
        _period(request["from_month"])
        if "from_month" in request
        else min(m for m, _ in dated)
    )
    last = (
        _period(request["to_month"])
        if "to_month" in request
        else max(m for m, _ in dated)
    )
    months = _months(first, last)
    scoped = [(m, row) for m, row in dated if first <= m <= last]
    if not scoped:
        raise DatasetError("所选月份范围没有数据。")
    current = (
        _period(request["current_month"])
        if "current_month" in request
        else max(m for m, _ in scoped)
    )
    base = (
        _period(request["base_month"])
        if "base_month" in request
        else _previous(current)
    )
    if current == base:
        raise DatasetError("本期与基期月份不能相同。")
    monthly = defaultdict(list)
    for month, row in scoped:
        monthly[month].append(row)
    totals = _metrics([row for _, row in scoped], revenue, cost)
    trend = [{"month": m, **_metrics(monthly[m], revenue, cost)} for m in months]
    now, before = [_metrics(monthly[m], revenue, cost) for m in (current, base)]
    a, b = now["revenue"], before["revenue"]
    delta = _finite(a - b) if a is not None and b is not None else None
    growth = _finite(delta / b * 100) if delta is not None and b > 0 else None
    reason = (
        "月份无样本、不在分析范围内或销售额存在缺失，不能进行完整对比。"
        if delta is None
        else "基期销售额为零或负数，增长率不适用。"
        if b <= 0
        else None
    )
    contributions = []
    if dimension is not None and delta is not None:
        groups = set(row[dimension] for m in (current, base) for row in monthly[m])
        if len(groups) > 50:
            raise DatasetError("贡献分析最多支持 50 个类别，请选择更粗的分组字段。")
        for label in sorted(groups, key=lambda v: (v is None, str(v))):
            values = [
                _sum(row[revenue] for row in monthly[m] if row[dimension] == label)
                for m in (current, base)
            ]
            change = _finite(values[0] - values[1])
            contributions.append(
                {
                    "label": None if label is None else str(label),
                    "current": values[0],
                    "base": values[1],
                    "delta": change,
                    "share_percent": _finite(change / delta * 100) if delta else None,
                }
            )
        contributions.sort(key=lambda row: -row["delta"])
    warnings = []
    if missing:
        warnings.append(f"{missing} 行日期缺失，未纳入分析。")
    if totals["missing_revenue"]:
        warnings.append("销售额存在缺失；相关合计、增长率和贡献不会按零补齐。")
    if cost is None:
        warnings.append("未选择成本字段，不计算成本、利润和利润率。")
    elif totals["missing_cost"]:
        warnings.append("成本存在缺失，受影响的成本、利润和利润率显示为无法计算。")
    if reason:
        warnings.append(reason)
    charts = [
        {
            "type": "line",
            "title": "月度销售额趋势",
            "x_label": "月份",
            "y_label": unit.strip(),
            "points": [
                {"label": row["month"], "value": row["revenue"]} for row in trend
            ],
        }
    ]
    if contributions:
        charts.append(
            {
                "type": "bar",
                "title": f"销售额变化贡献：{base} → {current}",
                "x_label": request["dimension_column"],
                "y_label": unit.strip(),
                "points": [
                    {
                        "label": row["label"]
                        if row["label"] is not None
                        else "（空值）",
                        "value": row["delta"],
                    }
                    for row in contributions
                ],
            }
        )
    return bounded_result(
        {
            "version": 1,
            "kind": "business",
            "source": source_of(metadata),
            "mapping": {
                "date_column": request["date_column"],
                "revenue_column": request["revenue_column"],
                "cost_column": request.get("cost_column"),
                "dimension_column": request.get("dimension_column"),
                "unit": unit.strip(),
            },
            "scope": {
                "from_month": first,
                "to_month": last,
                "included_rows": len(scoped),
                "missing_date_rows": missing,
                "outside_range_rows": len(dated) - len(scoped),
            },
            "totals": totals,
            "trend": trend,
            "comparison": {
                "current_month": current,
                "base_month": base,
                "current": now,
                "base": before,
                "delta": delta,
                "growth_percent": growth,
                "reason": reason,
                "contributions": contributions,
            },
            "charts": charts,
            "warnings": warnings,
            "methodology": [
                "利润仅为所选销售额减所选成本；不自动包含退款、税费或运费。",
                "利润率=(销售额−成本)/销售额×100%，销售额须为正。",
                "增长率=(本期销售额−基期销售额)/基期销售额×100%，基期须为正。",
                "贡献=该分组本期销售额−基期销售额；贡献占比=分组变化/总变化，可能为负或大于100%。",
                "默认本期为范围内最新有数据月份，基期为上一个日历月；范围外样本不参与计算。",
                "月份没有记录时保留空缺，数值字段缺失时不补零；分组在某期无记录时按该期零销售额比较。",
                "这些是描述性变化，不能据此证明业务因果关系。",
            ],
        }
    )
