# Agent guidance

The ticket defines the work. Implement its smallest coherent outcome and preserve
unrelated changes. Supporting project material is optional: inspect it when needed
to understand or complete the ticket. Do not perform recurring setup, audits or
unrelated improvements. Authors report concrete supplementary findings for automatic
Backlog creation in `supplementaryFindings`, using a stable kebab-case finding key,
concrete evidence and a requested outcome. Use `duplicateOfTaskId` when an existing
ticket already owns that outcome, otherwise null. The
project owner controls their priority.

Keep functions readable as a recipe: validate inputs, process the request,
finalise the result, then persist and return. Prefer atomic storage where partial
writes would leave broken state. Keep business rules on the server and use the
existing API error contract.

## Verification and completion

Test every changed exit through observable behavior, including rejection and
failure. Use real internal dependencies and disposable local storage; mock LLMs,
GitHub, Vercel and Neon at their external boundaries. Include integration coverage
where practical and a browser happy path plus a representative visible error.
Do not add tests that only assert their own fixtures or repeat implementation.

Run the complete `npm run check` on the final worktree, sequentially and without
running its constituents concurrently. Use focused checks to diagnose failures.
Do not repeat an unchanged failed command without a new hypothesis. Authors return
`COMPLETED` for delivered work with green local checks. If work remains incomplete,
preserve coherent changes and return `REVIEW_REQUIRED` with the failure and
remaining work. Review follows automatically. A justified response on a retained
PR can require no source edit; do not manufacture one.

Coding agents never perform hosted checks. Deployments, hosted browser tests,
provider smoke checks and remote CI retries belong to trusted automation or human
QA. Missing hosted evidence is not a coding failure. This overrides conflicting
ticket or historical instructions. Required Salable Test Mode catalog setup is
implementation within a billing ticket, as described in the reference below.

Reviewers assess the ticket and introduced regressions independently, keeping
tracked source and Git state unchanged. Run the authoritative local aggregate
once, without concurrent constituents. Required missing files are in-scope
implementation defects even when absent from the diff. Concrete out-of-scope
findings become non-blocking Backlog requests; do not turn them into active-ticket
repairs or search the whole project for supplementary work.

## Tools and references

The worker supplies Node/npm, Git, rg, Bash, curl, jq, Python 3, C/C++ build tools
and Chromium. Use the committed lockfile; no OS or browser bootstrap is needed.
For Playwright, use `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when set, with
`--no-sandbox` inside the isolated worker. Keep default writable tool caches.
`APP_BUILDER_TEST_DATABASE_URL`, when provided, is a disposable local PostgreSQL
fixture managed by the host; the worker does not need Docker access.

Project references are mounted read-only under `.app-builder/context`; its
`manifest.json` lists available documents. Installed Salable skills
(`salable-design`, `salable-develop`, `salable-init`) are discoverable through Codex.
Use them only when relevant. GitHub publication is platform-owned. Agents do not
receive Vercel, Neon, Preview/Production database or release credentials. Never
copy secrets or mounted documents into source or result summaries.

See [README](README.md) for project scripts and architecture and
[task-specific integrations](docs/agent-integrations.md) for auth, application
URLs, billing, migrations and product entry work. Dependency changes require the
active feature, a lockfile update and a justification; no unsolicited advisory
remediation or audit gate.
