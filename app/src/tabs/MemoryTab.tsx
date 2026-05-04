import { useQuery } from "convex/react";
import { api } from "../convexApi";
import { useTeam } from "../teamContext";

export function MemoryTab() {
  const { teamId } = useTeam();
  const rows = useQuery(
    api.admin.listMemory,
    teamId ? { teamId, limit: 200 } : "skip",
  );
  if (!rows) return <p className="muted">loading…</p>;
  if (rows.length === 0)
    return (
      <div className="empty">
        no routing corrections yet. the router will learn from re-route clicks
        in the slack queue.
      </div>
    );

  return (
    <table>
      <thead>
        <tr>
          <th>description</th>
          <th>corrected to</th>
          <th>by</th>
          <th>when</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => (
          <tr key={m._id}>
            <td>{m.description}</td>
            <td>
              <code>{m.correctedRepoName}</code>
            </td>
            <td className="muted">{m.correctedBy}</td>
            <td className="muted">
              {new Date(m.correctedAt).toLocaleString()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
