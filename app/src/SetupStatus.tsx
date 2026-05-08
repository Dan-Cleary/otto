import { useQuery } from "convex/react";
import { api } from "./convexApi";
import type { TeamId } from "./teamContext";

export type RequiredStepKey = "cursor" | "github";

export type SetupSnapshot = {
  loading: boolean;
  // Each key is true once that prerequisite is satisfied.
  cursor: boolean;
  github: boolean;
  done: number; // 0..2
  total: number; // always 2 today
  ready: boolean; // done === total
};

// Reads the current team's cursor + github integration status and
// reduces it to the two required onboarding gates. Per-project widget
// snippets are configured on the project page itself, not here.
export function useSetupStatus(teamId: TeamId | null): SetupSnapshot {
  const cursor = useQuery(
    api.cursorDb.status,
    teamId ? { teamId } : "skip",
  ) as { configured: boolean } | undefined;
  const github = useQuery(
    api.githubDb.status,
    teamId ? { teamId } : "skip",
  ) as { configured: boolean } | undefined;

  const loading =
    !teamId || cursor === undefined || github === undefined;

  const cursorOk = !!cursor?.configured;
  const githubOk = !!github?.configured;

  const done = Number(cursorOk) + Number(githubOk);

  return {
    loading,
    cursor: cursorOk,
    github: githubOk,
    done,
    total: 2,
    ready: done === 2,
  };
}

export function SetupBanner({
  status,
  onResume,
}: {
  status: SetupSnapshot;
  onResume: () => void;
}) {
  if (status.loading || status.ready) return null;
  const remaining = status.total - status.done;
  const missing: string[] = [];
  if (!status.cursor) missing.push("cursor key");
  if (!status.github) missing.push("github app");

  return (
    <div
      role="status"
      style={{
        background: "var(--otto-amber-soft, #f0d9a8)",
        border: "1px solid var(--otto-ink, #1c1a16)",
        borderLeft: "6px solid var(--otto-amber, #c89045)",
        color: "var(--otto-ink, #1c1a16)",
        padding: "10px 14px",
        margin: "12px 0",
        display: "flex",
        gap: 14,
        alignItems: "center",
        fontFamily: "var(--otto-font-mono)",
        fontSize: 13,
      }}
    >
      <span style={{ fontWeight: 600 }}>
        otto isn&rsquo;t connected yet
      </span>
      <span style={{ color: "var(--otto-pencil, #6b6356)" }}>
        {status.done} of {status.total} required steps complete
        {remaining > 0 ? ` · still need: ${missing.join(", ")}` : ""}
      </span>
      <button
        type="button"
        onClick={onResume}
        style={{ marginLeft: "auto" }}
      >
        resume setup →
      </button>
    </div>
  );
}
