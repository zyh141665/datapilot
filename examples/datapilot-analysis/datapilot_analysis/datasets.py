"""Owner-scoped immutable datasets and bounded, parameterized analytical queries."""

import csv
import hashlib
import io
import json
import math
import re
import sqlite3
import uuid
import zipfile
from contextlib import closing
from datetime import date, datetime
from pathlib import Path

from openpyxl import load_workbook

MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_ROWS = 10_000
MAX_COLUMNS = 50
MAX_DATA_BYTES = 8 * 1024 * 1024


class DatasetError(ValueError):
    """An actionable input or availability error safe to return to the user."""


def _json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False)


def _identifier(name):
    return '"' + name.replace('"', '""') + '"'


def _numeric(value):
    if isinstance(value, str) and re.fullmatch(r"[+-]?0\d+", value):
        return None  # Preserve identifiers such as 001.
    try:
        number = float(value)
    except (ValueError, TypeError):
        return None
    if not math.isfinite(number):
        raise DatasetError("数据含 NaN 或 Infinity，请先更正。")
    return number


def _cell(value):
    if value is None or value == "":
        return None
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        value = value.strip() or None
    if value is not None and len(str(value)) > 1024:
        raise DatasetError("单元格内容超过 1,024 字符，请缩短后导入。")
    return value


def _normalize(headers, rows):
    headers = [str(v).strip() if v is not None else "" for v in headers]
    if (
        not headers
        or any(not h or len(h) > 100 for h in headers)
        or len({h.casefold() for h in headers}) != len(headers)
    ):
        raise DatasetError("列名必须唯一、非空，且不超过 100 字符。")
    if len(headers) > MAX_COLUMNS:
        raise DatasetError("最多支持 50 列。")
    columns = []
    for index, name in enumerate(headers):
        present = [r[index] for r in rows if r[index] is not None]
        numbers = [_numeric(v) for v in present]
        numeric = bool(present) and all(n is not None for n in numbers)
        column = {
            "name": name,
            "type": "number" if numeric else "text" if present else "empty",
            "missing": len(rows) - len(present),
        }
        if numeric:
            try:
                total = math.fsum(numbers)
            except OverflowError:
                raise DatasetError("数值总和超出支持范围。") from None
            if not math.isfinite(total):
                raise DatasetError("数值总和超出支持范围。")
            column.update(
                sum=total, mean=total / len(numbers), min=min(numbers), max=max(numbers)
            )
            for row in rows:
                if row[index] is not None:
                    row[index] = float(row[index])
        columns.append(column)
    if len(_json(rows).encode()) > MAX_DATA_BYTES:
        raise DatasetError("解析后的数据超过 8 MiB，请拆分文件。")
    return headers, columns


def parse_file(filename, content, sheet=None):
    if (
        not isinstance(filename, str)
        or not 0 < len(filename) <= 160
        or not content
        or len(content) > MAX_FILE_BYTES
    ):
        raise DatasetError("文件名无效、文件为空或超过 5 MiB。")
    suffix = Path(filename).suffix.lower()
    if suffix == ".csv":
        if sheet is not None:
            raise DatasetError("CSV 不支持选择工作表。")
        try:
            reader = csv.reader(
                io.StringIO(content.decode("utf-8-sig"), newline=""), strict=True
            )
            headers = next(reader, [])
            rows = []
            for raw in reader:
                if not raw:
                    continue
                if len(raw) != len(headers):
                    raise DatasetError("数据行的列数与表头不一致。")
                rows.append([_cell(v) for v in raw])
                if len(rows) > MAX_ROWS:
                    raise DatasetError("最多支持 10,000 行。")
        except (UnicodeError, csv.Error):
            raise DatasetError("请使用 UTF-8 编码且引号格式正确的 CSV。") from None
        sheet_name = None
    elif suffix == ".xlsx":
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                if (
                    len(archive.infolist()) > 2000
                    or sum(i.file_size for i in archive.infolist()) > 30 * 1024 * 1024
                ):
                    raise DatasetError("工作簿解压体积过大，请拆分文件。")
            book = load_workbook(
                io.BytesIO(content), read_only=True, data_only=False, keep_links=False
            )
            try:
                names = book.sheetnames
                if len(names) > 20:
                    raise DatasetError("最多支持 20 个工作表的工作簿。")
                if sheet is None and len(names) > 1:
                    return {"requires_sheet": True, "sheets": names}
                sheet_name = sheet or names[0]
                if sheet_name not in names:
                    raise DatasetError("所选工作表不存在。")
                page = book[sheet_name]
                if (page.max_column or 0) > MAX_COLUMNS or (
                    page.max_row or 0
                ) > MAX_ROWS + 1:
                    raise DatasetError(
                        "工作表最多支持 50 列、10,000 行；请清理多余格式或拆分。"
                    )
                iterator = page.iter_rows()
                first = next(iterator, ())
                headers = [c.value for c in first]
                if any(c.data_type == "f" for c in first):
                    raise DatasetError("工作表含公式，请先复制并粘贴为值后导入。")
                rows = []
                for raw in iterator:
                    if any(c.data_type == "f" for c in raw):
                        raise DatasetError("工作表含公式，请先复制并粘贴为值后导入。")
                    row = [_cell(c.value) for c in raw]
                    if any(v is not None for v in row):
                        rows.append(row)
                        if len(rows) > MAX_ROWS:
                            raise DatasetError("最多支持 10,000 行。")
            finally:
                book.close()
        except DatasetError:
            raise
        except Exception:
            raise DatasetError("无法解析 XLSX，请检查文件是否损坏或加密。") from None
    else:
        raise DatasetError("目前支持 .csv 和 .xlsx，不支持 .xls。")
    headers, columns = _normalize(headers, rows)
    return {"headers": headers, "columns": columns, "rows": rows, "sheet": sheet_name}


