import { useEffect, useState } from "react";
import { ProjectsTab } from "./tabs/ProjectsTab";
import { ReposTab } from "./tabs/ReposTab";
import { SettingsTab } from "./tabs/SettingsTab";
import { OttoWordmark } from "./Otto";
import { SignOutButton } from "./auth";
import { TeamProvider, useTeam, type TeamId } from "./teamContext";
import { useSetupStatus, SetupBanner } from "./SetupStatus";

const TABS = [
  { id: "projects", label: "Projects", Comp: ProjectsTab },
  { id: "repos", label: "Repos", Comp: ReposTab },
  { id: "settings", label: "Settings", Comp: SettingsTab },
] as const;

function isTabId(value: string): value is (typeof TABS)[number]["id"] {
  return TABS.some((tab) => tab.id === value);
}

export function App() {
  return (
    <TeamProvider>
      <Inner />
    </TeamProvider>
  );
}

function Inner() {
  const { teamId, teams, switchTeam, bootstrapping } = useTeam();
  const setup = useSetupStatus(teamId);

  // First-signin default: a fresh user with no required setup done
  // lands on settings (wizard). The choice is sticky once they navigate
  // (recorded in localStorage), so we don't keep forcing settings on
  // every page load.
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>(() => {
    if (typeof window === "undefined") return "projects";
    const saved = window.localStorage.getItem("otto.lastTab");
    return saved && isTabId(saved) ? saved : "projects";
  });
  const Comp = TABS.find((t) => t.id === tab)!.Comp;

  // Once setup status loads, if the user is fresh (nothing done) and
  // has not picked a tab yet this session, route them to settings.
  useEffect(() => {
    if (setup.loading) return;
    const saved =
      typeof window !== "undefined"
        ? window.localStorage.getItem("otto.lastTab")
        : null;
    if (!saved && tab === "projects" && setup.done === 0) setTab("settings");
  }, [setup.loading, setup.done, tab]);

  // Persist the selected tab so refreshes don't bounce people back
  // to onboarding once they've started exploring.
  useEffect(() => {
    if (setup.loading) return;
    if (typeof window !== "undefined") {
      window.localStorage.setItem("otto.lastTab", tab);
    }
  }, [tab, setup.loading]);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="row" style={{ gap: 14 }}>
          <OttoWordmark size={22} />
          <TeamSwitcher
            teams={teams}
            teamId={teamId}
            onSwitch={switchTeam}
          />
        </div>
        <SignOutButton />
      </header>
      <SetupBanner status={setup} onResume={() => setTab("settings")} />
      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "active" : ""}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {!teamId ? (
        <p className="muted" style={{ marginTop: 24 }}>
          {bootstrapping || teams === undefined
            ? "setting up your team…"
            : "no team — refresh in a second."}
        </p>
      ) : (
        <Comp />
      )}
    </div>
  );
}

function TeamSwitcher({
  teams,
  teamId,
  onSwitch,
}: {
  teams: Array<{ _id: TeamId; name: string; role: string }> | undefined;
  teamId: TeamId | null;
  onSwitch: (id: TeamId) => void;
}) {
  if (!teams || teams.length === 0 || !teamId) return null;
  if (teams.length === 1) {
    return (
      <span
        className="otto-eyebrow"
        style={{ color: "var(--otto-pencil)" }}
      >
        {teams[0].name}
      </span>
    );
  }
  return (
    <select
      value={teamId}
      onChange={(e) => onSwitch(e.target.value as TeamId)}
      style={{
        fontFamily: "var(--otto-font-mono)",
        fontSize: 12,
        padding: "4px 8px",
      }}
      aria-label="active team"
    >
      {teams.map((t) => (
        <option key={t._id} value={t._id}>
          {t.name}
          {t.role === "admin" ? " · admin" : ""}
        </option>
      ))}
    </select>
  );
}
