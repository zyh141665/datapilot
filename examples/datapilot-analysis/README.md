# DataPilot datasets and analysis tools (0.2)

DataPilot adds a real dataset-to-chat workflow to DeerFlow through the public extension API. Business code never imports private app/harness modules.

## User flow

1. Sign in and open `/workspace/data`.
2. Upload UTF-8 CSV or XLSX. A multi-sheet workbook asks for an explicit sheet before saving. The sample is labelled synthetic.
   The default general-analysis panel displays numeric summaries and computes grouped bar/line charts without a calendar date. Sales-business month/profit analysis is a separate mode.
3. Select a saved dataset and click **打开分析对话**.
4. Type a question. The browser pre-creates the normal authenticated thread, then binds the dataset through an owner-authorized plugin action before submitting the model request.
5. The model can inspect and query the selected dataset without copied CSV text. Refresh/restart retains the selection. One chat has one immutable dataset binding; use a new chat to change data.

No model call is triggered by upload, selection or opening a chat. The user explicitly sends questions.

## Data and identity

The operator config owns an absolute SQLite `storage_path`; the setup helper selects `backend/.deer-flow/data/datapilot.sqlite`. Datasets contain normalized rows, column profiles, worksheet identity and SHA-256 of the source file. Original file bytes are not retained. Every dataset and binding operation includes the server-resolved owner. Browser IDs never establish ownership. Binding separately uses host AgentRuns.get_state to recheck thread authorization. The plugin exposes no delete or mutation tool.

Browser API calls use the existing credential/CSRF fetcher and an account-switch fence. Model tools use the host-supplied ToolContext principal and thread ID. Frontend caches are keyed by account/thread; old account responses cannot become a new account's selection.

## Tools

- `list_datasets`: metadata for the authenticated owner's datasets.
- `describe_dataset`: actual columns/types/missing counts/statistics plus a bounded sample of the conversation's selected dataset.
- `query_dataset`: AND filters, field projection, up to two grouping columns, sum/mean/count/min/max, ordering, at most 100 result rows, query parameters and source hash. No SQL or code parameter. Count without a metric counts rows; count with a metric excludes null cells.
- `analyze_business`: explicit date/revenue/cost/dimension field mapping, monthly totals, ratio-of-sums margin, month comparison and signed additive sales-change contributions. Optional unit is never inferred. Returns ready-to-render trend/contribution charts, scope, source and calculation rules.
- `create_dataset_chart`: bar/line charts computed through the existing owner-bound query path. Filters apply before grouping. At most 50 categories; overflow is rejected, never silently truncated. Model-supplied values, HTML and code are not accepted. Line charts order the selected labels; calendar-month bucketing belongs to business analysis.
- Existing `analyze_csv` remains for small CSV text supplied explicitly in a prompt.

The host namespaces the five plugin tool names. Model calls cannot choose another owner, thread or dataset ID. SQL is constructed from validated identifiers and fixed operators, and values are bound parameters in a temporary SQLite database. Query results exceeding 48 KiB are rejected with a request to narrow the query; `has_more` reports row limiting. These results support descriptive analysis, not proof of business causality.

## Business workflow and chart contract

The selected dataset's workbench has an explicit mapping form. `POST /api/datapilot/datasets/{id}/analysis` resolves the authenticated owner and runs the same pure calculation as the Agent tool; it does not invoke a model. HTTP request parameters are capped at 16 KiB. The business module uses only this dataset, with no arbitrary formulas or code execution.

`POST /api/datapilot/datasets/{id}/chart` exposes the same owner-bound grouped-chart computation for the general form. Numeric `time_slot` values are grouped as numbers, not parsed as dates. Both routes report their calculation-path duration with `Server-Timing`. Binding resolution and metadata authorization no longer load/decode the full row payload; a calculation reads the rows once. This reduces redundant work without adding an unbounded data cache or weakening account checks.

Dates support YYYY-MM, YYYY-MM-DD, ISO timestamps, year-first slash dates and YYYY年M月. Invalid/ambiguous dates reject the analysis; missing dates are counted and excluded. An analysis spans at most 24 calendar months. Range defaults to all valid dated rows; current month defaults to the latest observed month in range, baseline to the previous calendar month. Both comparison samples come from the selected range. Missing months remain gaps. Revenue/cost omissions make the dependent metric unavailable rather than treating missing values as zero. An absent group in an otherwise observed month has zero sales for change decomposition. Growth needs a positive baseline; profit margin needs positive sales. Profit is only selected revenue minus selected cost, not accounting net profit. Contribution shares can be negative or exceed 100%; a zero net change has no share percentage.

The two new tools use the public `PluginToolResult` content-and-artifact contract (extension API >=0.2.10). The artifact has `datapilot_analysis.version=1` and a `business` or `chart` kind. One result is capped at 29 KiB to fit both text and artifact in the host's 64 KiB envelope. History retains the tool artifact; no separate chart file or extra database is created. The frontend renders bounded numeric SVG charts with React, never injected HTML. It accepts only successful artifacts correlated with the exact host-namespaced tool call, validates the version/schema and keeps raw numeric tables available. No extra chart dependency or Agent Bash permission is needed.

## Limits

- File: 5 MiB; parsed dataset: 8 MiB; 10,000 data rows; 50 unique columns (case-insensitive).
- Up to 20 saved datasets per account, 20 sheets per workbook; one sheet per dataset.
- Cell text: 1,024 characters; header: 100 characters. Numeric-looking IDs with leading zeroes remain text.
- XLSX only (not XLS); formulas are rejected rather than silently treated as cached or calculated values. Convert formulas to values before importing.
- Business analysis: 24 consecutive calendar months; up to 50 contribution groups. Standalone charts: 50 categories. Larger results require a narrower range/filter.
- Unsupported: report export, joins, forecasting, deleting datasets and changing an existing chat's dataset.

## Installation

From the repository root, use the portable environment, then `uv sync --project backend` and `backend/.venv/Scripts/python.exe scripts/datapilot_setup.py` on Windows. Restart `make dev` to load the startup-only plugin. The setup helper preserves other config entries and never displays credentials; the private backup is ignored by Git. Its plugin config must not be committed with deployment-specific values.

## Offline verification

Run `../../backend/.venv/Scripts/python.exe -m pytest tests -q` in this directory. Tests cover parsing, workbook choice, persistence, isolation, binding, query validation, actual HTTP routes, and the real host tool wrapper. The wrapper integration test expects the installed backend environment. On Windows a restricted sandbox may block TestClient's local event-loop socket; run the offline suite outside that sandbox without changing app authentication.

Frontend tests in `tests/unit/core/datapilot/` and `data-workbench.dom.test.tsx` verify API handoff, account fences, immutable selection and sheet choice. Real provider validation is deliberately performed by the user. DeerFlow retains ownership of authentication, conversation storage, runtime and delegation; preserve its MIT attribution.

Business calculation, HTTP/artifact integration, field mapping, numerical chart geometry and message-history rendering have additional offline tests. See [the Chinese acceptance guide](../../docs/datapilot/business-analysis.md) for expected results and explicit browser/model verification limits.
