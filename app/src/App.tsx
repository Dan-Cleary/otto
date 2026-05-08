import { useEffect, useState } from "react";
import { ProjectsTab } from "./tabs/ProjectsTab";
import { SettingsTab } from "./tabs/SettingsTab";
import { OttoWordmark } from "./Otto";
import { TeamProvider, useTeam, type TeamId } from "./teamContext";

const TABS = [
  { id: "projects", label: "Projects", Comp: ProjectsTab },
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

  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>(() => {
    if (typeof window === "undefined") return "projects";
    const saved = window.localStorage.getItem("otto.lastTab");
    return saved && isTabId(saved) ? saved : "projects";
  });
  const Comp = TABS.find((t) => t.id === tab)!.Comp;

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("otto.lastTab", tab);
    }
  }, [tab]);

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
      </header>
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
