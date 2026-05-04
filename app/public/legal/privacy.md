# Privacy policy

Last updated: May 3, 2026.

This policy describes what data Otto collects, how we use it, and the rights you have over your data.

## Owner and data controller

Tethered Software Inc.
305 Chapel Hill Road, Atlantic Highlands, NJ 07716, United States

Owner contact email: [dan@prompthub.us](mailto:dan@prompthub.us)
Product support: [support@ottoagent.app](mailto:support@ottoagent.app)

## What Otto does

Otto is an agent that turns meeting notes, transcripts, and dashboard feedback into draft pull requests. Two data flows are relevant for privacy:

1. **Source content your team gives Otto.** Granola meeting notes, Zoom recording transcripts, and feedback your end users submit through the embedded widget. Otto reads this content, extracts code-shaped action items, and uses them to draft PRs.
2. **Account and admin data.** When you sign in to ottoagent.app to manage Otto, we store the minimum data needed to identify you, scope you to your team, and run your integrations.

## Source content Otto stores

### Meeting transcripts and notes (Granola, Zoom)

When you connect Granola or Zoom, Otto pulls finished meeting notes / cloud-recording transcripts on a recurring schedule. We store:

- The transcript text
- Meeting title, host, start time, duration
- The platform's identifier for the meeting (so we don't double-ingest)
- The action items Otto extracts from the transcript

We do not capture audio or video. We do not join meetings or attend in real time.

### Widget feedback (browser script tag)

When the Otto widget is embedded on one of your team's pages and a user submits feedback, we store:

- The page URL the feedback came from
- The text the user typed
- The last 20 console errors observed by the page
- Browser viewport size and user agent string
- Submission timestamp

### Routing memory

When a teammate corrects Otto's repo routing in the Slack review queue, we store the corrected description and the embedding we computed for it, so Otto can route similar requests to the correct repo in the future.

### Retention

Source content is retained for the duration specified by your plan: 90 days on Free, 1 year on Solo, 5 years on Pro. After retention expires, source content is removed from application-controlled storage on a daily sweep. Account deletion removes all associated source content from application-controlled storage within 24 hours.

Encrypted backups and infrastructure logs (held by our hosting provider) may retain copies for up to 30 days after deletion before they cycle out of backup retention. We never read these backups except to restore the service after an incident.

## Account and admin data

When you sign in to ottoagent.app, we store:

- The email and password hash of the account (handled by Convex Auth)
- Your team membership(s) and role
- Per-team integration credentials (Granola API keys, Zoom OAuth tokens, Slack tokens, widget shared secrets)
- Per-team settings (confidence threshold, project URL patterns)
- Audit log of admin actions (who connected an integration, who approved an item, etc.)
- Session cookies for your Otto login

We never receive payment card numbers; billing is handled by Stripe.

## What we don't do

- We do not auto-merge any pull request Otto drafts. Every output is a draft for human review.
- We do not feed your transcripts or feedback into model training.
- We do not sell or rent any of the data described above.
- We do not call the Granola, Zoom, or Slack APIs beyond what you have authorized.
- End-user IP addresses from widget submissions are not stored in application-controlled storage; they may briefly appear in our hosting provider's request logs and are cycled out per that provider's standard log retention.

## Sub-processors

- **Convex.** Backend hosting (database, functions, file storage, auth). Governed by [Convex's privacy policy](https://www.convex.dev/legal/privacy).
- **OpenAI.** Used to extract action items from feedback / transcripts and to embed text for routing. Governed by [OpenAI's privacy policy](https://openai.com/policies/privacy-policy/). Otto sends only the relevant feedback text + (where applicable) transcript excerpts. Data handling follows OpenAI's API data usage policy: API content is not used to train OpenAI's models, and is retained per OpenAI's standard API retention period.
- **Cursor.** Used to draft pull requests via Cursor cloud agents. Governed by [Cursor's privacy policy](https://cursor.com/privacy).
- **Granola.** Used (only if you connect it) to pull meeting notes you have already created. Governed by [Granola's privacy policy](https://granola.ai/privacy).
- **Zoom.** Used (only if you connect it) to pull cloud-recording transcripts. Governed by [Zoom's privacy policy](https://zoom.us/privacy).
- **Slack.** Used (only if you connect it) to deliver review-queue messages and accept approvals. Governed by [Slack's privacy policy](https://slack.com/trust/privacy).
- **GitHub.** Used to open draft pull requests on the repos you register. Governed by [GitHub's privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).
- **Stripe.** Payment processing for paid plans. Governed by [Stripe's privacy policy](https://stripe.com/privacy).
- **Resend.** Transactional email (invites, notifications). Governed by [Resend's privacy policy](https://resend.com/legal/privacy-policy).
- **Vercel.** Hosting for the marketing site and admin app. Governed by [Vercel's privacy policy](https://vercel.com/legal/privacy-policy).

## Your rights

- **Access and export.** Export your team's data as JSON from the admin app at any time.
- **Delete.** Delete your team at any time, which removes all associated source content, integrations, and audit logs.
- **Account deletion.** Request deletion of your account and all associated data by emailing [support@ottoagent.app](mailto:support@ottoagent.app).

For GDPR, CCPA, or other statutory data rights, email us and we will honor requests within the statutory window.

## Cookies on ottoagent.app

The marketing pages and admin app set only the cookies required for authentication session management. We do not run third-party analytics on the public pages of this site.

## Changes

If we update this policy, we will update the "Last updated" date at the top. For material changes, we will notify active account holders by email.

## Contact

Privacy and data-controller questions: [dan@prompthub.us](mailto:dan@prompthub.us). General product support: [support@ottoagent.app](mailto:support@ottoagent.app).
