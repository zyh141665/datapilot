import { afterEach, expect, rs, test } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { DataWorkbench } from "@/components/workspace/data-workbench";
import { getDataset, listDatasets, uploadDataset } from "@/core/datapilot/api";

rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "alice" } }),
}));
rs.mock("@/core/datapilot/api", () => ({
  listDatasets: rs.fn(),
  uploadDataset: rs.fn(),
  getDataset: rs.fn(),
}));

const item = {
  id: "a".repeat(32),
  name: "销售演示数据（模拟）.csv",
  sheet: null,
  sha256: "hash",
  row_count: 8,
  column_count: 4,
  missing_count: 1,
  columns: [{ name: "成本", type: "number" as const, missing: 1 }],
};

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DataWorkbench />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  rs.resetAllMocks();
});

test("saved dataset opens a direct analysis chat without copying CSV", async () => {
  rs.mocked(listDatasets).mockResolvedValue({ items: [item] });
  rs.mocked(getDataset).mockResolvedValue({
    ...item,
    preview: [{ 成本: null }],
    preview_cell_limit: 120,
  });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /销售演示数据/ }));
  const link = await screen.findByRole("link", { name: "打开分析对话" });
  expect(link.getAttribute("href")).toBe(
    `/workspace/chats/new?dataset=${item.id}`,
  );
  expect(screen.getByText("缺失")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /复制/ })).toBeNull();
});

test("demo import saves through the authenticated data API", async () => {
  rs.mocked(listDatasets).mockResolvedValue({ items: [] });
  rs.mocked(uploadDataset).mockResolvedValue(item);
  rs.mocked(getDataset).mockResolvedValue({
    ...item,
    preview: [],
    preview_cell_limit: 120,
  });
  mount();
  fireEvent.click(screen.getByRole("button", { name: "导入演示数据" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain("数据集已保存"),
  );
  expect(rs.mocked(uploadDataset).mock.calls[0]?.[0]).toBe("alice");
});

test("XLSX sheet choice is explicit before saving a dataset", async () => {
  rs.mocked(listDatasets).mockResolvedValue({ items: [] });
  rs.mocked(uploadDataset)
    .mockResolvedValueOnce({ requires_sheet: true, sheets: ["销售", "退款"] })
    .mockResolvedValueOnce(item);
  rs.mocked(getDataset).mockResolvedValue({
    ...item,
    preview: [],
    preview_cell_limit: 120,
  });
  mount();
  const file = new File(["test"], "sales.xlsx");
  fireEvent.change(screen.getByLabelText("上传数据文件"), {
    target: { files: [file] },
  });
  fireEvent.change(await screen.findByLabelText("工作表"), {
    target: { value: "退款" },
  });
  fireEvent.click(screen.getByRole("button", { name: "确认导入" }));
  await waitFor(() =>
    expect(rs.mocked(uploadDataset).mock.calls[1]?.[2]).toBe("退款"),
  );
});

test("service failures remain visible rather than showing fabricated results", async () => {
  rs.mocked(listDatasets).mockRejectedValue(new Error("数据服务不可用"));
  mount();
  expect((await screen.findByRole("alert")).textContent).toContain(
    "数据服务不可用",
  );
  expect(screen.queryByRole("link", { name: "打开分析对话" })).toBeNull();
});
