"use client";

import { useRef, useState, type FormEvent } from "react";

import {
  formatMetric,
  type ChartRequest,
  type ChartResult,
} from "@/core/datapilot/analysis";
import { chartDataset, type DatasetInfo } from "@/core/datapilot/api";

import { BusinessWorkbench } from "./business-workbench";
import { AnalysisResultView } from "./datapilot-analysis-result";

export function DatasetAnalysisWorkbench({
  owner,
  dataset,
}: {
  owner: string;
  dataset: DatasetInfo;
}) {
  const [mode, setMode] = useState<"general" | "business">("general");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3" role="group" aria-label="分析模式">
        <button
          type="button"
          aria-pressed={mode === "general"}
          onClick={() => setMode("general")}
          className={`rounded-xl border px-5 py-3 text-sm ${mode === "general" ? "border-teal-600 bg-teal-600 text-white" : "bg-background"}`}
        >
          通用分析
        </button>
        <button
          type="button"
          aria-pressed={mode === "business"}
          onClick={() => setMode("business")}
          className={`rounded-xl border px-5 py-3 text-sm ${mode === "business" ? "border-teal-600 bg-teal-600 text-white" : "bg-background"}`}
        >
          销售经营分析
        </button>
      </div>
      {mode === "general" ? (
        <GeneralAnalysis owner={owner} dataset={dataset} />
      ) : (
        <BusinessWorkbench owner={owner} dataset={dataset} />
      )}
    </div>
  );
}

function GeneralAnalysis({
  owner,
  dataset,
}: {
  owner: string;
  dataset: DatasetInfo;
}) {
  const [metric, setMetric] = useState("");
  const [x, setX] = useState("");
  const [aggregation, setAggregation] =
    useState<NonNullable<ChartRequest["aggregation"]>>("mean");
  const [kind, setKind] = useState<"bar" | "line">("bar");
  const [unit, setUnit] = useState("");
  const [result, setResult] = useState<ChartResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState<number | null>(null);
  const revision = useRef(0);
  const column = dataset.columns.find((item) => item.name === metric);
  const numeric = dataset.columns.filter(
    (item) => item.type === "number" || item.type === "empty",
  );
  function change(action: () => void) {
    revision.current += 1;
    action();
    setResult(null);
    setError("");
    setElapsed(null);
  }
  async function calculate(event: FormEvent) {
    event.preventDefault();
    const token = revision.current;
    const started = performance.now();
    setBusy(true);
    setResult(null);
    setError("");
    setElapsed(null);
    try {
      const chart = await chartDataset(owner, dataset.id, {
        x,
        ...(metric ? { metric } : {}),
        aggregation,
        kind,
        ...(unit.trim() ? { unit: unit.trim() } : {}),
      });
      if (token === revision.current) setResult(chart);
    } catch (cause) {
      if (token === revision.current)
        setError(
          cause instanceof Error ? cause.message : "图表计算失败，请重试。",
        );
    } finally {
      if (token === revision.current) {
        setElapsed((performance.now() - started) / 1000);
        setBusy(false);
      }
    }
  }
  return (
    <section
      aria-label="通用数据分析"
      className="bg-background rounded-2xl border p-6"
    >
      <h2 className="font-semibold">通用数值与分组分析</h2>
      <p className="text-muted-foreground mt-2 text-xs leading-6">
        适用于遥测、实验、流量、运营等表格。选择需要分析的数值列；time_slot
        这类编号可用作分组字段，不要求真实日期，也不会被当成销售额。
      </p>
      <form
        onSubmit={(event) => void calculate(event)}
        className="mt-5 space-y-4"
      >
        <fieldset
          disabled={busy}
          className="grid gap-4 disabled:opacity-60 sm:grid-cols-2 lg:grid-cols-3"
        >
          <label className="space-y-2 text-xs">
            <span>数值字段</span>
            <select
              aria-label="通用数值字段"
              value={metric}
              onChange={(event) => change(() => setMetric(event.target.value))}
              className="bg-background w-full rounded-lg border p-2 text-sm"
            >
              <option value="">请确认并选择（记录计数时可不选）</option>
              {numeric.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2 text-xs">
            <span>分组 / 横轴字段</span>
            <select
              aria-label="分组 / 横轴字段"
              value={x}
              onChange={(event) => change(() => setX(event.target.value))}
              className="bg-background w-full rounded-lg border p-2 text-sm"
            >
              <option value="">生成图表时选择</option>
              {dataset.columns.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2 text-xs">
            <span>聚合方式</span>
            <select
              aria-label="聚合方式"
              value={aggregation}
              onChange={(event) =>
                change(() =>
                  setAggregation(event.target.value as typeof aggregation),
                )
              }
              className="bg-background w-full rounded-lg border p-2 text-sm"
            >
              {[
                ["mean", "平均值"],
                ["sum", "求和"],
                ["count", "计数（选数值字段时为非空值计数）"],
                ["min", "最小值"],
                ["max", "最大值"],
              ].map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2 text-xs">
            <span>图表类型</span>
            <select
              aria-label="通用图表类型"
              value={kind}
              onChange={(event) =>
                change(() => setKind(event.target.value as typeof kind))
              }
              className="bg-background w-full rounded-lg border p-2 text-sm"
            >
              <option value="bar">柱状图</option>
              <option value="line">折线图（按横轴原值排序）</option>
            </select>
          </label>
          <label className="space-y-2 text-xs">
            <span>数值单位（可选）</span>
            <input
              aria-label="通用数值单位"
              value={unit}
              maxLength={20}
              onChange={(event) => change(() => setUnit(event.target.value))}
              placeholder="例如：ms、Mbps；留空则不推断"
              className="bg-background w-full rounded-lg border p-2 text-sm"
            />
          </label>
        </fieldset>
        {column && (
          <div className="space-y-3">
            <p className="text-muted-foreground text-xs">
              {column.name}：全表 {dataset.row_count} 行，有效数值{" "}
              {dataset.row_count - column.missing} 个，缺失 {column.missing}{" "}
              个。下列统计来自已保存数据，选择后即可查看。
            </p>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                ["平均值", column.mean],
                ["最小值", column.min],
                ["最大值", column.max],
                ["求和", column.sum],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-xl border p-3">
                  <p className="text-muted-foreground text-xs">{label}</p>
                  <p className="mt-2 text-lg font-semibold break-all">
                    {formatMetric((value ?? null) as number | null)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
        <p className="text-muted-foreground text-xs leading-6">
          图表按全表的字段原值分组，最多 50
          类。折线连接分组值，横轴位置不代表实际时间间隔。需要月份增长率或利润时，再切换销售经营分析。
        </p>
        <button
          type="submit"
          disabled={busy || !x || (!metric && aggregation !== "count")}
          className="rounded-xl bg-teal-600 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "正在计算…" : "计算分组并生成图表"}
        </button>
      </form>
      {busy && (
        <p role="status" className="text-muted-foreground mt-3 text-xs">
          请求已提交，正在读取数据并计算；无需重复点击。
        </p>
      )}
      {elapsed !== null && (
        <p role="status" className="text-muted-foreground mt-3 text-xs">
          本次请求耗时 {elapsed.toFixed(2)} 秒（含网络与结果解析）。
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-rose-300 p-3 text-sm text-rose-700"
        >
          {error}
        </p>
      )}
      {result && <AnalysisResultView result={result} />}
    </section>
  );
}
