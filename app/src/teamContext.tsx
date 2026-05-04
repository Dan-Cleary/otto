import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "./convexApi";
import type { Id } from "../../convex/_generated/dataModel";

export type TeamId = Id<"teams">;

type Team = {
  _id: TeamId;
  name: string;
  slug: string;
  role: "admin" | "member";
};

type TeamCtx = {
  teamId: TeamId | null;
  teams: Team[] | undefined;
  switchTeam: (id: TeamId) => void;
  bootstrapping: boolean;
};

const Ctx = createContext<TeamCtx>({
  teamId: null,
  teams: undefined,
  switchTeam: () => {},
  bootstrapping: false,
});

const STORAGE_KEY = "otto.activeTeamId";

export function TeamProvider({ children }: { children: ReactNode }) {
  const teams = useQuery(api.teams.myTeams) as Team[] | undefined;
  const bootstrap = useMutation(api.teams.bootstrap);
  const acceptInvites = useMutation(api.teams.acceptPendingInvites);

  const [storedTeamId, setStoredTeamId] = useState<TeamId | null>(() =>
    typeof window === "undefined"
      ? null
      : (window.localStorage.getItem(STORAGE_KEY) as TeamId | null),
  );
  const [bootstrapping, setBootstrapping] = useState(false);

  // First-load: ensure the user has a team. New signups land here
  // with `teams === []` — we bootstrap a personal team (or claim the
  // legacy data set if they're the first user) and auto-accept any
  // outstanding invites against their email.
  useEffect(() => {
    if (!teams) return;
    if (teams.length === 0 && !bootstrapping) {
      setBootstrapping(true);
      void (async () => {
        try {
          await bootstrap({});
          await acceptInvites({});
        } finally {
          setBootstrapping(false);
        }
      })();
    }
  }, [teams, bootstrap, acceptInvites, bootstrapping]);

  // Pick the active team. Prefer stored choice if it's still valid,
  // otherwise default to the first team.
  const validStored =
    storedTeamId && teams?.some((t) => t._id === storedTeamId)
      ? storedTeamId
      : null;
  const teamId = validStored ?? teams?.[0]?._id ?? null;

  // Persist any non-null active team id.
  useEffect(() => {
    if (teamId) {
      window.localStorage.setItem(STORAGE_KEY, teamId);
    }
  }, [teamId]);

  const switchTeam = (id: TeamId) => {
    setStoredTeamId(id);
    window.localStorage.setItem(STORAGE_KEY, id);
  };

  return (
    <Ctx.Provider value={{ teamId, teams, switchTeam, bootstrapping }}>
      {children}
    </Ctx.Provider>
  );
}

export function useTeam(): TeamCtx {
  return useContext(Ctx);
}
