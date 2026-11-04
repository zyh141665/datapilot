import { ArrowUpRight, ChartNoAxesCombined } from "lucide-react";

import { PRODUCT } from "@/core/brand";

import { FeedbackLink as Link } from "./workspace/feedback-link";

export function DataPilotLanding() {
  return (
    <main className="min-h-screen bg-[#0b1421] px-7 text-white md:px-20">
      <header className="mx-auto flex max-w-6xl items-center justify-between py-8">
        <Link
          href="/"
          className="flex items-center gap-3 text-xl font-semibold"
        >
          <ChartNoAxesCombined className="text-teal-300" />
          {PRODUCT.name}
        </Link>
        <Link
          href="/workspace/data"
          className="rounded-full border border-white/20 px-5 py-2 text-sm"
        >
          进入工作台 ↗
        </Link>
      </header>
      <section className="mx-auto grid max-w-6xl items-center gap-12 py-20 lg:grid-cols-2 lg:py-32">
        <div>
          <p className="text-xs tracking-[0.28em] text-teal-300">
            YOUR DATA. A CLEARER PICTURE.
          </p>
          <h1 className="mt-7 text-5xl leading-tight font-semibold tracking-tight md:text-6xl">
            让每一步分析，
            <br />
            <span className="text-teal-300">都有数据依据。</span>
          </h1>
          <p className="mt-7 max-w-md text-base leading-8 text-slate-400">
            从表格预览到工具计算，再到 Agent
            解读。把模糊的问题，变成看得见、查得到的分析过程。
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link
              href="/workspace/data"
              className="flex items-center gap-2 rounded-xl bg-teal-300 px-6 py-3 font-semibold text-slate-950"
            >
              开始分析
              <ArrowUpRight size={18} />
            </Link>
            <Link
              href="/workspace/chats/new"
              className="rounded-xl border border-white/20 px-6 py-3"
            >
              与 Agent 对话
            </Link>
          </div>
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-7 shadow-2xl">
          <div className="flex items-center justify-between border-b border-white/10 pb-5">
            <span className="text-sm font-medium">从问题到证据</span>
            <span className="rounded-full bg-teal-300/10 px-3 py-1 text-xs text-teal-300">
              分析工作流
            </span>
          </div>
          <div className="mt-7 space-y-6">
            {[
              ["01", "先看清数据", "检查字段、缺失值与数据形态"],
              ["02", "让工具计算", "经营指标、月份对比与分组变化贡献"],
              ["03", "再解释结果", "生成趋势图与对比图，依据计算结果回答"],
            ].map(([n, title, description]) => (
              <div key={n} className="flex items-start gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-teal-300/10 text-sm text-teal-300">
                  {n}
                </span>
                <div>
                  <h2 className="font-medium">{title}</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-400">
                    {description}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-8 border-t border-white/10 pt-5 text-xs leading-6 text-slate-500">
            CSV / XLSX · 经营指标 · 月份对比 · 数据图表
          </p>
        </div>
      </section>
      <footer className="mx-auto max-w-6xl border-t border-white/10 py-7 text-xs text-slate-500">
        DataPilot · 基于 DeerFlow 开源框架扩展 ·{" "}
        <a href="https://github.com/bytedance/deer-flow" className="underline">
          上游项目
        </a>
      </footer>
    </main>
  );
}
