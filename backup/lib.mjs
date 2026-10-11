// Pure logic used by the backup job. No file system or network here, so it can be tested.

const MB = 1024 * 1024;

/**
 * Decide the status of one repository's backup.
 * failed  = we don't have a backup we can trust
 * warning = the backup worked, but something about it looks wrong and a person should check
 */
export function classify({ error, restoreOk, sizeBytes }, previousSize) {
  if (error) return { status: "failed", reason: error };
  if (!restoreOk) {
    return { status: "failed", reason: "Restore test failed: restoring the bundle did not give the same latest commit." };
  }
  // Size checks only matter for real changes; tiny repos double in size easily.
  if (previousSize && Math.abs(sizeBytes - previousSize) > MB) {
    if (sizeBytes < previousSize * 0.5) {
      const pct = Math.round((1 - sizeBytes / previousSize) * 100);
      return { status: "warning", reason: `Backup is ${pct}% smaller than last time. Check nothing was deleted or force-pushed by mistake.` };
    }
    if (sizeBytes > previousSize * 2) {
      return { status: "warning", reason: "Backup more than doubled in size. Check no large files were committed by mistake." };
    }
  }
  return { status: "success", reason: "Backed up, verified and restore-tested." };
}

/** Size of each repo's last successful backup, so the next run can compare. */
export function lastSizes(history) {
  const sizes = {};
  for (const run of history.runs) {
    for (const repo of run.repos) {
      if (repo.status !== "failed" && repo.sizeBytes) sizes[repo.name] = repo.sizeBytes;
    }
  }
  return sizes;
}

/** Add a run to the history and keep only the newest `keep` runs. */
export function appendHistory(history, run, keep = 90) {
  const runs = [...(history.runs ?? []), run].slice(-keep);
  return { version: 1, runs };
}

export const issueTitle = (name) => `Backup failed: ${name}`;

/**
 * Work out which GitHub issues to open, comment on or close.
 * One open issue per failing repo, so a repo that fails every night
 * gets a comment each time instead of a new issue each time.
 */
export function planAlerts(run, openIssues, runUrl = "") {
  const actions = [];
  const link = runUrl ? `\n\nJob log: ${runUrl}` : "";
  for (const repo of run.repos) {
    const existing = openIssues.find((i) => i.title === issueTitle(repo.name));
    if (repo.status === "failed") {
      const body = `The backup of **${repo.name}** failed at ${run.startedAt}.\n\nReason: ${repo.reason}${link}`;
      actions.push(existing
        ? { action: "comment", number: existing.number, body: `Failed again at ${run.startedAt}.\n\nReason: ${repo.reason}${link}` }
        : { action: "create", title: issueTitle(repo.name), body });
    } else if (existing) {
      actions.push({ action: "close", number: existing.number, body: `Recovered: backed up successfully at ${run.startedAt}.` });
    }
  }
  return actions;
}

/** Markdown summary shown on the GitHub Actions run page. */
export function markdownSummary(run) {
  const icon = { success: "✅", warning: "⚠️", failed: "❌" };
  const rows = run.repos.map((r) =>
    `| ${r.name} | ${icon[r.status]} ${r.status} | ${r.sizeBytes ? (r.sizeBytes / 1024).toFixed(0) + " KB" : "-"} | ${r.commits ?? "-"} | ${r.reason} |`);
  return ["## Backup run", "", "| Repository | Status | Size | Commits | Detail |", "|---|---|---|---|---|", ...rows].join("\n");
}
