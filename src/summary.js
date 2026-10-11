// Turns the raw backup history into what the dashboard shows. Pure functions, tested in tests/.

// The job runs nightly. If nothing has run for 36 hours, something is wrong with the job itself.
export const STALE_HOURS = 36;
const TIMELINE_LENGTH = 30;

const byTime = (a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0);

export function summarise(history, now = new Date()) {
  const runs = [...(history?.runs ?? [])].sort(byTime);
  const latest = runs.at(-1) ?? null;

  const names = [...new Set(runs.flatMap((r) => r.repos.map((x) => x.name)))].sort();
  const repos = names.map((name) => {
    const entries = runs.map((r) => ({ run: r, repo: r.repos.find((x) => x.name === name) }));
    const seen = entries.filter((e) => e.repo);
    const lastSuccess = [...seen].reverse().find((e) => e.repo.status === "success");
    const current = latest?.repos.find((x) => x.name === name) ?? null;
    return {
      name,
      current,
      // Still in history but not in the latest run: deleted, made private or archived.
      dropped: !current,
      lastSuccessAt: lastSuccess?.run.startedAt ?? null,
      successRate: seen.length ? seen.filter((e) => e.repo.status === "success").length / seen.length : 0,
      timeline: entries.slice(-TIMELINE_LENGTH).map((e) => ({
        at: e.run.startedAt,
        status: e.repo?.status ?? "none",
        reason: e.repo?.reason ?? "Not included in this run",
      })),
    };
  });

  const hoursSinceRun = latest ? (now - new Date(latest.finishedAt ?? latest.startedAt)) / 36e5 : Infinity;
  const alerts = [];
  if (!latest) {
    alerts.push({ level: "failed", text: "No backups have run yet." });
  } else if (hoursSinceRun > STALE_HOURS) {
    alerts.push({
      level: "failed",
      text: `No backup has run for ${Math.floor(hoursSinceRun)} hours. The nightly job may be switched off or broken.`,
    });
  }
  for (const r of repos) {
    if (r.current?.status === "failed" || r.current?.status === "warning") {
      alerts.push({ level: r.current.status, repo: r.name, text: r.current.reason });
    }
  }

  const count = (s) => repos.filter((r) => r.current?.status === s).length;
  const totals = {
    success: count("success"),
    warning: count("warning"),
    failed: count("failed"),
    repos: repos.filter((r) => !r.dropped).length,
    bytes: (latest?.repos ?? []).reduce((sum, r) => sum + (r.sizeBytes ?? 0), 0),
    runs: runs.length,
  };

  let overall = "success";
  if (totals.warning) overall = "warning";
  if (totals.failed || alerts.some((a) => a.level === "failed")) overall = "failed";

  return { latest, repos, alerts, totals, overall, hoursSinceRun };
}

export function formatBytes(bytes) {
  if (!bytes) return "0 KB";
  const units = ["bytes", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

export function timeAgo(iso, now = new Date()) {
  if (!iso) return "never";
  const mins = Math.round((now - new Date(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}
