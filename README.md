# Otto

Internal team tool that turns meeting notes and dashboard feedback into
draft pull requests. Granola-led — Otto attends nothing; it ingests
transcripts and widget submissions, extracts code-shaped action items,
routes them to a project's primary repo, and fires a Cursor agent that
opens a draft PR for human review.

## Layout

- `convex/` — backend. Schema, HTTP endpoints, parser, router, Cursor
  invocation, audit log, integrations (Granola, Zoom), team/auth.
- `widget/` — vanilla-JS feedback widget. Built with esbuild; sprites
  baked in as data URLs.
- `app/` — React + Vite admin app and the public marketing landing.
  Multi-page Vite setup: `/` is the landing, `/app/` is the React admin.

## Stack

- **Backend:** Convex (functions, scheduler, vector index, auth, cron).
- **Auth:** `@convex-dev/auth` password provider, gated by team membership.
- **Multi-tenant:** every admin-scoped table carries `teamId`; auto-create
  personal team on first sign-in (the very first user becomes admin of
  the `legacy` team and inherits any pre-existing data).
- **Routing:** widget feedback → URL-pattern → project → primary repo.
  Granola/Zoom transcripts → semantic match against repo embeddings.
  Below confidence threshold → Slack review queue.
- **Outbound code:** Cursor cloud agents. PRs always land as draft.

## Setup

```bash
npm install
CONVEX_DEPLOYMENT=dev:your-deployment npx convex dev   # syncs schema + functions
```

Required Convex env vars:

```bash
npx convex env set OPENAI_API_KEY sk-...
npx convex env set CURSOR_API_KEY cu-...
npx convex env set GITHUB_TOKEN ghp-...                # verifies draft:true on PRs
```

Per-team integrations are stored in the database — admins paste them
into the Onboarding tab. No more `WIDGET_SHARED_SECRET` env var; each
team rotates its own widget secret from the UI.

For Otto's hosted Zoom OAuth flow (one-click "Connect Zoom" for end
users), the operator also sets:

```bash
npx convex env set ZOOM_OAUTH_CLIENT_ID ...
npx convex env set ZOOM_OAUTH_CLIENT_SECRET ...
npx convex env set ZOOM_OAUTH_REDIRECT_URI https://<your>.convex.site/auth/zoom/callback
npx convex env set OAUTH_STATE_SECRET $(openssl rand -hex 32)
```

For Slack interactivity:

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
npm run dev                    # vite dev server (landing at /, admin at /app/)
npm run build                  # static build into app/dist
```

Don't run `npx convex dev` from inside `app/` — it'll repoint
`app/.env.local` at an anonymous local deployment. Always run convex
commands from the repo root.

## Smoke test

1. Sign in to `http://localhost:5173/app/` (creates a personal team).
2. Onboarding tab → rotate a widget secret, paste the snippet onto
   `localhost:5173/widget-demo.html`, file feedback.
3. Activity tab → row appears with `routedBy: url-pattern` if a
   project's URL pattern matched, otherwise the semantic router fills
   in `routerConfidence`.
4. Watch the daybook: `parsed → fired → pr_opened`. Audit log captures
   every transition.

## Integrations

| Source         | Auth                                    | Cron       | Where     |
|----------------|-----------------------------------------|------------|-----------|
| Widget         | per-team shared secret (in settings)    | n/a        | `convex/http.ts` `/ingest/widget` |
| Granola        | per-team API key (paste in UI)          | every 3 min| `convex/granola.ts` |
| Zoom (OAuth)   | Otto-published Marketplace app, one-click | every 5 min | `convex/zoom.ts` |
| Zoom (S2S)     | per-team Server-to-Server credentials   | every 5 min| `convex/zoom.ts` |
| Slack          | env vars (workspace-scoped)             | n/a        | `convex/slack.ts` |

Everything except Slack lives per-team in either `settings` (legacy)
or `integrations` (new). Cron actions fan out across teams.

## Trust contract

Encoded in `convex/cursorPrompt.ts` and `convex/cursor.ts:verifyDraft`:
- PRs are always draft.
- Scoped to the agent's branch.
- Original feedback + parser/router confidence land in the PR description.
- Existing tests cannot be weakened.
- Otto fails closed if it can't verify draft status (`failureReason` set,
  status flips to `failed`, item ends up in the Slack queue for human review).
