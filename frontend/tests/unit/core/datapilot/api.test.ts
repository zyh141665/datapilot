import { afterEach, expect, rs, test } from "@rstest/core";

import { fetch as fetchWithAuth } from "@/core/api/fetcher";
import {
  analyzeDataset,
  chartDataset,
  bindDataset,
  listDatasets,
  uploadDataset,
} from "@/core/datapilot/api";

import { businessFixture } from "../../helpers/datapilot";

rs.mock("@/core/api/fetcher", () => ({ fetch: rs.fn() }));
rs.mock("@/core/config", () => ({ getBackendBaseURL: () => "" }));
afterEach(() => {
  rs.resetAllMocks();
});

test("dataset calls carry the expected account fence through the auth fetcher", async () => {
  rs.mocked(fetchWithAuth).mockResolvedValue(
    new Response(JSON.stringify({ items: [] })),
  );
  await listDatasets("alice");
  expect(rs.mocked(fetchWithAuth).mock.calls[0]?.[1]?.headers).toEqual({
    "X-DeerFlow-Plugin-Viewer": "alice",
  });
});

test("binding sends identifiers, not the dataset content", async () => {
  rs.mocked(fetchWithAuth).mockResolvedValue(
    new Response(JSON.stringify({ id: "dataset" })),
  );
  await bindDataset("alice", "thread", "dataset");
  expect(rs.mocked(fetchWithAuth).mock.calls[0]?.[1]?.body).toBe(
    JSON.stringify({ thread_id: "thread", dataset_id: "dataset" }),
  );
});

test("a failed binding in a successful HTTP envelope still rejects", async () => {
  rs.mocked(fetchWithAuth).mockResolvedValue(
    new Response(JSON.stringify({ error: "此会话已绑定其他数据集" })),
  );
  await expect(bindDataset("alice", "thread", "other")).rejects.toThrow(
    "已绑定",
  );
});

test("oversized uploads are rejected before a request is sent", async () => {
  const file = { name: "large.csv", size: 6 * 1024 * 1024 } as File;
  await expect(uploadDataset("alice", file)).rejects.toThrow("5 MiB");
  expect(fetchWithAuth).not.toHaveBeenCalled();
});

test("business analysis uses authenticated owner-fenced HTTP and checks its response contract", async () => {
  rs.mocked(fetchWithAuth).mockResolvedValue(
    new Response(JSON.stringify(businessFixture)),
  );
  expect(
    (
      await analyzeDataset("alice", "dataset", {
        date_column: "月份",
        revenue_column: "销售额",
      })
    ).totals.revenue,
  ).toBe(500);
  const [url, options] = rs.mocked(fetchWithAuth).mock.calls[0]!;
  expect(url).toBe("/api/datapilot/datasets/dataset/analysis");
  expect(options?.headers).toHaveProperty("X-DeerFlow-Plugin-Viewer", "alice");
  rs.mocked(fetchWithAuth).mockResolvedValue(new Response("{}"));
  await expect(
    analyzeDataset("alice", "dataset", {
      date_column: "月份",
      revenue_column: "销售额",
    }),
  ).rejects.toThrow("格式不兼容");
});

test("generic chart requests retain account isolation without inventing date fields", async () => {
  const result = {
    version: 1,
    kind: "chart",
    source: businessFixture.source,
    query: {},
    chart: businessFixture.charts[0],
  };
  rs.mocked(fetchWithAuth).mockResolvedValue(
    new Response(JSON.stringify(result)),
  );
  await chartDataset("alice", "dataset", {
    x: "time_slot",
    metric: "value",
    aggregation: "mean",
  });
  const [url, options] = rs.mocked(fetchWithAuth).mock.calls[0]!;
  expect(url).toBe("/api/datapilot/datasets/dataset/chart");
  expect(options?.body).toBe(
    JSON.stringify({ x: "time_slot", metric: "value", aggregation: "mean" }),
  );
  expect(options?.headers).toHaveProperty("X-DeerFlow-Plugin-Viewer", "alice");
});
