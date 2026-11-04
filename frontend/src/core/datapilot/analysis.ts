import { z } from "zod";

const number = z.number().finite().nullable();
const text = z.string().max(2048);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const source = z.object({
  id: z.string().regex(/^[a-f0-9]{32}$/),
  name: z.string().max(320),
  sheet: text.nullable(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  row_count: z.number().int().min(0).max(10000),
});
const metrics = z.object({
  rows: z.number().int().min(0).max(10000),
  revenue: number,
  cost: number,
  profit: number,
  profit_margin_percent: number,
  missing_revenue: z.number().int().min(0),
  missing_cost: z.number().int().min(0).nullable(),
});
export const chartSchema = z.object({
  type: z.enum(["line", "bar"]),
  title: z.string().max(600),
  x_label: text,
  y_label: z.string().max(40),
  points: z.array(z.object({ label: text, value: number })).max(50),
});
export const businessSchema = z.object({
  version: z.literal(1),
  kind: z.literal("business"),
  source,
  mapping: z.object({
    date_column: text,
    revenue_column: text,
    cost_column: text.nullable(),
    dimension_column: text.nullable(),
    unit: z.string().max(40),
  }),
  scope: z.object({
    from_month: month,
    to_month: month,
    included_rows: z.number().int().min(0),
    missing_date_rows: z.number().int().min(0),
    outside_range_rows: z.number().int().min(0),
  }),
  totals: metrics,
  trend: z.array(metrics.extend({ month })).max(24),
  comparison: z.object({
    current_month: month,
    base_month: month,
    current: metrics,
    base: metrics,
    delta: number,
    growth_percent: number,
    reason: text.nullable(),
    contributions: z
      .array(
        z.object({
          label: text.nullable(),
          current: number,
          base: number,
          delta: number,
          share_percent: number,
        }),
      )
      .max(50),
  }),
  charts: z.array(chartSchema).max(2),
  warnings: z.array(text).max(10),
  methodology: z.array(text).max(10),
});
export const analysisSchema = z.discriminatedUnion("kind", [
  businessSchema,
  z.object({
    version: z.literal(1),
    kind: z.literal("chart"),
    source,
    query: z.record(z.string(), z.unknown()),
    chart: chartSchema,
  }),
]);
export type ChartData = z.infer<typeof chartSchema>;
export type BusinessAnalysis = z.infer<typeof businessSchema>;
export type AnalysisResult = z.infer<typeof analysisSchema>;
export type ChartResult = Extract<AnalysisResult, { kind: "chart" }>;
export type ChartRequest = {
  x: string;
  metric?: string;
  aggregation?: "sum" | "mean" | "count" | "min" | "max";
  kind?: "line" | "bar";
  unit?: string;
};
export type BusinessRequest = {
  date_column: string;
  revenue_column: string;
  cost_column?: string;
  dimension_column?: string;
  unit?: string;
  from_month?: string;
  to_month?: string;
  current_month?: string;
  base_month?: string;
};

// Public host naming is deterministic. Only matching tool-result artifacts can paint charts.
export const ANALYSIS_TOOLS = {
  business: "ext_datapilot_datasets_analyze_business_081766630dcc",
  chart: "ext_datapilot_datasets_create_dataset_chart_ead65a86d0eb",
} as const;

export function readAnalysisArtifact(
  name: string,
  value: unknown,
): AnalysisResult | null {
  if (name !== ANALYSIS_TOOLS.business && name !== ANALYSIS_TOOLS.chart)
    return null;
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;
  if (message.type !== "tool" || message.status === "error") return null;
  const kwargs = message.additional_kwargs as
    | { deerflow_tool_meta?: { status?: string } }
    | undefined;
  if (kwargs?.deerflow_tool_meta?.status === "error") return null;
  const artifact = message.artifact as Record<string, unknown> | undefined;
  const result = analysisSchema.safeParse(artifact?.datapilot_analysis);
  if (!result.success) return null;
  if ((name === ANALYSIS_TOOLS.business) !== (result.data.kind === "business"))
    return null;
  return result.data;
}

export function formatMetric(value: number | null): string {
  return value === null
    ? "无法计算"
    : new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(
        value,
      );
}

/** Normalize before plotting: a finite input may still overflow a max-min subtraction. */
export function chartGeometry(chart: ChartData) {
  const values = chart.points.flatMap((p) =>
    p.value === null ? [] : [p.value],
  );
  const scale = Math.max(1, ...values.map(Math.abs));
  let min = Math.min(0, ...values.map((n) => n / scale));
  let max = Math.max(0, ...values.map((n) => n / scale));
  if (min === max) {
    min = -1;
    max = 1;
  }
  const y = (value: number) =>
    225 - ((value / scale - min) / (max - min)) * 190;
  const x = (index: number) =>
    80 + ((index + 0.5) * 560) / Math.max(chart.points.length, 1);
  const segments: string[] = [];
  let segment: string[] = [];
  chart.points.forEach((point, i) => {
    if (point.value === null) {
      if (segment.length) segments.push(segment.join(" "));
      segment = [];
    } else
      segment.push(`${segment.length ? "L" : "M"}${x(i)},${y(point.value)}`);
  });
  if (segment.length) segments.push(segment.join(" "));
  return {
    x,
    y,
    zero: y(0),
    segments,
    ticks: [min, (min + max) / 2, max].map((n) => n * scale),
  };
}
