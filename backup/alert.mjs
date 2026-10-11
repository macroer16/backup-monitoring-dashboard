// Opens, updates or closes GitHub issues for failed backups. GitHub then emails the owner.
// Runs inside GitHub Actions with GH_TOKEN, GITHUB_REPOSITORY and the history file.

import { readFileSync } from "node:fs";
import { planAlerts } from "./lib.mjs";

const historyFile = process.argv[2] ?? "data/history.json";
const { GH_TOKEN, GITHUB_REPOSITORY, GITHUB_SERVER_URL = "https://github.com", GITHUB_RUN_ID } = process.env;
if (!GH_TOKEN || !GITHUB_REPOSITORY) throw new Error("GH_TOKEN and GITHUB_REPOSITORY are required");

const api = async (path, options = {}) => {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "backup-monitor" },
  });
  if (!res.ok) throw new Error(`${options.method ?? "GET"} ${path} returned ${res.status}`);
  return res.json();
};

const run = JSON.parse(readFileSync(historyFile, "utf8")).runs.at(-1);
const open = (await api("/issues?state=open&per_page=100")).filter((i) => !i.pull_request);
const runUrl = GITHUB_RUN_ID ? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}` : "";

for (const step of planAlerts(run, open, runUrl)) {
  if (step.action === "create") {
    await api("/issues", { method: "POST", body: JSON.stringify({ title: step.title, body: step.body }) });
  } else {
    await api(`/issues/${step.number}/comments`, { method: "POST", body: JSON.stringify({ body: step.body }) });
    if (step.action === "close") {
      await api(`/issues/${step.number}`, { method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: "completed" }) });
    }
  }
  console.log(step.action, step.title ?? `#${step.number}`);
}
