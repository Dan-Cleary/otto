# Changelog

Notable user-facing changes. Versioned loosely; the landing footer is the
source of truth for what's live in prod.

## 0.4 — 2026-05-11 — Widget-first

Big-picture product flip: Otto is now a widget product. Drop the snippet
on your app, your team flags bugs in QA or prod, Otto opens a draft PR
on the right repo. Meetings (Granola/Zoom) are deprecated.

### New

- **Per-project widget secrets.** Each project owns its own `data-secret`.
  The widget HTTP route resolves project + team from the secret alone — no
  more `data-project` attribute, no team-wide secret.
- **Pre-signup install docs at `/docs/install`.** Evaluators can see the
  snippet and trust-contract before committing to signup.
- **Widget UX Pass 1: click-to-listen.** Click otto → listening mode (no
  modal, you keep using the app). Click again → review modal. Escape
  cancels. Pulsing pixel REC dot + caption above the FAB while recording.
- **Project getting-started checklist.** Project detail surfaces every
  missing prerequisite (repo / cursor key / GitHub App / snippet) with
  inline actions. Snippet appears as soon as team setup is ready.
- **Project create modal** is name-only. Slug auto-derives. Other
  settings move to the in-project edit form.
- **Custom 404 page** with the error-otter sprite and one-click return.
- **Sign-out moved into Settings.**
- **Built by Dan Cleary** attribution on the landing footer (X icon).

### Changed

- **Nav collapses to Projects · Settings.** Activity, Repos, Members,
  Memory, Onboarding tabs are gone; their content moved into Settings
  or got dropped.
- **Setup gates simplified** to Cursor key + GitHub App. Widget snippet
  is configured per-project, not team-wide.
- **Wizard trimmed** to two required steps (Cursor, GitHub). Slack and
  repo-registration steps removed.
- **Sign-in / sign-up titles** distinct from dashboard. All admin pages
  are `noindex`.
- **GitHub install tokens** now used for PR verification when a team has
  the GitHub App installed (falls back to env PAT otherwise).
- **README rewritten** to match the widget-first product.

### Fixed

- **Snippet placeholder** — was hardcoded `YOUR-STATIC-HOST/otto.js`.
  Now defaults to `window.location.origin + "/otto.js"` so paste-and-go
  works on prod, preview, and localhost without manual edits.
- **Getting-started checklist links** — "go to settings →" used to be
  inert (`href="#"` + preventDefault). Now actually navigates to the
  Settings tab via a small custom-event bridge.
- **`/login` URL leak** — signed-in users sitting on `/login` now get
  `history.replaceState`'d to `/dashboard/` to match what they're seeing.
- **GitHub App callback** redirect added at `/auth/github/callback` →
  `/dashboard/` so post-install lands in the right place.

### Internals

- Convex prod deploys via `deploy-convex-prod` GitHub Actions job on
  every push to `main`.
- Vercel auto-deploys frontend via GitHub integration (`vercel git
  connect`).
- Convex widget bundle (`otto.js`) rebuilt as part of the Vercel build,
  not committed.
- URL-pattern matching, `urlPatterns` / `description` fields on
  `projects`, granola / zoom cron jobs all removed.

## Pre-0.4

Earlier versions of Otto were meeting-led: Granola transcripts and
Zoom recordings turned into PRs. That path still exists in the code
(`convex/granola.ts`, `convex/zoom.ts`) but no cron drives it and it's
not surfaced in the UI.

See git history for commit-level detail.
