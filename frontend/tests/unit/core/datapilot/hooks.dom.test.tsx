import { afterEach, expect, rs, test } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";

import {
  bindDataset,
  listDatasets,
  selectedDataset,
} from "@/core/datapilot/api";
import { useDatasetSelection } from "@/core/datapilot/hooks";

rs.mock("@/core/datapilot/api", () => ({
  listDatasets: rs.fn(),
  selectedDataset: rs.fn(),
  bindDataset: rs.fn(),
}));
const item = {
  id: "a",
  name: "sales.csv",
  sheet: null,
  sha256: "hash",
  row_count: 2,
  column_count: 1,
  missing_count: 0,
  columns: [],
};
function Wrapper({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
afterEach(() => {
  cleanup();
  rs.resetAllMocks();
});

test("a confirmed dataset binding cannot be switched inside the same chat", async () => {
  rs.mocked(listDatasets).mockResolvedValue({ items: [item] });
  rs.mocked(bindDataset).mockResolvedValue(item);
  const { result } = renderHook(
    () => useDatasetSelection("alice", "t", true, "a"),
    { wrapper: Wrapper },
  );
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => {
    await result.current.bind();
  });
  expect(result.current.locked).toBe(true);
  act(() => result.current.choose("other"));
  expect(result.current.id).toBe("a");
});

test("switching accounts does not reuse the previous account's selected dataset", async () => {
  rs.mocked(listDatasets).mockImplementation(async (owner) => ({
    items: owner === "alice" ? [item] : [],
  }));
  rs.mocked(selectedDataset).mockResolvedValue({ dataset: null });
  const { result, rerender } = renderHook(
    ({ owner }) => useDatasetSelection(owner, "t", true, null),
    { wrapper: Wrapper, initialProps: { owner: "alice" } },
  );
  await waitFor(() => expect(result.current.items.length).toBe(1));
  act(() => result.current.choose("a"));
  rerender({ owner: "bob" });
  expect(result.current.dataset).toBeUndefined();
  expect(result.current.id).toBe("");
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.items).toEqual([]);
});
