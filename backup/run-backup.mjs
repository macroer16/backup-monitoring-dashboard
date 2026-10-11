// Backs up every public repository of a GitHub user as a git bundle, then proves each
// backup can be restored. Writes the results to a JSON history file for the dashboard.
//
// Usage: node backup/run-backup.mjs --owner macroer16 --out backups --history data/history.json
// Set REPOS=name1,name2 to back up only some repositories (handy for testing).

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { appendHistory, classify, lastSizes, markdownSummary } from "./lib.mjs";

const { values: args } = parseArgs({
  options: {
    owner: { type: "string", default: process.env.GITHUB_REPOSITORY_OWNER },
    out: { type: "string", default: "backups" },
    history: { type: "string", default: "data/history.json" },
  },
});
if (!args.owner) throw new Error("Pass --owner <github user>");

const git = (gitArgs, opts = {}) =>
  execFileSync("git", gitArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, // never hang waiting for a password
    ...opts,
  }).trim();

async function listRepos(owner) {
  if (process.env.REPOS) return process.env.REPOS.split(",").map((s) => s.trim()).filter(Boolean);
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "backup-monitor" };
  if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
  const names = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`https://api.github.com/users/${owner}/repos?per_page=100&page=${page}&type=owner`, { headers });
    if (!res.ok) throw new Error(`GitHub API returned ${res.status} when listing repositories`);
    const batch = await res.json();
    names.push(...batch.filter((r) => !r.fork && !r.private && !r.archived).map((r) => r.name));
    if (batch.length < 100) break;
  }
  return names.sort();
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

// git's error output is long; the last meaningful line is the useful part.
function shortError(err) {
  const text = String(err.stderr || err.message || err).trim().split("\n").filter(Boolean);
  if (/could not read Username|not found/i.test(text.join(" "))) return "Repository not found, or it is private.";
  return (text.at(-1) || "Unknown error").replace(/^fatal:\s*/, "").slice(0, 200);
}

function backupOne(owner, name, outDir, workDir) {
  const started = Date.now();
  const mirror = join(workDir, `${name}.git`);
  const restored = join(workDir, `${name}-restore`);
  const bundle = resolve(outDir, `${name}.bundle`);
  const result = { name };
  try {
    // 1. Copy every branch and tag.
    git(["clone", "--mirror", "--quiet", `https://github.com/${owner}/${name}.git`, mirror]);
    const refs = git(["-C", mirror, "for-each-ref", "--count=1"]);
    if (!refs) throw Object.assign(new Error("Repository is empty, so there is nothing to back up."), { stderr: "" });
    // 2. Pack it into one file and check git agrees the file is complete.
    git(["-C", mirror, "bundle", "create", bundle, "--all"]);
    git(["-C", mirror, "bundle", "verify", bundle]);
    // 3. Restore test: a backup you've never restored is only a hope.
    git(["clone", "--quiet", bundle, restored]);
    const head = git(["-C", mirror, "rev-parse", "HEAD"]);
    result.restoreOk = git(["-C", restored, "rev-parse", "HEAD"]) === head;
    result.head = head.slice(0, 7);
    result.commits = Number(git(["-C", mirror, "rev-list", "--all", "--count"]));
    result.sizeBytes = statSync(bundle).size;
    result.sha256 = sha256(bundle);
  } catch (err) {
    result.error = shortError(err);
  } finally {
    rmSync(mirror, { recursive: true, force: true });
    rmSync(restored, { recursive: true, force: true });
  }
  result.durationMs = Date.now() - started;
  return result;
}

const history = existsSync(args.history) ? JSON.parse(readFileSync(args.history, "utf8")) : { version: 1, runs: [] };
const previous = lastSizes(history);
mkdirSync(args.out, { recursive: true });
const workDir = mkdtempSync(join(tmpdir(), "backup-"));

const run = {
  id: process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`,
  trigger: process.env.GITHUB_EVENT_NAME ?? "manual",
  startedAt: new Date().toISOString(),
  repos: [],
};

for (const name of await listRepos(args.owner)) {
  const raw = backupOne(args.owner, name, args.out, workDir);
  const { status, reason } = classify(raw, previous[name]);
  const { error, ...kept } = raw;
  run.repos.push({ ...kept, status, reason });
  console.log(`${status.padEnd(8)} ${name}  ${reason}`);
}
run.finishedAt = new Date().toISOString();
rmSync(workDir, { recursive: true, force: true });

mkdirSync(dirname(args.history), { recursive: true });
writeFileSync(args.history, JSON.stringify(appendHistory(history, run), null, 1) + "\n");

if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdownSummary(run) + "\n");
const failed = run.repos.filter((r) => r.status === "failed").map((r) => r.name);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `failed=${failed.join(",")}\n`);
console.log(`\n${run.repos.length} repositories, ${failed.length} failed.`);
