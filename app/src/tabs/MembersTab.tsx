import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convexApi";
import { useTeam } from "../teamContext";
import type { Doc } from "../../../convex/_generated/dataModel";

type Member = Doc<"teamMembers">;
type Invite = Doc<"teamInvites">;
type Role = Member["role"];

export function MembersTab() {
  const { teamId, teams } = useTeam();
  const myTeam = teams?.find((t) => t._id === teamId);
  const isAdmin = myTeam?.role === "admin";

  const members = useQuery(
    api.teams.members,
    teamId ? { teamId } : "skip",
  ) as Member[] | undefined;
  const invites = useQuery(
    api.teams.listInvites,
    teamId && isAdmin ? { teamId } : "skip",
  ) as Invite[] | undefined;

  const invite = useMutation(api.teams.invite);
  const revoke = useMutation(api.teams.revokeInvite);
  const setRole = useMutation(api.teams.setRole);
  const removeMember = useMutation(api.teams.removeMember);
  const create = useMutation(api.teams.create);
  const rename = useMutation(api.teams.rename);

  const [draftEmail, setDraftEmail] = useState("");
  const [draftRole, setDraftRole] = useState<"admin" | "member">("member");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [renameDraft, setRenameDraft] = useState("");
  const [newTeamName, setNewTeamName] = useState("");

  const onInvite = async () => {
    if (!teamId || !draftEmail.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await invite({
        teamId,
        email: draftEmail.trim(),
        role: draftRole,
      });
      setDraftEmail("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!teamId) return null;

  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>team</h2>
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <input
            placeholder={myTeam?.name ?? "team name"}
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            style={{ flex: 1 }}
          />
          <button
            disabled={!isAdmin || !renameDraft.trim()}
            onClick={async () => {
              await rename({
                teamId,
                name: renameDraft.trim(),
              });
              setRenameDraft("");
            }}
          >
            rename
          </button>
        </div>
        <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
          create another team for a different group of repos / projects
        </p>
        <div className="row" style={{ gap: 8, marginTop: 4 }}>
          <input
            placeholder="new team name"
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            style={{ flex: 1 }}
          />
          <button
            className="primary"
            disabled={!newTeamName.trim()}
            onClick={async () => {
              await create({ name: newTeamName.trim() });
              setNewTeamName("");
            }}
          >
            create team
          </button>
        </div>
      </div>

      {isAdmin && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>invite a teammate</h2>
          <div
            className="row"
            style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}
          >
            <input
              placeholder="email@team.com"
              value={draftEmail}
              onChange={(e) => setDraftEmail(e.target.value)}
              style={{ flex: 1, minWidth: 220 }}
              type="email"
            />
            <select
              value={draftRole}
              onChange={(e) =>
                setDraftRole(e.target.value as "admin" | "member")
              }
            >
              <option value="member">member</option>
              <option value="admin">admin</option>
            </select>
            <button
              className="primary"
              disabled={!draftEmail.trim() || busy}
              onClick={onInvite}
            >
              {busy ? "…" : "send invite"}
            </button>
          </div>
          {err && (
            <p
              className="otto-eyebrow"
              style={{ color: "var(--otto-red)", marginTop: 8 }}
            >
              {err}
            </p>
          )}
          <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
            if the invitee already has an account, they auto-join on next
            sign-in. otherwise the invite waits for them to sign up with
            this email.
          </p>
        </div>
      )}

      <h2>members</h2>
      {!members ? (
        <p className="muted">loading…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>email</th>
              <th>role</th>
              <th>joined</th>
              {isAdmin && <th />}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m._id}>
                <td>{m.email}</td>
                <td>
                  {isAdmin ? (
                    <select
                      value={m.role}
                      onChange={(e) =>
                        void setRole({
                          teamId,
                          memberId: m._id,
                          role: e.target.value as Role,
                        })
                      }
                    >
                      <option value="member">member</option>
                      <option value="admin">admin</option>
                    </select>
                  ) : (
                    m.role
                  )}
                </td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {new Date(m.joinedAt).toLocaleDateString()}
                </td>
                {isAdmin && (
                  <td>
                    <button
                      className="danger"
                      onClick={() => {
                        if (confirm(`remove ${m.email}?`)) {
                          void removeMember({
                            teamId,
                            memberId: m._id,
                          });
                        }
                      }}
                    >
                      remove
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {isAdmin && invites && invites.length > 0 && (
        <>
          <h2>pending invites</h2>
          <table>
            <thead>
              <tr>
                <th>email</th>
                <th>role</th>
                <th>invited</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {invites.map((inv) => (
                <tr key={inv._id}>
                  <td>{inv.email}</td>
                  <td>{inv.role}</td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {new Date(inv.invitedAt).toLocaleDateString()}
                  </td>
                  <td>
                    <button
                      className="danger"
                      onClick={() =>
                        void revoke({
                          teamId,
                          inviteId: inv._id,
                        })
                      }
                    >
                      revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
