import { formatBytes, summarise, timeAgo } from "./summary.js";

const OWNER = "macroer16";
const REPO = "backup-monitoring-dashboard";
const LIVE_DATA = `https://raw.githubusercontent.com/${OWNER}/${REPO}/backup-data/history.json`;

// ?data=docs/sample-history.json loads a local file instead (used for testing and the screenshot).
// Only relative paths are allowed, so the page can't be pointed at someone else's server.
function dataUrl() {
  const local = new URLSearchParams(location.search).get("data");
  return local && /^[\w./-]+\.json$/.test(local) && !local.includes("..") ? local : LIVE_DATA;
}

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const LABEL = { success: "Healthy", warning: "Warning", failed: "Failed", none: "Not backed up" };
const TRIGGER = { schedule: "run by the nightly schedule", push: "run after a code change", workflow_dispatch: "run by hand" };
const fmtDate = (iso) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

let summary;

async function load() {
  try {
    const res = await fetch(dataUrl(), { cache: "no-store" });
    if (res.status === 404) return render(summarise({ runs: [] }));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    render(summarise(await res.json()));
  } catch (err) {
    setState("failed", "Couldn't load the backup history", `${err.message}. The data lives on the backup-data branch of this repository.`);
  }
}

function setState(level, title, detail) {
  $("state").dataset.level = level;
  $("state-title").textContent = title;
  $("state-detail").textContent = detail;
}

function render(s) {
  summary = s;
  const { totals, latest } = s;
  const problems = totals.failed + totals.warning;
  const title = !latest ? "No backups yet"
    : s.overall === "success" ? "All backups healthy"
    : totals.failed ? `${totals.failed} backup${totals.failed > 1 ? "s" : ""} failing`
    : problems ? `${problems} backup${problems > 1 ? "s" : ""} need${problems > 1 ? "" : "s"} checking`
    : "The backup job has stopped running";
  const detail = latest
    ? `Last run ${timeAgo(latest.finishedAt)} (${fmtDate(latest.finishedAt)}), ${latest.repos.length} repositories, ${TRIGGER[latest.trigger] ?? "run by hand"}.`
    : "The first run will appear here once the nightly job has run.";
  setState(s.overall, title, detail);

  $("metrics").hidden = !latest;
  $("m-repos").textContent = totals.repos;
  $("m-ok").textContent = totals.success;
  $("m-warn").textContent = totals.warning;
  $("m-fail").textContent = totals.failed;
  $("m-size").textContent = formatBytes(totals.bytes);
  $("m-runs").textContent = totals.runs;

  $("alerts-section").hidden = s.alerts.length === 0;
  $("alerts").innerHTML = s.alerts.map((a) => `
    <li class="alert" data-level="${a.level}">
      <strong>${a.repo ? esc(a.repo) : "Backup job"}</strong>
      <span>${esc(a.text)}</span>
    </li>`).join("");

  $("repos-section").hidden = s.repos.length === 0;
  renderRows();
}

function renderRows() {
  const q = $("filter").value.trim().toLowerCase();
  const onlyProblems = $("problems-only").checked;
  const rows = summary.repos
    .filter((r) => !r.dropped)
    .filter((r) => r.name.toLowerCase().includes(q))
    .filter((r) => !onlyProblems || r.current.status !== "success");

  $("rows").innerHTML = rows.map((r) => {
    const c = r.current;
    const okRuns = r.timeline.filter((t) => t.status === "success").length;
    const ticks = r.timeline.map((t) =>
      `<i class="tick ${t.status}" title="${esc(fmtDate(t.at))}: ${esc(LABEL[t.status])}. ${esc(t.reason)}"></i>`).join("");
    return `<tr>
      <th scope="row"><a href="https://github.com/${OWNER}/${esc(r.name)}">${esc(r.name)}</a></th>
      <td><span class="status" data-level="${c.status}">${LABEL[c.status]}</span></td>
      <td><span class="ticks" aria-hidden="true">${ticks}</span><span class="visually-hidden">${okRuns} of ${r.timeline.length} runs succeeded</span></td>
      <td title="${r.lastSuccessAt ? esc(fmtDate(r.lastSuccessAt)) : ""}">${timeAgo(r.lastSuccessAt)}</td>
      <td class="num">${c.sizeBytes ? formatBytes(c.sizeBytes) : "-"}</td>
      <td class="num">${c.commits ?? "-"}</td>
      <td class="mono" title="${esc(c.sha256 ?? "")}">${c.sha256 ? esc(c.sha256.slice(0, 12)) : "-"}</td>
    </tr>`;
  }).join("");
  $("empty-filter").hidden = rows.length > 0;
}

$("filter").addEventListener("input", renderRows);
$("problems-only").addEventListener("change", renderRows);
load();
