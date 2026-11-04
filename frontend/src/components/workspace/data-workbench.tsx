"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  ChartNoAxesCombined,
  FileSpreadsheet,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";

import { useAuth } from "@/core/auth/AuthProvider";
import { PRODUCT } from "@/core/brand";
import { getDataset, uploadDataset } from "@/core/datapilot/api";
import { SAMPLE_CSV } from "@/core/datapilot/csv";
import { useDatasets } from "@/core/datapilot/hooks";

import { DatasetAnalysisWorkbench } from "./dataset-analysis-workbench";
import { FeedbackLink as Link } from "./feedback-link";

export function DataWorkbench() {
  const { user } = useAuth();
  const owner = user?.id ?? "";
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const generation = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const datasets = useDatasets(owner);
  const [selection, setSelection] = useState<{
    owner: string;
    id: string;
  } | null>(null);
  const [pending, setPending] = useState<{
    owner: string;
    file: File;
    sheets: string[];
    sheet: string;
  } | null>(null);
  const [operation, setOperation] = useState<{
    owner: string;
    busy: boolean;
    error?: string;
    notice?: string;
  } | null>(null);
  const selectedId = selection?.owner === owner ? selection.id : "";
  const activePending = pending?.owner === owner ? pending : null;
  const state = operation?.owner === owner ? operation : null;
  const profile = useQuery({
    queryKey: ["datapilot", "profile", owner, selectedId],
    queryFn: ({ signal }) => getDataset(owner, selectedId, signal),
    enabled: !!owner && !!selectedId,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });

  async function upload(file: File, sheet?: string) {
    const token = ++generation.current;
    setOperation({ owner, busy: true });
    try {
      const result = await uploadDataset(owner, file, sheet);
      if (currentOwner.current !== owner || generation.current !== token)
        return;
      if ("requires_sheet" in result) {
        setPending({
          owner,
          file,
          sheets: result.sheets,
          sheet: result.sheets[0] ?? "",
        });
        setOperation({
          owner,
          busy: false,
          notice: "请选择需要导入的工作表；确认后才会保存为数据集。",
        });
        return;
      }
      setPending(null);
      setSelection({ owner, id: result.id });
      setOperation({
        owner,
        busy: false,
        notice: "数据集已保存。现在可以直接打开分析对话，无需复制表格。",
      });
      await queryClient.invalidateQueries({
        queryKey: ["datapilot", "datasets", owner],
      });
    } catch (cause) {
      if (currentOwner.current !== owner || generation.current !== token)
        return;
      setOperation({
        owner,
        busy: false,
        error: cause instanceof Error ? cause.message : "上传失败，请重试。",
      });
    }
  }

  const error =
    state?.error ?? datasets.error?.message ?? profile.error?.message;
  const data = profile.data;
  return (
    <main className="h-full overflow-y-auto bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto max-w-6xl space-y-7 px-6 py-10 md:px-12">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-sm font-semibold">
            <ChartNoAxesCombined className="text-teal-600" />
            {PRODUCT.name} / 数据工作台
          </div>
          <Link
            href="/workspace/chats/new"
            className="rounded-full border px-5 py-2 text-sm"
          >
            普通对话 ↗
          </Link>
        </header>
        <section className="relative overflow-hidden rounded-3xl bg-slate-900 p-8 text-white md:p-10">
          <div className="absolute -top-20 -right-12 h-64 w-64 rounded-full bg-teal-500/15 blur-3xl" />
          <p className="relative text-xs tracking-[0.24em] text-teal-300">
            DATA → INSIGHT
          </p>
          <h1 className="relative mt-4 text-3xl font-semibold md:text-4xl">
            上传一次，围绕数据持续提问。
          </h1>
          <p className="relative mt-4 max-w-2xl text-sm leading-7 text-slate-300">
            数据集保存到当前账号。选择一份数据打开分析对话，由工具完成筛选、分组和统计，模型根据计算结果解释。
          </p>
          <div className="relative mt-6 flex flex-wrap gap-3">
            <button
              disabled={(state?.busy ?? false) || !owner}
              onClick={() => input.current?.click()}
              className="flex items-center gap-2 rounded-xl bg-teal-400 px-5 py-3 text-sm font-semibold text-slate-950 disabled:opacity-50"
            >
              <Upload size={17} />
              {state?.busy ? "正在处理…" : "上传 CSV / XLSX"}
            </button>
            <button
              disabled={(state?.busy ?? false) || !owner}
              onClick={() =>
                void upload(
                  new File([SAMPLE_CSV], "销售演示数据（模拟）.csv", {
                    type: "text/csv",
                  }),
                )
              }
              className="rounded-xl border border-white/20 px-5 py-3 text-sm disabled:opacity-50"
            >
              导入演示数据
            </button>
          </div>
          <input
            ref={input}
            aria-label="上传数据文件"
            type="file"
            accept=".csv,.xlsx"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void upload(file);
            }}
          />
          <p className="relative mt-5 text-xs leading-6 text-slate-400">
            最大 5 MiB · 10,000 行 / 50 列 · CSV 请使用 UTF-8 · XLSX
            支持选择工作表，公式请先转换为值
          </p>
        </section>
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"
          >
            {error}
          </p>
        )}
        {state?.notice && (
          <p
            role="status"
            className="rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm text-teal-800"
          >
            {state.notice}
          </p>
        )}
        {activePending && (
          <section className="bg-background flex flex-wrap items-center gap-3 rounded-2xl border p-5">
            <span className="text-sm">{activePending.file.name}</span>
            <label htmlFor="workbook-sheet" className="text-sm">
              工作表
            </label>
            <select
              id="workbook-sheet"
              value={activePending.sheet}
              onChange={(event) =>
                setPending({ ...activePending, sheet: event.target.value })
              }
              className="bg-background rounded-lg border p-2 text-sm"
            >
              {activePending.sheets.map((sheet) => (
                <option key={sheet}>{sheet}</option>
              ))}
            </select>
            <button
              disabled={state?.busy}
              onClick={() =>
                void upload(activePending.file, activePending.sheet)
              }
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm text-white"
            >
              确认导入
            </button>
          </section>
        )}
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">我的数据集</h2>
            <span className="text-muted-foreground text-xs">
              仅显示当前账号的数据 · 最多保存 20 份
            </span>
          </div>
          {datasets.isPending ? (
            <p className="text-muted-foreground text-sm">正在读取数据集…</p>
          ) : datasets.data?.items.length ? (
            <div className="grid gap-3 md:grid-cols-3">
              {datasets.data.items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelection({ owner, id: item.id })}
                  aria-pressed={selectedId === item.id}
                  className={`bg-background rounded-xl border p-5 text-left ${selectedId === item.id ? "border-teal-500 ring-1 ring-teal-500" : ""}`}
                >
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet
                      size={17}
                      className="shrink-0 text-teal-600"
                    />
                    <span className="truncate text-sm font-medium">
                      {item.name}
                    </span>
                  </div>
                  <p className="text-muted-foreground mt-3 text-xs">
                    {item.sheet ? `${item.sheet} · ` : ""}
                    {item.row_count} 行 · {item.column_count} 列 ·{" "}
                    {item.missing_count} 个缺失值
                  </p>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
              还没有数据集。上传文件或导入模拟销售数据后开始分析。
            </p>
          )}
        </section>
        {profile.isFetching && selectedId && (
          <p className="text-muted-foreground text-sm">正在读取数据预览…</p>
        )}
        {data && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                ["数据行数", data.row_count],
                ["字段数量", data.column_count],
                ["缺失单元格", data.missing_count],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="bg-background rounded-2xl border p-6"
                >
                  <p className="text-muted-foreground text-sm">{label}</p>
                  <p className="mt-3 text-3xl font-semibold tabular-nums">
                    {value}
                  </p>
                </div>
              ))}
            </div>
            <section className="bg-background overflow-hidden rounded-2xl border">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-5">
                <div>
                  <h2 className="font-semibold">{data.name}</h2>
                  <p className="text-muted-foreground mt-1 text-xs">
                    前 20 行预览 · 长文本最多显示 120 字符 · 原数据保留
                  </p>
                </div>
                <Link
                  href={`/workspace/chats/new?dataset=${encodeURIComponent(data.id)}`}
                  className="flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm text-white"
                >
                  打开分析对话
                  <ArrowUpRight size={15} />
                </Link>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      {data.columns.map((column) => (
                        <th key={column.name} className="px-6 py-3 font-medium">
                          {column.name}
                          <span className="text-muted-foreground ml-2 text-xs font-normal">
                            {column.type === "number"
                              ? "数值"
                              : column.type === "empty"
                                ? "空列"
                                : "文本"}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.preview.map((row, i) => (
                      <tr key={i} className="border-t">
                        {data.columns.map((column) => (
                          <td
                            key={column.name}
                            className="max-w-64 truncate px-6 py-3"
                          >
                            {row[column.name] === null ? (
                              <span className="text-muted-foreground">
                                缺失
                              </span>
                            ) : (
                              String(row[column.name] ?? "")
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <DatasetAnalysisWorkbench
              key={`${owner}:${data.id}`}
              owner={owner}
              dataset={data}
            />
            <p className="text-muted-foreground text-xs">
              可提问：“按区域汇总销售额”“只看销售额大于 12,000
              的记录”“销售额最高的五条记录”。数据本身不能直接证明业务变化的原因。
            </p>
          </>
        )}
      </div>
    </main>
  );
}
