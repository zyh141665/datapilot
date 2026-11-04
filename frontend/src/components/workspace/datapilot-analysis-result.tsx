"use client";

import { useMemo } from "react";

import {
  chartGeometry,
  formatMetric,
  readAnalysisArtifact,
  type AnalysisResult,
  type ChartData,
} from "@/core/datapilot/analysis";

export function DataChart({ chart }: { chart: ChartData }) {
  const geometry = chartGeometry(chart);
  const step = Math.max(1, Math.ceil(chart.points.length / 6));
  return (
    <section
      className="bg-background min-w-0 rounded-xl border p-4"
      aria-label={chart.title}
    >
      <h3 className="text-sm font-semibold">{chart.title}</h3>
      <p className="text-muted-foreground mt-1 text-xs">
        {chart.x_label} · 单位：{chart.y_label}
      </p>
      {chart.points.length ? (
        <svg
          viewBox="0 0 680 285"
          className="mt-3 w-full"
          role="img"
          aria-label={chart.title}
        >
          <title>{chart.title}</title>
          {geometry.ticks.map((tick, i) => (
            <g key={i}>
              <line
                x1={75}
                x2={650}
                y1={geometry.y(tick)}
                y2={geometry.y(tick)}
                stroke="currentColor"
                opacity={0.12}
              />
              <text
                x={68}
                y={geometry.y(tick) + 4}
                textAnchor="end"
                fill="currentColor"
                fontSize={11}
              >
                {Math.abs(tick) >= 1e7
                  ? tick.toExponential(1)
                  : formatMetric(tick)}
              </text>
            </g>
          ))}
          <line
            x1={75}
            x2={650}
            y1={geometry.zero}
            y2={geometry.zero}
            stroke="currentColor"
            opacity={0.4}
          />
          {chart.type === "line" &&
            geometry.segments.map((path, i) => (
              <path
                key={i}
                d={path}
                fill="none"
                stroke="#0d9488"
                strokeWidth={3}
              />
            ))}
          {chart.points.map((point, i) => (
            <g key={i}>
              {point.value !== null &&
                (chart.type === "bar" ? (
                  <rect
                    x={geometry.x(i) - Math.min(26, 200 / chart.points.length)}
                    y={Math.min(geometry.y(point.value), geometry.zero)}
                    width={Math.min(52, 400 / chart.points.length)}
                    height={Math.max(
                      0,
                      Math.abs(geometry.y(point.value) - geometry.zero),
                    )}
                    fill={point.value < 0 ? "#e11d48" : "#0d9488"}
                  >
                    <title>
                      {point.label}：{formatMetric(point.value)} {chart.y_label}
                    </title>
                  </rect>
                ) : (
                  <circle
                    cx={geometry.x(i)}
                    cy={geometry.y(point.value)}
                    r={4}
                    fill="#0d9488"
                  >
                    <title>
                      {point.label}：{formatMetric(point.value)} {chart.y_label}
                    </title>
                  </circle>
                ))}
              {(i % step === 0 || i === chart.points.length - 1) && (
                <text
                  x={geometry.x(i)}
                  y={252}
                  textAnchor="middle"
                  fontSize={11}
                  fill="currentColor"
                >
                  <title>{point.label}</title>
                  {point.label.length > 9
                    ? point.label.slice(0, 8) + "…"
                    : point.label}
                </text>
              )}
            </g>
          ))}
        </svg>
      ) : (
        <p className="text-muted-foreground py-8 text-center text-sm">
          筛选后没有可绘制的数据。
        </p>
      )}
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer">查看图表数据</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-left">
            <thead>
              <tr>
                <th className="py-2">{chart.x_label}</th>
                <th>{chart.y_label}</th>
              </tr>
            </thead>
            <tbody>
              {chart.points.map((point, i) => (
                <tr key={i} className="border-t">
                  <td className="py-2 break-all">{point.label}</td>
                  <td>
                    {point.value === null
                      ? "无数据 / 无法计算"
                      : formatMetric(point.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

export function AnalysisResultView({ result }: { result: AnalysisResult }) {
  const business = result.kind === "business" ? result : null;
  const charts = result.kind === "chart" ? [result.chart] : result.charts;
  return (
    <section
      className="my-4 min-w-0 space-y-4 rounded-2xl border border-teal-500/25 bg-teal-500/5 p-4 md:p-5"
      aria-label="数据分析结果"
    >
      <header className="space-y-1">
        <h2 className="font-semibold">
          {business ? "经营分析结果" : "数据图表"}
        </h2>
        <p className="text-muted-foreground text-xs break-all">
          来源：{result.source.name}
          {result.source.sheet ? ` / ${result.source.sheet}` : ""} · 文件指纹{" "}
          {result.source.sha256.slice(0, 12)}
        </p>
      </header>
      {business && (
        <>
          <p className="text-muted-foreground text-xs">
            {business.scope.from_month} 至 {business.scope.to_month} · 纳入{" "}
            {business.scope.included_rows} 行 · 日期缺失{" "}
            {business.scope.missing_date_rows} 行 · 范围外{" "}
            {business.scope.outside_range_rows} 行
          </p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ["销售额", business.totals.revenue, business.mapping.unit],
              ["所选成本", business.totals.cost, business.mapping.unit],
              ["差额利润", business.totals.profit, business.mapping.unit],
              ["利润率", business.totals.profit_margin_percent, "%"],
            ].map(([label, value, unit]) => (
              <div
                key={String(label)}
                className="bg-background rounded-xl border p-3"
              >
                <p className="text-muted-foreground text-xs">{label}</p>
                <p className="mt-2 text-lg font-semibold break-all tabular-nums">
                  {formatMetric(value as number | null)}
                  {value !== null && (
                    <span className="ml-1 text-xs font-normal">{unit}</span>
                  )}
                </p>
              </div>
            ))}
          </div>
          <div className="bg-background rounded-xl border p-4 text-sm leading-7">
            <p>
              本期 {business.comparison.current_month} 对比基期{" "}
              {business.comparison.base_month}
            </p>
            <p>
              基期销售额：{formatMetric(business.comparison.base.revenue)} →
              本期销售额：{formatMetric(business.comparison.current.revenue)}（
              {business.mapping.unit}）
            </p>
            <p>
              销售额变化：
              <strong>{formatMetric(business.comparison.delta)}</strong>
              {business.comparison.delta !== null
                ? ` ${business.mapping.unit}`
                : ""}
              ；增长率：
              <strong>
                {formatMetric(business.comparison.growth_percent)}
              </strong>
              {business.comparison.growth_percent !== null ? "%" : ""}
            </p>
            {business.comparison.reason && (
              <p className="text-amber-700 dark:text-amber-300">
                {business.comparison.reason}
              </p>
            )}
          </div>
          {business.warnings.length > 0 && (
            <ul className="list-inside list-disc rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-xs leading-6 text-amber-800 dark:text-amber-200">
              {business.warnings.map((warning, i) => (
                <li key={i}>{warning}</li>
              ))}
            </ul>
          )}
        </>
      )}
      <div className="grid min-w-0 gap-4">
        {charts.map((chart, i) => (
          <DataChart key={i} chart={chart} />
        ))}
      </div>
      {business && business.comparison.contributions.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer">查看分组变化明细</summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr>
                  {[
                    business.mapping.dimension_column ?? "分组",
                    "基期销售额",
                    "本期销售额",
                    "变化额",
                    "变化贡献占比",
                  ].map((label, i) => (
                    <th key={i} className="px-2 py-2 whitespace-nowrap">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {business.comparison.contributions.map((row, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-2 py-2">{row.label ?? "（空值）"}</td>
                    <td className="px-2">{formatMetric(row.base)}</td>
                    <td className="px-2">{formatMetric(row.current)}</td>
                    <td className="px-2">{formatMetric(row.delta)}</td>
                    <td className="px-2">
                      {formatMetric(row.share_percent)}
                      {row.share_percent !== null ? "%" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <details className="text-muted-foreground text-xs leading-6">
        <summary className="cursor-pointer">查看字段、计算口径与来源</summary>
        {business ? (
          <>
            <p>
              日期：{business.mapping.date_column}；销售额：
              {business.mapping.revenue_column}；成本：
              {business.mapping.cost_column ?? "未选择"}；分组：
              {business.mapping.dimension_column ?? "未选择"}
            </p>
            <ul className="list-inside list-disc">
              {business.methodology.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </>
        ) : (
          <pre className="overflow-x-auto break-all whitespace-pre-wrap">
            {JSON.stringify(
              result.kind === "chart" ? result.query : {},
              null,
              2,
            )}
          </pre>
        )}
        <p className="break-all">SHA-256：{result.source.sha256}</p>
      </details>
    </section>
  );
}

export function DataAnalysisResults({
  results,
}: {
  results: { key: string; name: string; message: unknown }[];
}) {
  const analyses = useMemo(
    () =>
      results.flatMap((entry) => {
        const result = readAnalysisArtifact(entry.name, entry.message);
        return result ? [{ key: entry.key, result }] : [];
      }),
    [results],
  );
  return (
    <>
      {analyses.map(({ key, result }) => (
        <AnalysisResultView key={key} result={result} />
      ))}
    </>
  );
}
