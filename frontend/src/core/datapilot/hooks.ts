"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";

import { bindDataset, listDatasets, selectedDataset } from "./api";

export function useDatasets(owner: string) {
  return useQuery({
    queryKey: ["datapilot", "datasets", owner],
    queryFn: ({ signal }) => listDatasets(owner, signal),
    enabled: !!owner,
    staleTime: 30_000,
    retry: false,
  });
}

export function useDatasetSelection(
  owner: string,
  threadId: string,
  isNewThread: boolean,
  requestedId: string | null,
) {
  const scope = `${owner}:${threadId}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const queryClient = useQueryClient();
  const datasets = useDatasets(owner);
  const selection = useQuery({
    queryKey: ["datapilot", "selection", owner, threadId],
    queryFn: ({ signal }) => selectedDataset(owner, threadId, signal),
    enabled: !!owner && !isNewThread,
    retry: false,
  });
  const [local, setLocal] = useState<{
    scope: string;
    id: string;
    locked: boolean;
  } | null>(null);
  const bound = !isNewThread ? selection.data?.dataset : undefined;
  const picked = local?.scope === scope ? local : null;
  const desired = picked?.id ?? (isNewThread ? (requestedId ?? "") : "");
  const id = bound?.id ?? desired;
  const dataset = bound ?? datasets.data?.items.find((item) => item.id === id);
  const locked = !!bound || !!picked?.locked;
  const error = useMemo(
    () =>
      datasets.error ??
      selection.error ??
      (id && !dataset && !datasets.isPending
        ? new Error("所选数据集不存在或不属于当前账号，请重新选择。")
        : null),
    [datasets.error, selection.error, id, dataset, datasets.isPending],
  );
  const loading =
    !!owner && (datasets.isPending || (!isNewThread && selection.isPending));

  const choose = useCallback(
    (next: string) => {
      if (!locked) setLocal({ scope, id: next, locked: false });
    },
    [locked, scope],
  );

  const bind = useCallback(async () => {
    if (!id) return;
    if (error || loading || !dataset)
      throw new Error(error?.message ?? "数据集正在加载，请稍后发送。");
    const confirmed = await bindDataset(owner, threadId, id);
    if (currentScope.current !== scope)
      throw new Error("会话已切换，请在当前对话重新发送。");
    setLocal({ scope, id: confirmed.id, locked: true });
    queryClient.setQueryData(["datapilot", "selection", owner, threadId], {
      dataset: confirmed,
    });
  }, [dataset, error, id, loading, owner, queryClient, scope, threadId]);

  return {
    items: datasets.data?.items ?? [],
    dataset,
    id,
    locked,
    loading,
    error,
    choose,
    bind,
  };
}
