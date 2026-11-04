"use client";

import Link, { useLinkStatus } from "next/link";
import type { ComponentProps, ReactNode } from "react";

function Label({ children }: { children: ReactNode }) {
  const { pending } = useLinkStatus();
  return (
    <span aria-live="polite" className="inline-flex items-center gap-2">
      {pending ? "正在打开…" : children}
    </span>
  );
}

export function FeedbackLink({
  children,
  ...props
}: ComponentProps<typeof Link>) {
  return (
    <Link {...props}>
      <Label>{children}</Label>
    </Link>
  );
}
