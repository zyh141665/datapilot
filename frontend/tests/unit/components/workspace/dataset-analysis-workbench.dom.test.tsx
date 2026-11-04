import { afterEach, expect, rs, test } from "@rstest/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { DatasetAnalysisWorkbench } from "@/components/workspace/dataset-analysis-workbench";
import { chartDataset, type DatasetInfo } from "@/core/datapilot/api";

rs.mock("@/core/datapilot/api", () => ({
  chartDataset: rs.fn(),
  analyzeDataset: rs.fn(),
}));
const dataset: DatasetInfo = {
  id: "a".repeat(32),
  name: "telemetry.csv",
  sheet: null,
  sha256: "b".repeat(64),
  row_count: 3,
  column_count: 2,
  missing_count: 0,
  columns: [
    {
      name: "time_slot",
      type: "number",
      missing: 0,
      sum: 4,
      mean: 4 / 3,
      min: 1,
      max: 2,
    },
    {
      name: "value",
      type: "number",
      missing: 0,
      sum: 70,
      mean: 70 / 3,
      min: 10,
      max: 40,
    },
  ],
};
const result = {
  version: 1 as const,
  kind: "chart" as const,
  source: dataset,
  query: { metric: "value", group_by: ["time_slot"], aggregation: "mean" },
  chart: {
    type: "bar" as const,
    title: "value · mean · 按time_slot",
    x_label: "time_slot",
    y_label: "原始数值",
    points: [
      { label: "1.0", value: 15 },
      { label: "2.0", value: 40 },
    ],
  },
};
afterEach(() => {
  cleanup();
  rs.resetAllMocks();
});

test("generic mode is the default and numeric statistics do not require a calendar date", () => {
  render(<DatasetAnalysisWorkbench owner="alice" dataset={dataset} />);
  expect(
    screen
      .getByRole("button", { name: "通用分析" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(screen.queryByLabelText("日期 / 月份字段")).toBeNull();
  fireEvent.change(screen.getByLabelText("通用数值字段"), {
    target: { value: "value" },
  });
  expect(screen.getByText("23.33")).toBeTruthy();
  expect(screen.getByText("70")).toBeTruthy();
  expect(chartDataset).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "销售经营分析" }));
  expect(screen.getByLabelText("日期 / 月份字段")).toBeTruthy();
});

test("chart calculation gives immediate pending feedback and accepts integer time slots", async () => {
  let resolve!: (value: typeof result) => void;
  rs.mocked(chartDataset).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  render(<DatasetAnalysisWorkbench owner="alice" dataset={dataset} />);
  fireEvent.change(screen.getByLabelText("通用数值字段"), {
    target: { value: "value" },
  });
  fireEvent.change(screen.getByLabelText("分组 / 横轴字段"), {
    target: { value: "time_slot" },
  });
  fireEvent.click(screen.getByRole("button", { name: "计算分组并生成图表" }));
  expect(
    screen.getByRole("button", { name: "正在计算…" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.getByRole("status").textContent).toContain("请求已提交");
  expect(chartDataset).toHaveBeenCalledWith("alice", dataset.id, {
    x: "time_slot",
    metric: "value",
    aggregation: "mean",
    kind: "bar",
  });
  resolve(result);
  await waitFor(() =>
    expect(screen.getByRole("img", { name: result.chart.title })).toBeTruthy(),
  );
  expect(screen.getByRole("status").textContent).toContain("请求耗时");
});
