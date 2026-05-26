# package_scanner

A CLI scanner that parses `package-lock.json` and `bun.lock` files to map vulnerability exposure across your project's entire dependency tree.

## Demo

```
$ bun run scan ./my-project
Found 27 packages in bun.lock

══════════════════════════════════════════════════════════════
  SCAN SUMMARY
══════════════════════════════════════════════════════════════
  Packages scanned : 27
  Vulnerabilities  : 2 package(s) affected
══════════════════════════════════════════════════════════════

  ┌─ axios@1.1.1 (found in: bun.lock)  (19 advisory/ies)
  │  [GHSA-3p68-rc4w-qgx5] NO_PROXY Hostname Normalization Bypass → SSRF
  │    Aliases: CVE-2025-62718 | Published: 2026-04-09
  │  [GHSA-jr5f-v2jv-69x6] SSRF and Credential Leakage via Absolute URL
  │    Aliases: CVE-2025-27152 | Published: 2025-03-07
  │  … 17 more advisories
  └──────────────────────────────────────────────────────────
  ┌─ lodash@4.17.15  (6 advisory/ies)
  │  [GHSA-35jh-r3h4-6jhm] Command Injection in lodash
  │    Aliases: CVE-2021-23337 | Published: 2021-05-06
  │  … 5 more advisories
  └──────────────────────────────────────────────────────────
```

> _A scan of the included test fixture. Timestamps are trimmed here for readability; the tool prints full ISO timestamps._

## Why it exists

For solo developers and maintainers without dedicated security teams, vulnerability announcements usually mean manually hunting through lockfiles. This tool is built to answer the first question of incident response: **am I actually exposed, and where?** By scanning lockfiles directly against the OSV database, it maps precisely which local dependencies are affected and pulls their CVE aliases, advisory details, and timelines straight to your terminal.

## Install & Run

### Prerequisites

- [Bun](https://bun.sh) (>=1.3) — used as both runtime and package manager

### Setup

```bash
git clone https://github.com/Vatsal-Chovatiya/package_scanner.git
cd package_scanner
bun install
```

The scanner has **no runtime dependencies** — `bun install` only pulls dev tooling (`@types/bun`).

### Usage

```bash
# Scan a project directory (looks for package-lock.json or bun.lock)
bun run scan <path-to-project>

# Example: scan the included vulnerable test fixture
bun run scan tests/fixtures/vulnerable-project
```

The CLI exits with code `0` when no vulnerabilities are found, and `1` when vulnerabilities are found or when packages could not be checked — so it can gate a CI pipeline.

## Architecture

The project is split into two modules with a clean seam between computing results and displaying them:

- **`core/`** — identifies and parses lockfiles, queries the OSV API, and returns plain structured data. It knows nothing about terminals, stdout, or exit codes.
- **`cli/`** — takes a target path, calls `core`, and formats the structured results into human-readable terminal output.

This decoupling means the scanning engine is reusable behind other frontends (a REST API, a web dashboard, a CI runner) and the parsing/vulnerability logic can be unit-tested without mocking `process` or stdout.

### Data flow

1. **Entry point (`cli/index.ts`)** — accepts a project directory path and passes it to the parser.
2. **Parse (`core/parse-lockfile.ts`)** — searches for supported lockfiles (`package-lock.json` / `bun.lock`), extracts names and versions, and returns a deduplicated list of `{ name, version, lockfiles }` entries.
3. **Check (`core/check-vuln.ts`)** — sends packages to OSV's `querybatch` endpoint in batches (OSV's documented max is 1000 queries per request), collects the unique advisory IDs from the response, and fetches full details for only those flagged IDs.
4. **Output (`cli/index.ts`)** — correlates advisory details back to their packages and prints the summary and per-package breakdown.

### Design note: two-step, deduplicated OSV fetching

The OSV interaction is deliberately split in two: a bulk `querybatch` call returns only advisory IDs, which are deduplicated into a `Set` before any detail fetch. Because multiple packages can share the same advisory, deduplicating first means each advisory's full metadata is fetched exactly once. The detail fetches run through a fixed-size worker pool — a small set of workers pulling from a shared index — so the number of in-flight requests is bounded rather than firing all at once, keeping the tool a polite client of the OSV API.

## Limitations

- **Network dependency & strict exit codes.** The scanner is not offline-capable and requires network access to reach the OSV API. If the API is unreachable, slow, or rate-limits requests, the CLI reports the affected packages as failed checks and exits with code `1` — a network failure is treated as a failed scan so CI pipelines don't green-light untested code.
- **Reliance on the OSV database.** The scanner does no local code analysis; it flags a package only if a corresponding advisory has been reported and indexed by OSV.
- **Manual JSONC preprocessing.** Bun lockfiles use trailing commas that standard `JSON.parse` rejects, so the parser uses a hand-rolled stripper to sanitize them. It is not a full JSONC parser — it does not handle `//` or `/* */` comments, and a commented lockfile will fail to parse.
- **No dependency-introduction paths.** The dependency graph is flattened to a unique list of `name@version` before querying. This means the tool can tell you _that_ a transitive package is vulnerable, but not which top-level dependency pulled it in.

## Roadmap

- **Actionable remediation.** Move beyond "am I affected?" to "how do I fix it?" by parsing OSV's affected-version ranges to suggest the nearest safe upgrade that satisfies the project's semver constraints.
- **Workspace-aware monorepo mapping.** Read root `package.json` workspaces / `pnpm-workspace.yaml` to attribute vulnerable sub-packages to the specific workspace that introduces them.
- **More ecosystems.** Native parsers for `yarn.lock` and `pnpm-lock.yaml` for full coverage across major JS/TS package managers.
- **Offline cache.** An optional local snapshot of the OSV database for zero-network scanning.