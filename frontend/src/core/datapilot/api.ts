import { fetch as fetchWithAuth } from "@/core/api/fetcher";
import { getBackendBaseURL } from "@/core/config";

import {
  analysisSchema,
  businessSchema,
  type BusinessRequest,
  type ChartRequest,
} from "./analysis";

export type DatasetColumn = {
  name: string;
  type: "number" | "text" | "empty";
  missing: number;
  sum?: number;
  mean?: number;
  min?: number;
  max?: number;
};
export type DatasetInfo = {
  id: string;
  name: string;
  sheet: string | null;
  sha256: string;
  row_count: number;
  column_count: number;
  missing_count: number;
  columns: DatasetColumn[];
};
export type DatasetProfile = DatasetInfo & {
  preview: Record<string, string | number | null>[];
  preview_cell_limit: number;
};
export type SheetChoice = { requires_sheet: true; sheets: string[] };

async function read<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as {
    detail?: unknown;
    error?: unknown;
  } | null;
  if (!response.ok || typeof body?.error === "string") {
    throw new Error(
      typeof body?.detail === "string"
        ? body.detail
        : typeof body?.error === "string"
          ? body.error
          : "数据服务暂不可用，请检查后端是否已重启并加载数据集模块。",
    );
  }
  return body as T;
}

function viewer(owner: string) {
  if (!owner) throw new Error("请先登录。");
  return { "X-DeerFlow-Plugin-Viewer": owner };
}

export async function listDatasets(owner: string, signal?: AbortSignal) {
  return read<{ items: DatasetInfo[] }>(
    await fetchWithAuth(`${getBackendBaseURL()}/api/datapilot/datasets`, {
      headers: viewer(owner),
      signal,
    }),
  );
}

export async function uploadDataset(owner: string, file: File, sheet?: string) {
  if (file.size > 5 * 1024 * 1024)
    throw new Error("文件超过 5 MiB，请先拆分。");
  const params = new URLSearchParams({ filename: file.name });
  if (sheet) params.set("sheet", sheet);
  return read<DatasetInfo | SheetChoice>(
    await fetchWithAuth(
      `${getBackendBaseURL()}/api/datapilot/datasets?${params}`,
      {
        method: "POST",
        headers: {
          ...viewer(owner),
          "Content-Type": "application/octet-stream",
        },
        body: file,
      },
    ),
  );
}

export async function getDataset(
  owner: string,
  id: string,
  signal?: AbortSignal,
) {
  return read<DatasetProfile>(
    await fetchWithAuth(
      `${getBackendBaseURL()}/api/datapilot/datasets/${encodeURIComponent(id)}`,
      { headers: viewer(owner), signal },
    ),
  );
}

async function action<T>(
  owner: string,
  name: "bind" | "selection",
  payload: Record<string, unknown>,
  signal?: AbortSignal,
) {
  return read<T>(
    await fetchWithAuth(
      `${getBackendBaseURL()}/api/plugins/datapilot.datasets/actions/${name}`,
      {
        method: "POST",
        headers: { ...viewer(owner), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal,
      },
    ),
  );
}

export function bindDataset(
  owner: string,
  threadId: string,
  datasetId: string,
) {
  return action<DatasetInfo>(owner, "bind", {
    thread_id: threadId,
    dataset_id: datasetId,
  });
}

export function selectedDataset(
  owner: string,
  threadId: string,
  signal?: AbortSignal,
) {
  return action<{ dataset: DatasetInfo | null }>(
    owner,
    "selection",
    { thread_id: threadId },
    signal,
  );
}

export async function analyzeDataset(
  owner: string,
  id: string,
  mapping: BusinessRequest,
) {
  const result = await read<unknown>(
    await fetchWithAuth(
      `${getBackendBaseURL()}/api/datapilot/datasets/${encodeURIComponent(id)}/analysis`,
      {
        method: "POST",
        headers: { ...viewer(owner), "Content-Type": "application/json" },
        body: JSON.stringify(mapping),
      },
    ),
  );
  const parsed = businessSchema.safeParse(result);
  if (!parsed.success)
    throw new Error("分析结果格式不兼容，请刷新页面并确认后端已重启。");
  return parsed.data;
}

export async function chartDataset(
  owner: string,
  id: string,
  request: ChartRequest,
) {
  const result = await read<unknown>(
    await fetchWithAuth(
      `${getBackendBaseURL()}/api/datapilot/datasets/${encodeURIComponent(id)}/chart`,
      {
        method: "POST",
        headers: { ...viewer(owner), "Content-Type": "application/json" },
        body: JSON.stringify(request),
      },
    ),
  );
  const parsed = analysisSchema.safeParse(result);
  if (!parsed.success || parsed.data.kind !== "chart")
    throw new Error("图表结果格式不兼容，请确认后端已重启。");
  return parsed.data;
}
