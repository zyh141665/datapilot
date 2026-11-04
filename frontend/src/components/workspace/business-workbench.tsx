"use client";

import { useRef, useState, type FormEvent } from "react";

import type {
  BusinessAnalysis,
  BusinessRequest,
} from "@/core/datapilot/analysis";
import { analyzeDataset, type DatasetInfo } from "@/core/datapilot/api";

import { AnalysisResultView } from "./datapilot-analysis-result";

export function BusinessWorkbench({
  owner,
  dataset,
}: {
  owner: string;
  dataset: DatasetInfo;
}) {
  const [mapping, setMapping] = useState({
    date: "",
    revenue: "",
    cost: "",
    dimension: "",
    unit: "",
    current: "",
    base: "",
    from: "",
    to: "",
  });
  const [result, setResult] = useState<BusinessAnalysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState<number | null>(null);
  const revision = useRef(0);
  const numeric = dataset.columns.filter(
    (column) => column.type === "number" || column.type === "empty",
  );
  function update(key: keyof typeof mapping, value: string) {
    revision.current += 1;
    setMapping((previous) => ({ ...previous, [key]: value }));
    setResult(null);
    setError("");
    setElapsed(null);
  }
  async function analyze(event: FormEvent) {
    event.preventDefault();
    const token = revision.current;
    const started = performance.now();
    setBusy(true);
    setError("");
    setResult(null);
    setElapsed(null);
    const request: BusinessRequest = {
      date_column: mapping.date,
      revenue_column: mapping.revenue,
    };
    for (const [key, value] of Object.entries({
      cost_column: mapping.cost,
      dimension_column: mapping.dimension,
      unit: mapping.unit,
      current_month: mapping.current,
      base_month: mapping.base,
      from_month: mapping.from,
      to_month: mapping.to,
    })) {
      if (value.trim()) (request as Record<string, string>)[key] = value.trim();
    }
    try {
      const computed = await analyzeDataset(owner, dataset.id, request);
      if (token === revision.current) setResult(computed);
    } catch (cause) {
      if (token === revision.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "分析失败，请检查字段和日期。",
        );
    } finally {
      setBusy(false);
      if (token === revision.current)
        setElapsed((performance.now() - started) / 1000);
    }
  }
  return (
    <section
      className="bg-background rounded-2xl border p-6"
      aria-label="经营分析"
    >
      <h2 className="font-semibold">经营分析与图表</h2>
      <p className="text-muted-foreground mt-2 text-xs leading-6">
        先确认字段含义和单位，再计算。利润口径为销售额减所选成本；不会自动包含退款、税费或运费。这里直接调用计算工具，不消耗模型额度。
      </p>
      <p className="text-muted-foreground mt-2 text-xs leading-6">
        此模式适用于有真实日期和销售额含义的数据。time_slot=1、批次号等序号不等于日历日期，请使用通用分析。
      </p>
      <form
        onSubmit={(event) => void analyze(event)}
        className="mt-5 space-y-4"
      >
        <fieldset
          disabled={busy}
          className="grid gap-4 disabled:opacity-60 sm:grid-cols-2 lg:grid-cols-4"
        >
          {(
            [
              ["date", "日期 / 月份字段", dataset.columns, true],
              ["revenue", "销售额字段", numeric, true],
              ["cost", "成本字段（可选）", numeric, false],
              ["dimension", "贡献分组（可选）", dataset.columns, false],
            ] as const
          ).map(([key, label, columns, required]) => (
            <label key={key} className="space-y-2 text-xs">
              <span>{label}</span>
              <select
                required={required}
                aria-label={label}
                value={mapping[key]}
                onChange={(event) => update(key, event.target.value)}
                className="bg-background w-full rounded-lg border p-2 text-sm"
              >
                <option value="">{required ? "请确认并选择" : "不使用"}</option>
                {columns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label className="space-y-2 text-xs">
            <span>数值单位（可选）</span>
            <input
              aria-label="数值单位"
              maxLength={20}
              value={mapping.unit}
              onChange={(event) => update("unit", event.target.value)}
              placeholder="例如：元；留空则不推断"
              className="bg-background w-full rounded-lg border p-2 text-sm"
            />
          </label>
          <label className="space-y-2 text-xs">
            <span>本期月份（可选）</span>
            <input
              aria-label="本期月份"
              type="month"
              value={mapping.current}
              onChange={(event) => update("current", event.target.value)}
              className="bg-background w-full rounded-lg border p-2 text-sm"
            />
          </label>
          <label className="space-y-2 text-xs">
            <span>基期月份（可选）</span>
            <input
              aria-label="基期月份"
              type="month"
              value={mapping.base}
              onChange={(event) => update("base", event.target.value)}
              className="bg-background w-full rounded-lg border p-2 text-sm"
            />
          </label>
        </fieldset>
        <details className="text-xs">
          <summary className="text-muted-foreground cursor-pointer">
            限定分析范围（最多 24 个月）
          </summary>
          <div className="mt-3 flex flex-wrap gap-4">
            {(
              [
                ["from", "起始月份"],
                ["to", "结束月份"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2">
                {label}
                <input
                  disabled={busy}
                  aria-label={label}
                  type="month"
                  value={mapping[key]}
                  onChange={(event) => update(key, event.target.value)}
                  className="bg-background rounded-lg border p-2"
                />
              </label>
            ))}
          </div>
        </details>
        <p className="text-muted-foreground text-xs leading-6">
          未指定月份时，本期取范围内最新有数据月份，基期取上一个日历月。成本或销售额缺失时，相关指标显示无法计算。
        </p>
        <button
          disabled={busy || !mapping.date || !mapping.revenue}
          type="submit"
          className="rounded-xl bg-teal-600 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "正在计算…" : "计算指标并生成图表"}
        </button>
      </form>
      {busy && (
        <p role="status" className="text-muted-foreground mt-3 text-xs">
          请求已提交，正在计算；无需重复点击。
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
