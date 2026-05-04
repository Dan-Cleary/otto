import { useQuery } from "convex/react";
import { api } from "../convexApi";
import { OttoHero, StatCard } from "../Otto";
import { useTeam } from "../teamContext";

export function AuditTab() {
  const { teamId } = useTeam();
  const items = useQuery(
    api.admin.recentItems,
    teamId ? { teamId, limit: 100 } : "skip",
  );
  const log = useQuery(
    api.admin.recentAuditLog,
    teamId ? { teamId, limit: 200 } : "skip",
  );

  const stats = items ? computeStats(items) : null;

  return (
    <>
      {stats && (
        <div className="stat-grid">
          <StatCard
            label={
              <>
                ITEMS <span className="sep">//</span> ALL TIME
              </>
            }
            value={stats.total}
            caption={`${stats.last7d} in the last 7 days`}
          />
          <StatCard
            label={
              <>
                PRS DRAFTED <span className="sep">//</span> ALL TIME
              </>
            }
            value={stats.prsOpened}
            caption={`${stats.prsLast7d} in the last 7 days`}
            accent
          />
          <StatCard
            label={
              <>
                AWAITING <span className="sep">//</span> SLACK QUEUE
              </>
            }
            value={stats.queued}
            caption={stats.queued === 0 ? "all clear" : "needs review"}
          />
        </div>
      )}

      <div className="section-label">
        ACTIVITY <span className="sep">//</span> RECENT ITEMS
      </div>

      {!items ? (
        <p className="muted">Loading…</p>
      ) : items.length === 0 ? (
        <div className="empty">
          <OttoHero size={120} caption="quiet so far" />
          <p style={{ marginTop: 12 }}>No items yet.</p>
          <p className="muted">
            Drop the widget onto a page or send a Granola transcript to wake
            Otto up.
          </p>
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th style={{ width: 130 }}>status</th>
              <th>what otto's doing</th>
              <th style={{ width: 200 }}>source</th>
              <th style={{ width: 110 }}>confidence</th>
              <th style={{ width: 60 }}>pr</th>
            </tr>
          </thead>
          <tbody>
            {items.slice(0, 50).map((it) => (
              <tr key={it._id}>
                <td>
                  <span className={`status s-${it.status}`}>
                    {statusLabel(it.status)}
                  </span>
                </td>
                <td>{it.description}</td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {shortSource(it.sourceRef)}
                </td>
                <td
                  className="muted"
                  style={{ fontFamily: "var(--o-font-mono)", fontSize: 12 }}
                >
                  {(it.parserConfidence * (it.routerConfidence ?? 0)).toFixed(2)}
                </td>
                <td>
                  {it.prUrl ? (
                    <a href={it.prUrl} target="_blank" rel="noreferrer">
                      open
                    </a>
                  ) : (
                    <span className="subtle">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="section-label">
        AUDIT LOG <span className="sep">//</span> RAW EVENTS
      </div>
      {!log ? (
        <p className="muted">Loading…</p>
      ) : log.length === 0 ? (
        <div className="empty">
          <p className="muted">Nothing yet.</p>
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th style={{ width: 140 }}>when</th>
              <th style={{ width: 220 }}>event</th>
              <th>actor</th>
              <th>item</th>
            </tr>
          </thead>
          <tbody>
            {log.map((row) => (
              <tr key={row._id}>
                <td
                  className="muted"
                  style={{ fontFamily: "var(--o-font-mono)", fontSize: 11 }}
                  title={new Date(row.at).toISOString()}
                >
                  {relativeTime(row.at)}
                </td>
                <td>
                  <code>{row.event}</code>
                </td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {row.actor}
                </td>
                <td
                  className="subtle"
                  style={{ fontSize: 11, fontFamily: "var(--o-font-mono)" }}
                >
                  {row.itemId ? row.itemId.slice(-8) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function computeStats(items: { createdAt: number; status: string }[]) {
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const recent = items.filter((i) => now - i.createdAt < sevenDays);
  return {
    total: items.length,
    last7d: recent.length,
    prsOpened: items.filter((i) => i.status === "pr_opened").length,
    prsLast7d: recent.filter((i) => i.status === "pr_opened").length,
    queued: items.filter((i) => i.status === "queued").length,
  };
}

function statusLabel(status: string): string {
  switch (status) {
    case "parsed": return "parsed";
    case "queued": return "awaiting review";
    case "approved": return "approved";
    case "fired": return "working";
    case "pr_opened": return "pr open";
    case "failed": return "failed";
    case "rejected": return "rejected";
    default: return status;
  }
}

function shortSource(ref: string): string {
  try {
    const u = new URL(ref);
    return `${u.host}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return ref;
  }
}

function relativeTime(ms: number): string {
  const diff = (Date.now() - ms) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return new Date(ms).toLocaleDateString();
}
