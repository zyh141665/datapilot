import { afterEach, expect, rs, test } from "@rstest/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { BusinessWorkbench } from "@/components/workspace/business-workbench";
import { analyzeDataset, type DatasetInfo } from "@/core/datapilot/api";

import { businessFixture } from "../../helpers/datapilot";

rs.mock("@/core/datapilot/api", () => ({ analyzeDataset: rs.fn() }));
const dataset: DatasetInfo = {
  ...businessFixture.source,
  column_count: 4,
  missing_count: 0,
  columns: [
    { name: "月份", type: "text", missing: 0 },
    { name: "区域", type: "text", missing: 0 },
    { name: "销售额", type: "number", missing: 0 },
    { name: "成本", type: "number", missing: 0 },
  ],
};
afterEach(() => {
  cleanup();
  rs.resetAllMocks();
});
function choose() {
  fireEvent.change(screen.getByLabelText("日期 / 月份字段"), {
    target: { value: "月份" },
  });
  fireEvent.change(screen.getByLabelText("销售额字段"), {
    target: { value: "销售额" },
  });
}

test("field mapping is explicit and calculation only runs after a user click", async () => {
  rs.mocked(analyzeDataset).mockResolvedValue(businessFixture);
  render(<BusinessWorkbench owner="alice" dataset={dataset} />);
  expect(
    screen.getByLabelText("日期 / 月份字段").getAttribute("required"),
  ).not.toBeNull();
  expect(
    screen
      .getByRole("button", { name: "计算指标并生成图表" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(analyzeDataset).not.toHaveBeenCalled();
  choose();
  fireEvent.click(screen.getByRole("button", { name: "计算指标并生成图表" }));
  await waitFor(() => expect(screen.getByText("经营分析结果")).toBeTruthy());
  expect(analyzeDataset).toHaveBeenCalledWith("alice", dataset.id, {
    date_column: "月份",
    revenue_column: "销售额",
  });
  fireEvent.change(screen.getByLabelText("成本字段（可选）"), {
    target: { value: "成本" },
  });
  expect(screen.queryByText("经营分析结果")).toBeNull();
});

test("calculation errors remain visible and no fake chart is displayed", async () => {
  rs.mocked(analyzeDataset).mockRejectedValue(
    new Error("日期有歧义，请先更正"),
  );
  render(<BusinessWorkbench owner="alice" dataset={dataset} />);
  choose();
  fireEvent.click(screen.getByRole("button", { name: "计算指标并生成图表" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "日期有歧义，请先更正",
  );
  expect(screen.queryByRole("img")).toBeNull();
});
