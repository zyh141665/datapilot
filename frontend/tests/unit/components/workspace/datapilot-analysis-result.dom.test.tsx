import { afterEach, expect, test } from "@rstest/core";
import { cleanup, render, screen } from "@testing-library/react";

import {
  AnalysisResultView,
  DataAnalysisResults,
  DataChart,
} from "@/components/workspace/datapilot-analysis-result";
import { ANALYSIS_TOOLS } from "@/core/datapilot/analysis";

import { businessFixture, chartFixture } from "../../helpers/datapilot";

afterEach(() => cleanup());

test("business result shows real metrics, comparison, source and an accessible chart table", () => {
  render(<AnalysisResultView result={businessFixture} />);
  expect(screen.getByRole("img", { name: "月度销售额趋势" })).toBeTruthy();
  expect(screen.getByText("230")).toBeTruthy();
  expect(screen.getByText(/本期 2026-10 对比基期 2026-09/)).toBeTruthy();
  expect(screen.getByText(/来源：sales.csv/)).toBeTruthy();
  expect(screen.getByText("查看图表数据")).toBeTruthy();
  expect(screen.getByText(/不自动包含退款/)).toBeTruthy();
});

test("missing costs remain unavailable with no fabricated profit", () => {
  render(
    <AnalysisResultView
      result={{
        ...businessFixture,
        totals: {
          ...businessFixture.totals,
          cost: null,
          profit: null,
          profit_margin_percent: null,
        },
        warnings: ["成本存在缺失，无法计算利润。"],
      }}
    />,
  );
  expect(screen.getAllByText("无法计算")).toHaveLength(3);
  expect(screen.getByText("成本存在缺失，无法计算利润。")).toBeTruthy();
  expect(screen.queryByText("230")).toBeNull();
});

test("negative bars and empty chart results render without unsafe markup", () => {
  const { container, rerender } = render(
    <DataChart
      chart={{
        ...chartFixture,
        type: "bar",
        points: [
          { label: "<script>bad</script>", value: -100 },
          { label: "空月", value: null },
        ],
      }}
    />,
  );
  expect(container.querySelector("script")).toBeNull();
  const bar = container.querySelector("rect")!;
  expect(Number(bar.getAttribute("height"))).toBeGreaterThan(0);
  expect(screen.getByText("无数据 / 无法计算")).toBeTruthy();
  rerender(<DataChart chart={{ ...chartFixture, points: [] }} />);
  expect(screen.getByText("筛选后没有可绘制的数据。")).toBeTruthy();
});

test("assistant prose and wrong tool names cannot create business result cards", () => {
  const message = {
    type: "ai",
    artifact: { datapilot_analysis: businessFixture },
  };
  const { rerender } = render(
    <DataAnalysisResults
      results={[{ key: "1", name: ANALYSIS_TOOLS.business, message }]}
    />,
  );
  expect(screen.queryByLabelText("数据分析结果")).toBeNull();
  rerender(
    <DataAnalysisResults
      results={[
        {
          key: "1",
          name: ANALYSIS_TOOLS.business,
          message: { ...message, type: "tool" },
        },
      ]}
    />,
  );
  expect(screen.getByLabelText("数据分析结果")).toBeTruthy();
});
