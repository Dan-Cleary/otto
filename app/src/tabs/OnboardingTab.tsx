import { useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../convexApi";
import { IntegrationGlyph, type IntegrationName } from "../Otto";
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
      <Step
        title="cursor api key"
        platform="cursor"
        status={cursorStepStatus}
        verify={
          cursorStatus?.configured
            ? `key on file (${cursorStatus.keyHint ?? "•••"})`
            : "not connected"
        }
      >
        <CursorKeyForm
          configured={!!cursorStatus?.configured}
          keyHint={cursorStatus?.keyHint ?? null}
          teamId={teamId}
        />
      </Step>

      <Step
        title="github app"
        platform="github"
        status={githubStepStatus}
        verify={
          githubStatus?.configured
            ? `installed on ${githubStatus.accountLogin ?? "github"}`
            : "not installed"
        }
      >
        <GithubInstall status={githubStatus} teamId={teamId} />
      </Step>
    </div>
  );
}

/* ─────────────────── pieces ─────────────────── */

function Step({
  platform,
  title,
  status,
  verify,
  children,
}: {
  platform?: IntegrationName;
  title: string;
  status: StepStatus;
  verify: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`step is-${status}`}>
      <header className="step-head">
        {platform && <IntegrationGlyph name={platform} size={20} />}
        <h3>{title}</h3>
        <span className={`step-pill is-${status}`}>{statusLabel(status)}</span>
      </header>
      <div className="step-body">{children}</div>
      <footer className="step-verify">
        <span>{verify}</span>
      </footer>
    </section>
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

