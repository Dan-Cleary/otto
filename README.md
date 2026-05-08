# Otto

Drop a widget into your app. Your team flags bugs while testing — qa or
prod. Otto reads each report, finds the relevant code, and opens a draft
pull request on the right repo. Never auto-merges.

Live at [ottoagent.app](https://ottoagent.app).

## Layout

- `convex/` — backend. Schema, HTTP endpoints, parser, router, Cursor
  invocation, audit log, GitHub App, team/auth.
- `widget/` — vanilla-JS feedback widget. Built with esbuild; otter
  sprites baked in as data URLs.
- `app/` — React + Vite admin app and the public marketing landing.
  Multi-page Vite setup: `/` is the landing, `/dashboard/` is the
  React admin.

## Stack

- **Backend:** Convex (functions, scheduler, vector index, auth, cron).
- **Auth:** `@convex-dev/auth` password provider, gated by team
  membership.
- **Multi-tenant:** every admin-scoped table carries `teamId`; auto-create
  personal team on first sign-in.
- **Widget routing:** each project owns its own widget secret. The
  snippet's `data-secret` tells the server which project (and team) the
  feedback belongs to. No URL-pattern matching, no team-wide secret.
- **Item routing:** widget event → project's primary repo. If a project
  has no primary repo (or for any non-widget source), the semantic
  router picks one from repo embeddings. Below confidence threshold →
  Slack review queue.
- **Outbound code:** Cursor cloud agents. PRs always land as draft;
  `cursor.ts:verifyDraft` fails closed if the opened PR isn't draft.
- **GitHub:** per-team GitHub App install. PR verification mints a
  short-lived installation token via `internal.github.getInstallToken`,
  falling back to `GITHUB_TOKEN` env on teams without the app installed.

## Setup

```bash
npm install
CONVEX_DEPLOYMENT=dev:your-deployment npx convex dev   # syncs schema + functions
```

Required Convex env vars on the prod deployment:

```bash
npx convex env set OPENAI_API_KEY sk-...
npx convex env set CURSOR_API_KEY cu-...               # fallback when no team key set
npx convex env set GITHUB_TOKEN ghp-...                # fallback PAT for PR verify
```

Per-team integrations (Cursor key, GitHub App install) are stored in
the database — admins wire them up from Settings.

For the GitHub App (one-click install per team), the operator also
sets:

```bash
npx convex env set GITHUB_APP_ID ...
npx convex env set GITHUB_APP_SLUG otto-agent-app
npx convex env set GITHUB_APP_CLIENT_ID ...
npx convex env set GITHUB_APP_CLIENT_SECRET ...
npx convex env set GITHUB_APP_PRIVATE_KEY "$(cat path/to/key.pem)"
npx convex env set GITHUB_APP_WEBHOOK_SECRET ...
```

For Slack interactivity (low-confidence review queue):

```bash
npx convex env set SLACK_BOT_TOKEN xoxb-...
npx convex env set SLACK_SIGNING_SECRET ...
npx convex env set SLACK_REVIEW_CHANNEL C0123456789
```

## Day-to-day

```bash
# from repo root
npm test                       # vitest, runs the convex-test pipeline suite
npm run widget:build           # rebuild widget bundle into app/public/otto.js

# from app/
npm run dev                    # vite dev server (landing at /, admin at /dashboard/)
npm run build                  # static build into app/dist
```

Don't run `npx convex dev` from inside `app/` — it'll repoint
`app/.env.local` at an anonymous local deployment. Always run convex
commands from the repo root.

## Deployment

- **Frontend:** Vercel auto-deploys `main` (GitHub integration is wired
  via `vercel git connect`). Output dir is `app/dist`.
- **Backend:** GitHub Actions `deploy-convex-prod` job (in
  `.github/workflows/ci.yml`) runs `npx convex deploy` on every push
  to `main` using the `CONVEX_DEPLOY_KEY` repo secret.

## Smoke test

1. Sign in to `http://localhost:5173/dashboard/` (creates a personal team).
2. Settings → wire up the Cursor key + install the GitHub App.
3. Projects → create a project → set its primary repo from the edit
   form.
4. Project detail page → copy the snippet (it has the project's
   `data-secret` baked in) → paste onto `localhost:5173/widget-demo.html`
   → file feedback.
5. Project detail's Activity table fills in. Watch status:
   `parsed → fired → pr_opened`. Audit log captures every transition.

## Integrations

| Source  | Auth                                | Cron        | Where               |
|---------|-------------------------------------|-------------|---------------------|
| Widget  | per-project secret (auto-generated) | n/a         | `convex/http.ts` `/ingest/widget` |
| GitHub  | per-team App installation           | n/a         | `convex/github.ts`  |
| Cursor  | per-team API key (paste in UI)      | n/a         | `convex/cursor.ts`  |
| Slack   | workspace env vars                  | n/a         | `convex/slack.ts`   |
| Repos   | n/a                                 | daily 08:00 UTC | `convex/repos.ts` (reindex embeddings) |

`convex/granola.ts` and `convex/zoom.ts` are still in the tree but
aren't surfaced in the product or driven by any cron — leftovers from
an earlier meeting-led version of Otto. Safe to delete when nothing
references them anymore.

## Trust contract

Encoded in `convex/cursorPrompt.ts` and `convex/cursor.ts:verifyDraft`:

- PRs are always draft.
- Scoped to the agent's branch.
- Original feedback + parser/router confidence land in the PR description.
- Existing tests cannot be weakened.
- Otto fails closed if it can't verify draft status (`failureReason`
  set, status flips to `failed`, item ends up in the Slack queue for
  human review).
