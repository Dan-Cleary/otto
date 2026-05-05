import { useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../convexApi";
import { OttoGlyphIcon, OttoSprite, IntegrationGlyph, type IntegrationName } from "../Otto";
import { useTeam, type TeamId } from "../teamContext";

type StepStatus = "ready" | "needed" | "checking";

export function OnboardingTab() {
  const convexUrl = (import.meta.env.VITE_CONVEX_URL as string | undefined) ?? "";
  const siteUrl = convexUrl.replace(".convex.cloud", ".convex.site");
  const { teamId } = useTeam();
  const items = useQuery(
    api.admin.recentItems,
    teamId ? { teamId, limit: 50 } : "skip",
  );
  const repos = useQuery(
    api.reposDb.list,
    teamId ? { teamId } : "skip",
  ) as { _id: string; enabled: boolean }[] | undefined;
  const zoomStatus = useQuery(
    api.zoomDb.status,
    teamId ? { teamId } : "skip",
  ) as
    | {
        configured: boolean;
        enabled: boolean;
        authType: "oauth" | "s2s" | null;
        accountId: string | null;
        accountEmail: string | null;
        accountName: string | null;
        last:
          | { ok: boolean; ingested: number; error: string | null; at: number }
          | null;
        itemsToday: number;
      }
    | undefined;
  const granolaStatus = useQuery(
    api.granolaDb.status,
    teamId ? { teamId } : "skip",
  ) as
    | {
        last: {
          ok: boolean;
          ingested: number;
          error: string | null;
          at: number;
        } | null;
        itemsToday: number;
        apiKeyConfigured: boolean;
      }
    | undefined;
  const cursorStatus = useQuery(
    api.cursorDb.status,
    teamId ? { teamId } : "skip",
  ) as
    | { configured: boolean; enabled: boolean; keyHint: string | null }
    | undefined;
  const githubStatus = useQuery(
    api.githubDb.status,
    teamId ? { teamId } : "skip",
  ) as
    | {
        configured: boolean;
        installationId: number | null;
        accountLogin: string | null;
        accountType: string | null;
        repoCount: number | null;
      }
    | undefined;

  const flags = useMemo(() => {
    if (!items) return null;
    return {
      widget: items.some((i) => i.sourceType === "widget"),
      granola: items.some((i) => i.sourceType === "granola"),
      slack: items.some(
        (i) =>
          i.status === "queued" ||
          i.status === "approved" ||
          i.status === "rejected",
      ),
    };
  }, [items]);

  const reposReady = !!(repos && repos.some((r) => r.enabled));
  const reposStepStatus: StepStatus = reposReady
    ? "ready"
    : repos === undefined
      ? "checking"
      : "needed";
  const granolaStepStatus: StepStatus =
    flags?.granola
      ? "ready"
      : granolaStatus === undefined
        ? "checking"
        : granolaStatus.apiKeyConfigured
          ? "ready"
          : "needed";
  const zoomStepStatus: StepStatus =
    zoomStatus === undefined
      ? "checking"
      : zoomStatus.configured
        ? "ready"
        : "needed";
  const cursorStepStatus: StepStatus =
    cursorStatus === undefined
      ? "checking"
      : cursorStatus.configured
        ? "ready"
        : "needed";
  const githubStepStatus: StepStatus =
    githubStatus === undefined
      ? "checking"
      : githubStatus.configured
        ? "ready"
        : "needed";
  const meetingSourceStepStatus: StepStatus =
    granolaStepStatus === "ready" || zoomStepStatus === "ready"
      ? "ready"
      : granolaStepStatus === "checking" || zoomStepStatus === "checking"
        ? "checking"
        : "needed";

  const widgetSecret = useQuery(
    api.teams.widgetSecret,
    teamId ? { teamId } : "skip",
  ) as string | null | undefined;
  const rotateWidgetSecret = useMutation(api.teams.rotateWidgetSecret);

  const widgetSnippet = `<script
  src="https://YOUR-STATIC-HOST/otto.js"
  data-endpoint="${siteUrl || "https://YOUR-CONVEX.convex.site"}/ingest/widget"
  data-secret="${widgetSecret ?? "<click 'create widget secret' below>"}"
  defer
></script>`;

  const slackInteractionsUrl = `${siteUrl || "https://YOUR-CONVEX.convex.site"}/slack/interactions`;

  return (
    <div className="onboarding">
      <header className="onboarding-hero">
        <OttoSprite
          size={72}
          state={
            allReady(
              cursorStepStatus,
              githubStepStatus,
              meetingSourceStepStatus,
              reposStepStatus,
            )
              ? "done"
              : "thinking"
          }
        />
        <div>
          <h1>wake otto up</h1>
          <p className="onboarding-lede">
            four required steps to ship a draft pr: a cursor key, the
            github app, one meeting source, and at least one registered
            repo. the rest is optional.
          </p>
        </div>
      </header>

      <ProgressStrip
        cursor={cursorStepStatus}
        github={githubStepStatus}
        meetingSource={meetingSourceStepStatus}
        repos={reposStepStatus}
      />

      <Step
        n={1}
        glyph="inbox"
        title="drop the widget"
        status={flags?.widget ? "ready" : "needed"}
        verify="otto sees a widget event"
      >
        <p>
          build the bundle with <code>npm run widget:build</code>, host{" "}
          <code>widget/dist/otto.js</code> on any static host, then paste this
          onto the page you want to collect feedback from.
        </p>
        <CodeBlock language="html" code={widgetSnippet} />
        <div className="row" style={{ gap: 8 }}>
          <button
            type="button"
            onClick={() =>
              teamId &&
              void rotateWidgetSecret({ teamId })
            }
          >
            {widgetSecret ? "rotate widget secret" : "create widget secret"}
          </button>
          {widgetSecret && (
            <span className="muted" style={{ fontSize: 11 }}>
              rotating invalidates pages still using the old secret
            </span>
          )}
        </div>
        <Hint>
          the secret above is per-team and lives in this deployment&rsquo;s
          database. paste the snippet on the page you want to collect
          feedback from — otto figures out which project (and therefore
          which repo) by matching the URL against your project patterns.
        </Hint>
      </Step>

      <Step
        n={2}
        glyph="notebook"
        title="connect granola"
        platform="granola"
        status={granolaStepStatus}
        verify={granolaVerifyLine(granolaStatus)}
      >
        <p>
          paste a granola personal api key. otto polls every 3 minutes
          and validates the key live before saving.
        </p>
        <GranolaKeyForm
          configured={!!granolaStatus?.apiKeyConfigured}
          teamId={teamId}
        />
        <Hint>
          generate the key from granola → settings → api keys (paid
          plans). otto keeps it in this deployment&rsquo;s database and
          uses it for the poll cron only. clear it any time below.
        </Hint>
      </Step>

      <Step
        n={3}
        glyph="ripple"
        title="connect zoom"
        platform="zoom"
        status={zoomStepStatus}
        verify={zoomVerifyLine(zoomStatus)}
      >
        <p>
          otto pulls cloud-recording transcripts from zoom on a 5-minute
          cron — never joins your meetings. one click to authorize; otto
          handles the credentials.
        </p>
        <ZoomConnect status={zoomStatus} teamId={teamId} />
      </Step>

      <Step
        n={4}
        glyph="task"
        title="register a repo"
        status={reposStepStatus}
        verify="at least one repo is enabled"
      >
        <p>
          add a repo in the <strong>repos</strong> tab: github full name +
          one-sentence description. otto embeds the description for routing.
        </p>
        <Hint>
          start with two or three repos otto knows well. expand only after
          you&rsquo;ve seen drafts that look right — bad routing is the
          fastest way to lose trust in the daemon.
        </Hint>
      </Step>

      <Step
        n={5}
        glyph="task"
        title="add cursor api key"
        platform="cursor"
        status={cursorStepStatus}
        verify={
          cursorStatus?.configured
            ? `key on file (${cursorStatus.keyHint ?? "•••"})`
            : "no cursor key on this team"
        }
      >
        <p>
          otto drafts diffs through cursor. paste a per-team cursor api key
          — otto only uses it when opening prs for items routed to your
          repos.
        </p>
        <CursorKeyForm
          configured={!!cursorStatus?.configured}
          keyHint={cursorStatus?.keyHint ?? null}
          teamId={teamId}
        />
        <Hint>
          generate the key from cursor → settings → api keys. you can clear it
          at any time below; otto immediately stops firing for this team if no
          key is set.
        </Hint>
      </Step>

      <Step
        n={6}
        glyph="task"
        title="install github app"
        platform="github"
        status={githubStepStatus}
        verify={
          githubStatus?.configured
            ? `installed on ${githubStatus.accountLogin ?? "github"}`
            : "no github app installation on this team"
        }
      >
        <p>
          install the github app on the account or org that owns your
          repos. you pick which repos during install.
        </p>
        <GithubInstall status={githubStatus} teamId={teamId} />
        <Hint>
          you can change which repos the app has access to any time from
          github → settings → applications → otto-agent-app. uninstalling
          there immediately revokes otto&rsquo;s ability to open prs.
        </Hint>
      </Step>

      <Step
        n={7}
        glyph="ripple"
        title="connect slack"
        platform="slack"
        status={flags?.slack ? "ready" : "needed"}
        verify="otto has queued at least one item"
      >
        <p>
          low-confidence items route to slack for human approval. set
          these env vars and point the slack app at otto&rsquo;s
          interactivity url.
        </p>
        <CodeBlock
          language="bash"
          code={[
            "npx convex env set SLACK_BOT_TOKEN xoxb-…",
            "npx convex env set SLACK_SIGNING_SECRET …",
            "npx convex env set SLACK_REVIEW_CHANNEL C0123456789",
          ].join("\n")}
        />
        <CodeBlock
          language="config"
          label="slack app · interactivity"
          code={slackInteractionsUrl}
        />
        <Hint>
          required bot scopes: <code>chat:write</code>,{" "}
          <code>channels:history</code>. tune the threshold under{" "}
          <strong>settings</strong> — items below that confidence land in the
          review channel rather than going straight to a draft.
        </Hint>
      </Step>

      <footer className="onboarding-footer">
        <span className="otto-eyebrow">verify <span className="sep">//</span> daemon log</span>
        <p className="muted" style={{ margin: 0 }}>
          once a step is live, the matching event shows up in the{" "}
          <strong>activity</strong> tab. if nothing appears, check{" "}
          <code>npx convex logs</code> for ingest errors.
        </p>
      </footer>
    </div>
  );
}

/* ─────────────────── pieces ─────────────────── */

function ProgressStrip(props: {
  cursor: StepStatus;
  github: StepStatus;
  meetingSource: StepStatus;
  repos: StepStatus;
}) {
  const cells = [
    { name: "cursor", status: props.cursor },
    { name: "github", status: props.github },
    { name: "meeting source", status: props.meetingSource },
    { name: "repos", status: props.repos },
  ];
  const ready = cells.filter((c) => c.status === "ready").length;
  return (
    <div className="progress-strip">
      <div className="progress-count">
        <span className="progress-num">{ready}</span>
        <span className="progress-of">/ {cells.length}</span>
        <span className="otto-eyebrow" style={{ marginLeft: 12 }}>
          steps live
        </span>
      </div>
      <div className="progress-cells">
        {cells.map((c) => (
          <div key={c.name} className={`progress-cell is-${c.status}`}>
            <span className="cell-name">{c.name}</span>
            <span className="cell-status">{statusLabel(c.status)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Step({
  n,
  glyph,
  platform,
  title,
  status,
  verify,
  children,
}: {
  n: number;
  glyph: "inbox" | "notebook" | "task" | "ripple";
  platform?: IntegrationName;
  title: string;
  status: StepStatus;
  verify: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`step is-${status}`}>
      <header className="step-head">
        <span className="step-num">{String(n).padStart(2, "0")}</span>
        {platform ? (
          <IntegrationGlyph name={platform} size={20} />
        ) : (
          <OttoGlyphIcon name={glyph} size={20} />
        )}
        <h3>{title}</h3>
        <span className={`step-pill is-${status}`}>{statusLabel(status)}</span>
      </header>
      <div className="step-body">{children}</div>
      <footer className="step-verify">
        <span className="otto-eyebrow">verify</span>
        <span>{verify}</span>
      </footer>
    </section>
  );
}

function CodeBlock({
  code,
  language,
  label,
}: {
  code: string;
  language?: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — silently ignore */
    }
  };
  return (
    <div className="codeblock">
      <div className="codeblock-bar">
        <span className="otto-eyebrow">
          {label ?? language ?? "snippet"}
        </span>
        <button
          type="button"
          className="copy-btn"
          onClick={onCopy}
          aria-label="copy to clipboard"
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre>{code}</pre>
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div className="hint">
      <OttoGlyphIcon name="pawprint" size={14} />
      <span>{children}</span>
    </div>
  );
}

function statusLabel(s: StepStatus): string {
  switch (s) {
    case "ready":
      return "ready";
    case "needed":
      return "needed";
    case "checking":
      return "checking…";
  }
}

function allReady(
  cursor: StepStatus,
  github: StepStatus,
  meetingSource: StepStatus,
  repos: StepStatus,
): boolean {
  return (
    cursor === "ready" &&
    github === "ready" &&
    meetingSource === "ready" &&
    repos === "ready"
  );
}

function zoomVerifyLine(
  status:
    | {
        configured: boolean;
        last:
          | { ok: boolean; ingested: number; error: string | null; at: number }
          | null;
        itemsToday: number;
      }
    | undefined,
): string {
  if (!status) return "checking…";
  if (!status.configured) return "no credentials configured";
  if (!status.last) return "credentials saved · waiting for first poll";
  const lp = status.last;
  if (!lp.ok)
    return `last poll ${relTime(lp.at)} · error: ${lp.error ?? "unknown"}`;
  return `last poll ${relTime(lp.at)} · ${lp.ingested} new recording${
    lp.ingested === 1 ? "" : "s"
  } · ${status.itemsToday} items today`;
}

function ZoomConnect({
  status,
  teamId,
}: {
  status:
    | {
        configured: boolean;
        authType: "oauth" | "s2s" | null;
        accountEmail: string | null;
        accountName: string | null;
        accountId: string | null;
      }
    | undefined;
  teamId: TeamId | null;
}) {
  const getOAuthUrl = useAction(api.zoom.getOAuthConnectUrl);
  const clear = useAction(api.zoom.clearCreds);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [busy, setBusy] = useState<"idle" | "connecting" | "clearing">(
    "idle",
  );
  const [err, setErr] = useState<string | null>(null);

  const onConnect = async () => {
    if (!teamId) return;
    setBusy("connecting");
    setErr(null);
    try {
      const res = await getOAuthUrl({
        teamId,
        returnTo: window.location.href,
      });
      if ("error" in res) {
        setErr(res.error);
      } else {
        // Open in a popup so we can detect connect-complete via
        // postMessage and refresh the status query.
        const popup = window.open(
          res.url,
          "otto-zoom-oauth",
          "width=560,height=720",
        );
        if (!popup) {
          // Pop-up blocked — fall back to a full-page redirect.
          window.location.href = res.url;
          return;
        }
        // The callback page sends "otto-zoom-connected" / "-error".
        const onMsg = (e: MessageEvent) => {
          if (e.data?.type === "otto-zoom-connected") {
            window.removeEventListener("message", onMsg);
            // Convex live-queries will re-fetch automatically.
          } else if (e.data?.type === "otto-zoom-error") {
            window.removeEventListener("message", onMsg);
            setErr("zoom denied or returned an error");
          }
        };
        window.addEventListener("message", onMsg);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("idle");
    }
  };

  const onDisconnect = async () => {
    if (!teamId) return;
    setBusy("clearing");
    setErr(null);
    try {
      await clear({ teamId });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("idle");
    }
  };

  const connected = !!status?.configured;
  const oauthLabel =
    status?.accountEmail ?? status?.accountName ?? "your zoom account";

  return (
    <div className="zoom-connect">
      {connected && (
        <p
          className="otto-eyebrow"
          style={{ color: "var(--otto-green)", marginBottom: 8 }}
        >
          connected ·{" "}
          {status?.authType === "oauth"
            ? `oauth as ${oauthLabel}`
            : `server-to-server · account ${status?.accountId ?? "—"}`}
        </p>
      )}

      <div className="row" style={{ gap: 8, marginTop: 4 }}>
        <button
          className="primary"
          disabled={busy !== "idle"}
          onClick={onConnect}
        >
          {busy === "connecting"
            ? "opening zoom…"
            : connected
              ? "reconnect"
              : "connect with zoom"}
        </button>
        {connected && (
          <button
            type="button"
            className="danger"
            disabled={busy !== "idle"}
            onClick={onDisconnect}
          >
            {busy === "clearing" ? "…" : "disconnect"}
          </button>
        )}
      </div>

      {err && (
        <p
          className="otto-eyebrow"
          style={{ color: "var(--otto-red)", marginTop: 8 }}
        >
          {err}
        </p>
      )}

      <details
        open={advancedOpen}
        onToggle={(e) =>
          setAdvancedOpen((e.target as HTMLDetailsElement).open)
        }
        style={{ marginTop: 18 }}
      >
        <summary
          className="otto-eyebrow"
          style={{ cursor: "pointer", color: "var(--otto-pencil)" }}
        >
          advanced · use your own server-to-server credentials
        </summary>
        <div style={{ marginTop: 10 }}>
          <ZoomS2SForm
            configured={connected && status?.authType === "s2s"}
            accountId={status?.accountId ?? null}
            teamId={teamId}
          />
        </div>
      </details>
    </div>
  );
}

// Server-to-Server form, kept for power users who want to register
// their own Zoom Marketplace app (org-wide, no per-user OAuth).
function ZoomS2SForm({
  configured,
  accountId,
  teamId,
}: {
  configured: boolean;
  accountId: string | null;
  teamId: TeamId | null;
}) {
  const save = useAction(api.zoom.saveCreds);
  const clear = useAction(api.zoom.clearCreds);
  const [draft, setDraft] = useState({
    accountId: "",
    clientId: "",
    clientSecret: "",
  });
  const [busy, setBusy] = useState<"idle" | "saving" | "clearing">("idle");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  const onSave = async () => {
    if (!teamId) return;
    if (
      !draft.accountId.trim() ||
      !draft.clientId.trim() ||
      !draft.clientSecret.trim()
    )
      return;
    setBusy("saving");
    setMsg(null);
    try {
      const res = await save({
        teamId,
        accountId: draft.accountId,
        clientId: draft.clientId,
        clientSecret: draft.clientSecret,
      });
      if (res.ok) {
        setMsg({
          kind: "ok",
          text: "credentials validated · first poll running…",
        });
        setDraft({ accountId: "", clientId: "", clientSecret: "" });
      } else {
        setMsg({ kind: "err", text: res.error ?? "save failed" });
      }
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy("idle");
    }
  };

  const onClear = async () => {
    if (!teamId) return;
    setBusy("clearing");
    setMsg(null);
    try {
      await clear({ teamId });
      setMsg({ kind: "ok", text: "credentials cleared" });
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy("idle");
    }
  };

  return (
    <div className="zoom-creds">
      {configured && accountId && (
        <p
          className="otto-eyebrow"
          style={{ color: "var(--otto-green)", marginBottom: 8 }}
        >
          configured · account {accountId}
        </p>
      )}
      <label className="otto-eyebrow">account id</label>
      <input
        value={draft.accountId}
        onChange={(e) =>
          setDraft({ ...draft, accountId: e.target.value })
        }
        placeholder={configured ? "•••••••• (replace existing)" : "abc123XYZ"}
        autoComplete="off"
        spellCheck={false}
        style={{ width: "100%", marginTop: 4 }}
      />
      <label className="otto-eyebrow" style={{ marginTop: 10, display: "block" }}>
        client id
      </label>
      <input
        value={draft.clientId}
        onChange={(e) => setDraft({ ...draft, clientId: e.target.value })}
        placeholder={configured ? "••••••••" : "Z00mApp_clientId"}
        autoComplete="off"
        spellCheck={false}
        style={{ width: "100%", marginTop: 4 }}
      />
      <label className="otto-eyebrow" style={{ marginTop: 10, display: "block" }}>
        client secret
      </label>
      <input
        type="password"
        value={draft.clientSecret}
        onChange={(e) =>
          setDraft({ ...draft, clientSecret: e.target.value })
        }
        placeholder={configured ? "••••••••" : ""}
        autoComplete="off"
        spellCheck={false}
        style={{ width: "100%", marginTop: 4 }}
      />
      <div className="row" style={{ gap: 8, marginTop: 14 }}>
        <button
          className="primary"
          disabled={
            !draft.accountId.trim() ||
            !draft.clientId.trim() ||
            !draft.clientSecret.trim() ||
            busy !== "idle"
          }
          onClick={onSave}
        >
          {busy === "saving"
            ? "validating…"
            : configured
              ? "replace"
              : "save + connect"}
        </button>
        {configured && (
          <button
            type="button"
            className="danger"
            disabled={busy !== "idle"}
            onClick={onClear}
          >
            {busy === "clearing" ? "…" : "disconnect"}
          </button>
        )}
      </div>
      {msg && (
        <p
          className="otto-eyebrow"
          style={{
            marginTop: 8,
            color: msg.kind === "ok" ? "var(--otto-green)" : "var(--otto-red)",
          }}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}

function granolaVerifyLine(
  status:
    | {
        last: { ok: boolean; ingested: number; error: string | null; at: number } | null;
        itemsToday: number;
        apiKeyConfigured: boolean;
      }
    | undefined,
): string {
  if (!status) return "checking…";
  if (!status.apiKeyConfigured) return "no api key configured";
  if (!status.last) return "key saved · waiting for first poll";
  const lp = status.last;
  if (!lp.ok) return `last poll ${relTime(lp.at)} · error: ${lp.error ?? "unknown"}`;
  return `last poll ${relTime(lp.at)} · ${lp.ingested} new note${
    lp.ingested === 1 ? "" : "s"
  } · ${status.itemsToday} items today`;
}

function GranolaKeyForm({
  configured,
  teamId,
}: {
  configured: boolean;
  teamId: TeamId | null;
}) {
  const save = useAction(api.granola.saveApiKey);
  const clear = useAction(api.granola.clearApiKey);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"idle" | "saving" | "clearing">("idle");
  const [msg, setMsg] = useState<
    { kind: "ok" | "err"; text: string } | null
  >(null);

  const onSave = async () => {
    if (!draft.trim() || !teamId) return;
    setBusy("saving");
    setMsg(null);
    try {
      const res = await save({ teamId, key: draft });
      if (res.ok) {
        setMsg({ kind: "ok", text: "key validated · first poll running…" });
        setDraft("");
      } else {
        setMsg({ kind: "err", text: res.error ?? "save failed" });
      }
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy("idle");
    }
  };

  const onClear = async () => {
    if (!teamId) return;
    setBusy("clearing");
    setMsg(null);
    try {
      await clear({ teamId });
      setMsg({ kind: "ok", text: "key cleared" });
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy("idle");
    }
  };

  return (
    <div className="granola-key">
      <label htmlFor="granola-key-input" className="otto-eyebrow">
        granola api key
      </label>
      <div className="row" style={{ gap: 8, marginTop: 6 }}>
        <input
          id="granola-key-input"
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={configured ? "•••••••• (replace existing key)" : "grn_…"}
          autoComplete="off"
          spellCheck={false}
          style={{ flex: 1, fontFamily: "var(--otto-font-mono)" }}
        />
        <button
          type="button"
          className="primary"
          disabled={!draft.trim() || busy !== "idle"}
          onClick={onSave}
        >
          {busy === "saving" ? "validating…" : configured ? "replace" : "save"}
        </button>
        {configured && (
          <button
            type="button"
            className="danger"
            disabled={busy !== "idle"}
            onClick={onClear}
          >
            {busy === "clearing" ? "…" : "clear"}
          </button>
        )}
      </div>
      {msg && (
        <p
          className="otto-eyebrow"
          style={{
            marginTop: 8,
            color:
              msg.kind === "ok"
                ? "var(--otto-green)"
                : "var(--otto-red)",
          }}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}

function CursorKeyForm({
  configured,
  keyHint,
  teamId,
}: {
  configured: boolean;
  keyHint: string | null;
  teamId: TeamId | null;
}) {
  const save = useMutation(api.cursorDb.saveKey);
  const clear = useMutation(api.cursorDb.clearKey);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"idle" | "saving" | "clearing">("idle");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  const onSave = async () => {
    if (!draft.trim() || !teamId) return;
    setBusy("saving");
    setMsg(null);
    try {
      await save({ teamId, apiKey: draft });
      setMsg({ kind: "ok", text: "key saved" });
      setDraft("");
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy("idle");
    }
  };

  const onClear = async () => {
    if (!teamId) return;
    setBusy("clearing");
    setMsg(null);
    try {
      await clear({ teamId });
      setMsg({ kind: "ok", text: "key cleared" });
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy("idle");
    }
  };

  return (
    <div className="cursor-key">
      <label htmlFor="cursor-key-input" className="otto-eyebrow">
        cursor api key
      </label>
      <div className="row" style={{ gap: 8, marginTop: 6 }}>
        <input
          id="cursor-key-input"
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            configured ? `${keyHint ?? "••••••"} (replace existing)` : "cu_…"
          }
          autoComplete="off"
          spellCheck={false}
          style={{ flex: 1, fontFamily: "var(--otto-font-mono)" }}
        />
        <button
          type="button"
          className="primary"
          disabled={!draft.trim() || busy !== "idle"}
          onClick={onSave}
        >
          {busy === "saving" ? "saving…" : configured ? "replace" : "save"}
        </button>
        {configured && (
          <button
            type="button"
            className="danger"
            disabled={busy !== "idle"}
            onClick={onClear}
          >
            {busy === "clearing" ? "…" : "clear"}
          </button>
        )}
      </div>
      {msg && (
        <p
          className="otto-eyebrow"
          style={{
            marginTop: 8,
            color:
              msg.kind === "ok" ? "var(--otto-green)" : "var(--otto-red)",
          }}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}

function GithubInstall({
  status,
  teamId,
}: {
  status:
    | {
        configured: boolean;
        installationId: number | null;
        accountLogin: string | null;
        accountType: string | null;
        repoCount: number | null;
      }
    | undefined;
  teamId: TeamId | null;
}) {
  const getInstallUrl = useAction(api.github.getInstallUrl);
  const completeInstall = useAction(api.github.completeInstall);
  const uninstall = useAction(api.github.uninstall);
  const [busy, setBusy] = useState<"idle" | "starting" | "completing" | "removing">(
    "idle",
  );
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  // After GitHub redirects back with ?installation_id&state, finish
  // the install on the server. Runs once per page load.
  useMemo(() => {
    if (typeof window === "undefined") return;
    if (!teamId) return;
    const sp = new URLSearchParams(window.location.search);
    const idStr = sp.get("installation_id");
    const state = sp.get("state");
    if (!idStr || !state) return;
    const installationId = Number(idStr);
    if (!Number.isFinite(installationId)) return;

    setBusy("completing");
    setMsg(null);
    completeInstall({ state, installationId })
      .then((res) => {
        if (res.ok) {
          setMsg({ kind: "ok", text: "github app installed" });
        } else {
          setMsg({
            kind: "err",
            text: res.error ?? "couldn't complete install",
          });
        }
      })
      .catch((e) => setMsg({ kind: "err", text: (e as Error).message }))
      .finally(() => {
        setBusy("idle");
        // Strip the install params from the URL so a refresh doesn't
        // re-run.
        const url = new URL(window.location.href);
        url.searchParams.delete("installation_id");
        url.searchParams.delete("state");
        url.searchParams.delete("setup_action");
        url.searchParams.delete("gh");
        window.history.replaceState(null, "", url);
      });
  }, [teamId, completeInstall]);

  const onInstall = async () => {
    if (!teamId) return;
    setBusy("starting");
    setMsg(null);
    try {
      const res = await getInstallUrl({ teamId });
      if ("url" in res) {
        window.location.href = res.url;
      } else {
        setMsg({ kind: "err", text: res.error });
        setBusy("idle");
      }
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
      setBusy("idle");
    }
  };

  const onUninstall = async () => {
    if (!teamId) return;
    setBusy("removing");
    setMsg(null);
    try {
      await uninstall({ teamId });
      setMsg({
        kind: "ok",
        text: "removed from this team. also remove on github to revoke fully.",
      });
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy("idle");
    }
  };

  return (
    <div className="github-install">
      {status?.configured ? (
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <span className="otto-eyebrow">
            installed on{" "}
            <strong>{status.accountLogin ?? "github"}</strong>
            {status.accountType ? ` (${status.accountType.toLowerCase()})` : ""}
          </span>
          <button
            type="button"
            onClick={onInstall}
            disabled={busy !== "idle"}
          >
            {busy === "starting" ? "…" : "manage repos"}
          </button>
          <button
            type="button"
            className="danger"
            disabled={busy !== "idle"}
            onClick={onUninstall}
          >
            {busy === "removing" ? "…" : "remove"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="primary"
          onClick={onInstall}
          disabled={!teamId || busy !== "idle"}
        >
          {busy === "starting"
            ? "redirecting to github…"
            : busy === "completing"
              ? "finishing install…"
              : "install github app"}
        </button>
      )}
      {msg && (
        <p
          className="otto-eyebrow"
          style={{
            marginTop: 8,
            color:
              msg.kind === "ok" ? "var(--otto-green)" : "var(--otto-red)",
          }}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}

function relTime(at: number): string {
  const d = (Date.now() - at) / 1000;
  if (d < 60) return `${Math.round(d)}s ago`;
  if (d < 3600) return `${Math.round(d / 60)}m ago`;
  if (d < 86400) return `${Math.round(d / 3600)}h ago`;
  return new Date(at).toLocaleDateString();
}
