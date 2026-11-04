import { afterEach, expect, rs, test } from "@rstest/core";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import { FeedbackLink } from "@/components/workspace/feedback-link";

const state = rs.hoisted(() => ({ pending: false }));
rs.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  useLinkStatus: () => ({ pending: state.pending }),
}));
afterEach(() => {
  cleanup();
  state.pending = false;
});
test("navigation preserves its destination and shows pending feedback", () => {
  const view = <FeedbackLink href="/workspace/data">开始分析</FeedbackLink>;
  const { rerender } = render(view);
  expect(
    screen.getByRole("link", { name: "开始分析" }).getAttribute("href"),
  ).toBe("/workspace/data");
  state.pending = true;
  rerender(<FeedbackLink href="/workspace/data">开始分析</FeedbackLink>);
  expect(screen.getByRole("link", { name: "正在打开…" })).toBeTruthy();
});
