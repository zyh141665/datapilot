import type { BusinessAnalysis, ChartData } from "@/core/datapilot/analysis";

export const chartFixture: ChartData = {
  type: "line",
  title: "月度销售额趋势",
  x_label: "月份",
  y_label: "元",
  points: [
    { label: "2026-09", value: 200 },
    { label: "2026-10", value: 300 },
  ],
};
export const businessFixture: BusinessAnalysis = {
  version: 1,
  kind: "business",
  source: {
    id: "a".repeat(32),
    name: "sales.csv",
    sheet: null,
    sha256: "b".repeat(64),
    row_count: 4,
  },
  mapping: {
    date_column: "月份",
    revenue_column: "销售额",
    cost_column: "成本",
    dimension_column: "区域",
    unit: "元",
  },
  scope: {
    from_month: "2026-09",
    to_month: "2026-10",
    included_rows: 4,
    missing_date_rows: 0,
    outside_range_rows: 0,
  },
  totals: {
    rows: 4,
    revenue: 500,
    cost: 270,
    profit: 230,
    profit_margin_percent: 46,
    missing_revenue: 0,
    missing_cost: 0,
  },
  trend: [],
  comparison: {
    current_month: "2026-10",
    base_month: "2026-09",
    current: {
      rows: 2,
      revenue: 300,
      cost: 160,
      profit: 140,
      profit_margin_percent: 46.66666666666667,
      missing_revenue: 0,
      missing_cost: 0,
    },
    base: {
      rows: 2,
      revenue: 200,
      cost: 110,
      profit: 90,
      profit_margin_percent: 45,
      missing_revenue: 0,
      missing_cost: 0,
    },
    delta: 100,
    growth_percent: 50,
    reason: null,
    contributions: [
      { label: "华东", current: 180, base: 100, delta: 80, share_percent: 80 },
      { label: "华北", current: 120, base: 100, delta: 20, share_percent: 20 },
    ],
  },
  charts: [chartFixture],
  warnings: [],
  methodology: ["利润仅为所选销售额减所选成本；不自动包含退款、税费或运费。"],
};
