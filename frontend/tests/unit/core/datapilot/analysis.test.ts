import { expect, test } from "@rstest/core";

import {
  ANALYSIS_TOOLS,
  chartGeometry,
  readAnalysisArtifact,
} from "@/core/datapilot/analysis";

export const result = {
  version: 1,
  kind: "chart",
  source: {
    id: "a".repeat(32),
    name: "sales.csv",
    sheet: null,
    sha256: "b".repeat(64),
    row_count: 3,
  },
  query: { metric: "sales", aggregation: "sum" },
  chart: {
    type: "line",
    title: "月度销售额",
    x_label: "月份",
    y_label: "元",
    points: [
      { label: "2026-08", value: -10 },
      { label: "2026-09", value: null },
      { label: "2026-10", value: 20 },
    ],
  },
};

test("only a matching successful tool artifact can display an analysis", () => {
  const message = { type: "tool", artifact: { datapilot_analysis: result } };
  expect(readAnalysisArtifact(ANALYSIS_TOOLS.chart, message)?.kind).toBe(
    "chart",
  );
  expect(
    readAnalysisArtifact(ANALYSIS_TOOLS.chart, { ...message, type: "ai" }),
  ).toBeNull();
  expect(readAnalysisArtifact("web_search", message)).toBeNull();
  expect(readAnalysisArtifact(ANALYSIS_TOOLS.business, message)).toBeNull();
  expect(
    readAnalysisArtifact(ANALYSIS_TOOLS.chart, { ...message, status: "error" }),
  ).toBeNull();
  expect(
    readAnalysisArtifact(ANALYSIS_TOOLS.chart, {
      type: "tool",
      content: JSON.stringify(result),
    }),
  ).toBeNull();
});

test("unknown versions and non-finite plotted values are rejected", () => {
  expect(
    readAnalysisArtifact(ANALYSIS_TOOLS.chart, {
      type: "tool",
      artifact: { datapilot_analysis: { ...result, version: 2 } },
    }),
  ).toBeNull();
  expect(
    readAnalysisArtifact(ANALYSIS_TOOLS.chart, {
      type: "tool",
      artifact: {
        datapilot_analysis: {
          ...result,
          chart: {
            ...result.chart,
            points: [{ label: "bad", value: Infinity }],
          },
        },
      },
    }),
  ).toBeNull();
});

test("line gaps remain gaps and extreme finite numbers produce finite coordinates", () => {
  const geometry = chartGeometry({
    ...result.chart,
    type: "line",
    points: [
      { label: "a", value: -1e308 },
      { label: "b", value: null },
      { label: "c", value: 1e308 },
    ],
  });
  expect(geometry.segments).toHaveLength(2);
  expect(geometry.segments.every((p) => !/NaN|Infinity/.test(p))).toBe(true);
  expect(Number.isFinite(geometry.zero)).toBe(true);
});
