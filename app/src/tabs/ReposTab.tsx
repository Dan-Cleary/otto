import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convexApi";
import { useTeam } from "../teamContext";

export function ReposTab() {
  const { teamId } = useTeam();
  const repos = useQuery(
    api.reposDb.list,
    teamId ? { teamId } : "skip",
  );
  const upsert = useMutation(api.reposDb.upsert);
  const reindex = useMutation(api.reposDb.reindex);
  const remove = useMutation(api.reposDb.remove);

  const [draft, setDraft] = useState({
    name: "",
    githubFullName: "",
    githubUrl: "",
    description: "",
    enabled: true,
  });

  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>add repo</h2>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <input
            placeholder="display name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <input
            placeholder="owner/name"
            value={draft.githubFullName}
            onChange={(e) =>
              setDraft({
                ...draft,
                githubFullName: e.target.value,
                githubUrl: e.target.value
                  ? `https://github.com/${e.target.value}`
                  : "",
              })
            }
          />
          <input
            placeholder="description"
            value={draft.description}
            style={{ flex: 1, minWidth: 200 }}
            onChange={(e) =>
              setDraft({ ...draft, description: e.target.value })
            }
          />
          <button
            className="primary"
            disabled={!draft.name || !draft.githubFullName}
            onClick={async () => {
              if (!teamId) return;
              await upsert({ teamId, ...draft });
              setDraft({
                name: "",
                githubFullName: "",
                githubUrl: "",
                description: "",
                enabled: true,
              });
            }}
          >
            add + index
          </button>
        </div>
      </div>

      {!repos ? (
        <p className="muted">loading…</p>
      ) : repos.length === 0 ? (
        <div className="empty">no repos. add one above to enable routing.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>name</th>
              <th>github</th>
              <th>indexed</th>
              <th>enabled</th>
              <th>actions</th>
            </tr>
          </thead>
          <tbody>
            {repos.map((r) => (
              <tr key={r._id}>
                <td>{r.name}</td>
                <td>
                  <a href={r.githubUrl} target="_blank" rel="noreferrer">
                    {r.githubFullName}
                  </a>
                </td>
                <td className="muted">
                  {r.lastIndexedAt
                    ? new Date(r.lastIndexedAt).toLocaleString()
                    : "—"}
                </td>
                <td>{r.enabled ? "✓" : "—"}</td>
                <td>
                  <div className="row">
                    <button
                      onClick={() =>
                        teamId &&
                        reindex({
                          teamId,
                          repoId: r._id,
                        })
                      }
                    >
                      re-index
                    </button>
                    <button
                      className="danger"
                      onClick={() => {
                        if (teamId && confirm(`delete ${r.name}?`)) {
                          void remove({
                            teamId,
                            repoId: r._id,
                          });
                        }
                      }}
                    >
                      delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
