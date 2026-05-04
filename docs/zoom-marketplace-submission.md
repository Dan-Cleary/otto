# Zoom Marketplace submission packet

Everything you need to paste into the Zoom Marketplace OAuth app
form. Generated for Otto's published Marketplace flow (one-click
"Connect Zoom" for end users).

> **Where to start:** [marketplace.zoom.us/develop/create](https://marketplace.zoom.us/develop/create) → **OAuth** → click **Create**.

---

## Basic information

| Field | Value |
|---|---|
| App name | `otto` |
| Short name (URL slug) | `otto` |
| Choose app type | **Account-level app** |
| Would you like to publish this app on the Zoom App Marketplace? | **Yes** |

---

## App credentials

After creation, Zoom will show you Client ID and Client Secret.
**Send them to me** so I can set them on prod:

```
ZOOM_OAUTH_CLIENT_ID     = (from Zoom)
ZOOM_OAUTH_CLIENT_SECRET = (from Zoom)
```

I'll run:
```bash
npx convex env set --prod ZOOM_OAUTH_CLIENT_ID "..."
npx convex env set --prod ZOOM_OAUTH_CLIENT_SECRET "..."
```

(`ZOOM_OAUTH_REDIRECT_URI` and `OAUTH_STATE_SECRET` are already set
on prod.)

---

## OAuth — Redirect URL for OAuth

```
https://ottoagent.app/auth/zoom/callback
```

The Vercel `vercel.json` already proxies this path to your Convex
deployment, so reviewers only ever see the `ottoagent.app` domain.

## OAuth — OAuth allow list

```
https://ottoagent.app
```

## OAuth — Subdomain check

Leave **Strict** mode on.

---

## Information

### App icon

Upload `https://ottoagent.app/app-icon.png` (1024×1024, paper background, otter sprite).
You can also download it locally from `app/public/app-icon.png` in this repo.

### Short description (max 80 chars)

```
otto joins your meetings and ships the changes you discuss as draft pull requests.
```

### Long description (use markdown)

```
otto is an engineering agent that turns meeting transcripts into draft pull requests.

connect zoom once and otto pulls every new cloud-recording transcript on its own — never joins your calls. it extracts code-shaped action items from each meeting, finds the relevant repo, and opens a draft pr you can review and merge.

otto never auto-merges. every output is a small, reviewable diff with the original transcript attached.

how it works:
- otto polls your zoom account every 5 minutes for new cloud recordings with auto-generated transcripts
- the transcript is parsed for action items that map to code changes
- each action item is routed to the right github repository based on your project configuration
- a draft pull request is opened on github with the change, the original transcript excerpt, and a confidence score
- low-confidence items go to a slack review queue instead of auto-firing

we never store audio or video. we never join meetings.
```

### Long description (alt: short version if Zoom limits length)

```
otto turns zoom meeting transcripts into draft pull requests on github. it polls your zoom account for new cloud recordings, pulls the auto-generated transcripts, extracts code-shaped action items, and opens reviewable prs on the right repo. otto never joins meetings, never auto-merges, and never stores audio or video.
```

### Documentation link

```
https://ottoagent.app
```

(Until we build a separate docs site, the marketing page covers the
"what does otto do" question.)

### Support contact name

```
Dan Cleary
```

### Support contact email

```
support@ottoagent.app
```

> Email forwarding is not yet wired (Cloudflare Email Routing or
> equivalent). Set `support@ottoagent.app` to forward to
> `dancleary54@gmail.com` before submitting for review — Zoom verifies
> the address is reachable.

### Support URL

```
https://ottoagent.app
```

### Privacy policy URL

```
https://ottoagent.app/legal/privacy
```

### Terms of use URL

```
https://ottoagent.app/legal/terms
```

### Company name

```
Tethered Software Inc.
```

---

## Scopes

Add these three scopes:

| Scope | Justification (paste into the "Why is this scope needed?" box) |
|---|---|
| `recording:read:admin` | otto needs to read cloud recording transcripts to extract code-shaped action items from meetings. otto only reads transcripts; it never downloads audio or video files. |
| `meeting:read:admin` | otto needs to read meeting metadata (title, host, time) so each draft pull request can attribute its source meeting to the correct context. |
| `user:read:admin` | otto enumerates account users to know whose recordings to poll. it does not modify, delete, or create users. |

Do NOT add any write scopes (`:write:*`) — otto is read-only on
Zoom's side.

---

## Surface (left sidebar)

### Where can users find your app?

Check **Web** only (we don't ship a Zoom Client SDK build, a chatbot,
or a meeting-room app). Uncheck Zoom Client / Marketplace App / etc.

### Local test users

Add at least your own Zoom email here. While the app is in
development mode (before publish review), only listed test users can
go through the OAuth flow.

```
dancleary54@gmail.com   (or whatever your Zoom-account email is)
```

---

## Submit

### Submission notes for the reviewer (use during publish submission)

```
otto is an engineering productivity tool for software teams. our app reads cloud-recording transcripts from connected zoom accounts on a 5-minute poll, extracts action items that look like requested code changes ("can we change x to y", "we should add a button for z"), and opens a draft pull request on the customer's github repository with the proposed change.

we never join meetings, never store audio or video, and never write data back to zoom. all transcript data is encrypted at rest in our convex database, retained per the customer's chosen retention plan, and deleted on team termination.

draft pull requests always require human review and merge. otto never auto-merges.

privacy policy: https://ottoagent.app/legal/privacy
terms of use: https://ottoagent.app/legal/terms

demo video: [record after creating the app — see notes below]
```

### Demo video (≤ 3 min, Loom or similar)

You'll need this for the publish submission, NOT for development
mode. Record after the app exists:

1. Open `https://ottoagent.app/app/` (admin).
2. Sign in.
3. Go to Onboarding tab → Step 03: connect zoom.
4. Click **Connect with Zoom**.
5. Show the Zoom consent screen.
6. Allow.
7. Show the "connected as <your email>" badge.
8. Wait ~5 min OR manually trigger a poll, then show a meeting in the
   Activity tab with `sourceType: zoom`.

---

## Pre-submit checklist (operator: tick before clicking Submit for Review)

- [ ] App created at marketplace.zoom.us
- [ ] Client ID + Secret stored in convex prod env (via me)
- [ ] support@ottoagent.app forwarding to dancleary54@gmail.com
- [ ] Privacy URL renders cleanly
- [ ] Terms URL renders cleanly
- [ ] App icon uploaded (1024×1024 PNG)
- [ ] Three scopes added with justifications
- [ ] Test users include your own Zoom email
- [ ] Tested OAuth flow end-to-end as a test user
- [ ] Demo video recorded and uploaded