class DatasetStore:
    def __init__(self, path):
        self.path = Path(path)
        if not self.path.is_absolute():
            raise ValueError("Dataset storage_path must be absolute.")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(self.connect()) as db, db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS datasets (id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, metadata TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
            )
            db.execute("CREATE INDEX IF NOT EXISTS datasets_owner ON datasets(owner)")
            db.execute(
                "CREATE TABLE IF NOT EXISTS bindings (owner TEXT NOT NULL, thread_id TEXT NOT NULL, dataset_id TEXT NOT NULL, PRIMARY KEY(owner,thread_id))"
            )

    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        return db

    def _owner(self, owner):
        if not isinstance(owner, str) or not owner.strip():
            raise DatasetError("请先登录。")

    def import_file(self, owner, filename, content, sheet=None):
        self._owner(owner)
        parsed = parse_file(filename, content, sheet)
        if parsed.get("requires_sheet"):
            return parsed
        rows = parsed.pop("rows")
        metadata = {
            "id": uuid.uuid4().hex,
            "name": filename,
            "sheet": parsed["sheet"],
            "sha256": hashlib.sha256(content).hexdigest(),
            "row_count": len(rows),
            "column_count": len(parsed["headers"]),
            "columns": parsed["columns"],
            "missing_count": sum(c["missing"] for c in parsed["columns"]),
        }
        with closing(self.connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            if (
                db.execute(
                    "SELECT count(*) FROM datasets WHERE owner=?", (owner,)
                ).fetchone()[0]
                >= 20
            ):
                raise DatasetError("当前账号最多保存 20 个数据集。")
            db.execute(
                "INSERT INTO datasets(id,owner,name,metadata,data) VALUES (?,?,?,?,?)",
                (metadata["id"], owner, filename, _json(metadata), _json(rows)),
            )
        return metadata

    def list(self, owner):
        self._owner(owner)
        with closing(self.connect()) as db:
            return [
                json.loads(row[0])
                for row in db.execute(
                    "SELECT metadata FROM datasets WHERE owner=? ORDER BY created_at DESC,rowid DESC",
                    (owner,),
                ).fetchall()
            ]

    def _read(self, owner, identifier, *, include_data=True):
        self._owner(owner)
        if not isinstance(identifier, str) or not re.fullmatch(
            r"[0-9a-f]{32}", identifier
        ):
            raise DatasetError("数据集编号无效。")
        with closing(self.connect()) as db:
            row = db.execute(
                (
                    "SELECT metadata,data FROM datasets WHERE owner=? AND id=?"
                    if include_data
                    else "SELECT metadata FROM datasets WHERE owner=? AND id=?"
                ),
                (owner, identifier),
            ).fetchone()
        if row is None:
            raise DatasetError("数据集不存在或当前账号无权访问。")
        return json.loads(row[0]), json.loads(row[1]) if include_data else None

    def metadata(self, owner, identifier):
        return self._read(owner, identifier, include_data=False)[0]

    def profile(self, owner, identifier, preview_rows=20):
        metadata, rows = self._read(owner, identifier)
        names = [c["name"] for c in metadata["columns"]]
        return {
            **metadata,
            "preview": [
                dict(
                    zip(names, [str(v)[:120] if isinstance(v, str) else v for v in row])
                )
                for row in rows[:preview_rows]
            ],
            "preview_cell_limit": 120,
        }

    def bind(self, owner, thread_id, identifier):
        metadata = self.metadata(owner, identifier)
        if not isinstance(thread_id, str) or not 0 < len(thread_id) <= 128:
            raise DatasetError("会话编号无效。")
        with closing(self.connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            old = db.execute(
                "SELECT dataset_id FROM bindings WHERE owner=? AND thread_id=?",
                (owner, thread_id),
            ).fetchone()
            if old is not None and old[0] != identifier:
                raise DatasetError("此会话已绑定其他数据集，请新建分析对话。")
            db.execute(
                "INSERT OR IGNORE INTO bindings VALUES (?,?,?)",
                (owner, thread_id, identifier),
            )
        return metadata

    def _selected_id(self, owner, thread_id):
        self._owner(owner)
        with closing(self.connect()) as db:
            row = db.execute(
                "SELECT dataset_id FROM bindings WHERE owner=? AND thread_id=?",
                (owner, thread_id),
            ).fetchone()
        if row is None:
            raise DatasetError("当前对话尚未选择数据集，请在输入框上方选择并发送问题。")
        return row[0]

    def selected_metadata(self, owner, thread_id):
        return self.metadata(owner, self._selected_id(owner, thread_id))

    def selected(self, owner, thread_id):
        profile = self.profile(
            owner, self._selected_id(owner, thread_id), preview_rows=1
        )
        profile["preview"] = [
            {k: v[:40] if isinstance(v, str) else v for k, v in list(item.items())[:10]}
            for item in profile["preview"]
        ]
        profile["preview_cell_limit"] = 40
        profile["preview_columns_limit"] = 10
        return profile

    def business_for_dataset(self, owner, identifier, request):
        from datapilot_analysis.business import analyze_business

        metadata, rows = self._read(owner, identifier)
        return analyze_business(metadata, rows, request)

    def business(self, owner, thread_id, request):
        return self.business_for_dataset(
            owner, self._selected_id(owner, thread_id), request
        )

    def chart(self, owner, thread_id, request):
        return self.chart_for_dataset(
            owner, self._selected_id(owner, thread_id), request
        )

    def chart_for_dataset(self, owner, identifier, request):
        from datapilot_analysis.business import bounded_result

        if not isinstance(request, dict) or set(request) - {
            "x",
            "metric",
            "aggregation",
            "kind",
            "filters",
            "unit",
        }:
            raise DatasetError("图表参数无效，不接受模型提供的数值、代码或 HTML。")
        kind = request.get("kind", "bar")
        if kind not in ("bar", "line"):
            raise DatasetError("目前支持 bar 和 line 两种图表。")
        unit = request.get("unit", "原始数值")
        if not isinstance(unit, str) or not 1 <= len(unit.strip()) <= 20:
            raise DatasetError("单位必须是 1 到 20 个字符。")
        operation = request.get("aggregation", "sum")
        output_alias = (
            "_value" if str(request.get("x")).casefold() == "value" else "value"
        )
        query = {
            "group_by": [request.get("x")],
            "aggregation": operation,
            "limit": 50,
            "order_by": request.get("x") if kind == "line" else output_alias,
            "descending": kind == "bar",
            "filters": request.get("filters", []),
        }
        if "metric" in request:
            query["metric"] = request["metric"]
        # The normal query path validates field names, values and ownership.
        result = self.query_for_dataset(owner, identifier, query)
        if result["has_more"]:
            raise DatasetError(
                "图表超过 50 个类别，请选择类别更少的分组字段，或在对话中指定筛选条件。"
            )
        value_column = result["columns"][-1]
        return bounded_result(
            {
                "version": 1,
                "kind": "chart",
                "source": result["source"],
                "query": result["query"],
                "chart": {
                    "type": kind,
                    "title": f"{request.get('metric', '记录数')} · {operation} · 按{request['x']}",
                    "x_label": request["x"],
                    "y_label": unit.strip(),
                    "points": [
                        {
                            "label": "（空值）"
                            if row[request["x"]] is None
                            else str(row[request["x"]]),
                            "value": row[value_column],
                        }
                        for row in result["rows"]
                    ],
                },
            }
        )

    def query(self, owner, thread_id, request):
        return self.query_for_dataset(
            owner, self._selected_id(owner, thread_id), request
        )

    def query_for_dataset(self, owner, identifier, request):
        metadata, rows = self._read(owner, identifier)
        allowed = {
            "select",
            "filters",
            "group_by",
            "metric",
            "aggregation",
            "order_by",
            "descending",
            "limit",
        }
        if not isinstance(request, dict) or set(request) - allowed:
            raise DatasetError("不支持该查询参数；不能提交原始 SQL。")
        columns = {c["name"]: c["type"] for c in metadata["columns"]}
        names = list(columns)

        def column(name):
            if not isinstance(name, str) or name not in columns:
                raise DatasetError("查询字段不存在，请先查看数据集结构。")
            return _identifier(name)

        limit = request.get("limit", 30)
        if type(limit) is not int or not 1 <= limit <= 100:
            raise DatasetError("结果行数必须在 1 到 100 之间。")
        groups = request.get("group_by", [])
        if (
            not isinstance(groups, list)
            or not all(isinstance(g, str) for g in groups)
            or len(groups) > 2
            or len(set(groups)) != len(groups)
        ):
            raise DatasetError("最多按两个不重复的字段分组。")
        group_sql = [column(g) for g in groups]
        metric, operation = request.get("metric"), request.get("aggregation")
        alias = "value"
        while alias.casefold() in {g.casefold() for g in groups}:
            alias = "_" + alias
        if metric is not None or operation is not None:
            functions = {
                "sum": "SUM",
                "mean": "AVG",
                "count": "COUNT",
                "min": "MIN",
                "max": "MAX",
            }
            if not isinstance(operation, str) or operation not in functions:
                raise DatasetError("聚合方式须为 sum、mean、count、min、max。")
            if metric is None and operation != "count":
                raise DatasetError("请指定数值字段。")
            if metric is not None:
                column(metric)
                if operation != "count" and columns[metric] != "number":
                    raise DatasetError("该聚合需要数值字段。")
            expression = f"{functions[operation]}({column(metric) if metric is not None else '*'}) AS {_identifier(alias)}"
            select = ",".join([*group_sql, expression])
            output_columns = [*groups, alias]
        else:
            if groups:
                raise DatasetError("分组查询需要指定聚合方式。")
            fields = request.get("select", names[:10])
            if (
                not isinstance(fields, list)
                or not all(isinstance(f, str) for f in fields)
                or not 1 <= len(fields) <= 10
                or len(set(fields)) != len(fields)
            ):
                raise DatasetError("请选择 1 到 10 个不重复的字段。")
            select, output_columns = ",".join(column(f) for f in fields), fields
        filters = request.get("filters", [])
        if not isinstance(filters, list) or len(filters) > 8:
            raise DatasetError("最多支持 8 个筛选条件。")
        predicates, parameters = [], []
        for condition in filters:
            if not isinstance(condition, dict) or set(condition) != {
                "column",
                "op",
                "value",
            }:
                raise DatasetError("筛选条件格式无效。")
            key, op, value = condition["column"], condition["op"], condition["value"]
            quoted = column(key)
            operators = {
                "eq": "=",
                "ne": "!=",
                "gt": ">",
                "gte": ">=",
                "lt": "<",
                "lte": "<=",
            }
            if (
                not isinstance(op, str)
                or op not in {*operators, "contains"}
                or type(value) not in (str, int, float)
                or len(str(value)) > 200
            ):
                raise DatasetError("筛选值或运算符无效。")
            if columns[key] == "number":
                value = _numeric(value)
                if value is None or op == "contains":
                    raise DatasetError("数值字段需要有效数值比较条件。")
            if op == "contains":
                value = (
                    "%"
                    + str(value)
                    .replace("\\", "\\\\")
                    .replace("%", "\\%")
                    .replace("_", "\\_")
                    + "%"
                )
                predicates.append(f"{quoted} LIKE ? ESCAPE '\\'")
            else:
                predicates.append(f"{quoted} {operators[op]} ?")
            parameters.append(value)
        sql = "SELECT " + select + ' FROM "records"'
        if predicates:
            sql += " WHERE " + " AND ".join(predicates)
        if groups:
            sql += " GROUP BY " + ",".join(group_sql)
        order = request.get("order_by")
        descending = request.get("descending", False)
        if type(descending) is not bool:
            raise DatasetError("descending 必须是布尔值。")
        if order is not None:
            if order not in output_columns:
                raise DatasetError("排序字段必须出现在查询结果中。")
            sql += (
                " ORDER BY " + _identifier(order) + (" DESC" if descending else " ASC")
            )
        sql += " LIMIT ?"
        with closing(sqlite3.connect(":memory:")) as db:
            definitions = ",".join(
                f"{column(n)} {'REAL' if columns[n] == 'number' else 'TEXT'}"
                for n in names
            )
            db.execute(f'CREATE TABLE "records" ({definitions})')
            db.executemany(
                'INSERT INTO "records" VALUES (' + ",".join("?" for _ in names) + ")",
                rows,
            )
            result = db.execute(sql, [*parameters, limit + 1]).fetchall()
        items = [dict(zip(output_columns, row)) for row in result[:limit]]
        for item in items:
            if any(
                isinstance(v, float) and not math.isfinite(v) for v in item.values()
            ):
                raise DatasetError("查询数值超出支持范围。")
        output = {
            "columns": output_columns,
            "rows": items,
            "has_more": len(result) > limit,
            "query": request,
            "source": {
                k: metadata[k] for k in ("id", "name", "sheet", "sha256", "row_count")
            },
        }
        if len(_json(output).encode()) > 48 * 1024:
            raise DatasetError("结果过大，请缩小返回行数或减少字段。")
        return output
