"use client";

import Link from "next/link";

import type { DatasetInfo } from "@/core/datapilot/api";

export function DatasetSelector({
  items,
  selected,
  locked,
  loading,
  disabled,
  error,
  onChange,
}: {
  items: DatasetInfo[];
  selected: string;
  locked: boolean;
  loading: boolean;
  disabled: boolean;
  error: Error | null;
  onChange: (id: string) => void;
}) {
  return (
    <div className="mb-3 rounded-xl border border-teal-500/20 bg-teal-500/5 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="datapilot-dataset" className="font-medium">
          分析数据集
        </label>
        <select
          id="datapilot-dataset"
          aria-label="分析数据集"
          value={selected}
          disabled={disabled || locked || loading}
          onChange={(event) => onChange(event.target.value)}
          className="bg-background min-w-0 flex-1 rounded-md border px-2 py-1"
        >
          <option value="">
            {loading ? "正在加载…" : "普通对话，不使用数据集"}
          </option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
              {item.sheet ? ` / ${item.sheet}` : ""} · {item.row_count} 行
            </option>
          ))}
        </select>
        <Link
          href="/workspace/data"
          className="text-teal-700 underline dark:text-teal-300"
        >
          管理数据集
        </Link>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {error.message}
        </p>
      )}
      <p className="text-muted-foreground mt-2 text-xs">
        {locked
          ? "已固定绑定此会话。分析其他数据请新建对话。"
          : "选择后直接提问；第一次发送时绑定，计算结果由分析工具返回。"}
      </p>
    </div>
  );
}
