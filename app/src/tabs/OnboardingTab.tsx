import { useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../convexApi";
import { OttoGlyphIcon, OttoSprite, IntegrationGlyph, type IntegrationName } from "../Otto";
import { useTeam, type TeamId } from "../teamContext";

type StepStatus = "ready" | "needed" | "checking";

export function OnboardingTab() {
  const { teamId } = useTeam();
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

  return (
    <div className="onboarding">
      <header className="onboarding-hero">
        <OttoSprite
          size={72}
          state={
            allReady(cursorStepStatus, githubStepStatus)
              ? "done"
              : "thinking"
          }
        />
        <div>
          <h1>wake otto up</h1>
          <p className="onboarding-lede">
            two required steps to ship a draft pr: add a cursor key,
            install the github app. then create a project to grab the
            widget snippet.
          </p>
        </div>
      </header>

      <ProgressStrip
        cursor={cursorStepStatus}
        github={githubStepStatus}
      />

      <Step
        n={1}
        glyph="task"
        title="add cursor api key"
        platform="cursor"
        status={cursorStepStatus}
        verify={
          cursorStatus?.configured
            ? `key on file (${cursorStatus.keyHint ?? "•••"})`
            : "no cursor key on this team"
        }
        required="required"
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
        n={2}
        glyph="task"
        title="install github app"
        platform="github"
        status={githubStepStatus}
        verify={
          githubStatus?.configured
            ? `installed on ${githubStatus.accountLogin ?? "github"}`
            : "no github app installation on this team"
        }
        required="required"
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

      <footer className="onboarding-footer">
        <span className="otto-eyebrow">
          next <span className="sep">//</span> install the widget
        </span>
        <p className="muted" style={{ margin: 0 }}>
          once these three are live, head to{" "}
          <strong>projects</strong>, create a project, and grab the
          per-project widget snippet to drop on your app.
        </p>
      </footer>
    </div>
  );
}

/* ─────────────────── pieces ─────────────────── */

function ProgressStrip(props: {
  cursor: StepStatus;
  github: StepStatus;
}) {
  const cells = [
    { name: "cursor", status: props.cursor },
    { name: "github", status: props.github },
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
  required,
  children,
}: {
  n: number;
  glyph: "inbox" | "notebook" | "task" | "ripple";
  platform?: IntegrationName;
  title: string;
  status: StepStatus;
  verify: string;
  required?: "required" | "optional";
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
        {required && (
          <span
            className="otto-eyebrow"
            style={{
              fontSize: 10,
              padding: "2px 6px",
              border: "1px solid var(--otto-ink, #1c1a16)",
              background:
                required === "optional"
                  ? "transparent"
                  : "var(--otto-amber-soft, #f0d9a8)",
              color: "var(--otto-ink, #1c1a16)",
            }}
          >
            {required === "required" ? "required" : "optional"}
          </span>
        )}
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

function allReady(cursor: StepStatus, github: StepStatus): boolean {
  return cursor === "ready" && github === "ready";
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

