import { test } from "node:test";
import assert from "node:assert/strict";
import { formatBytes, summarise, timeAgo } from "../src/summary.js";

const now = new Date("2026-10-12T09:00:00Z");
const run = (startedAt, repos) => ({ startedAt, finishedAt: startedAt, repos });
const ok = (name, sizeBytes = 1000) => ({ name, status: "success", reason: "ok", sizeBytes });

test("empty history says no backups have run", () => {
  const s = summarise({ runs: [] }, now);
  assert.equal(s.overall, "failed");
  assert.match(s.alerts[0].text, /No backups have run/);
});

test("all healthy and recent is overall success with no alerts", () => {
  const s = summarise({ runs: [run("2026-10-12T02:00:00Z", [ok("a"), ok("b")])] }, now);
  assert.equal(s.overall, "success");
  assert.equal(s.alerts.length, 0);
  assert.equal(s.totals.success, 2);
  assert.equal(s.totals.bytes, 2000);
});

test("a stale job is a failure even if the last run was fine", () => {
  const s = summarise({ runs: [run("2026-10-10T02:00:00Z", [ok("a")])] }, now);
  assert.equal(s.overall, "failed");
  assert.match(s.alerts[0].text, /55 hours/);
});

test("runs are sorted by time even if stored out of order", () => {
  const s = summarise({ runs: [
    run("2026-10-12T02:00:00Z", [ok("a")]),
    run("2026-10-11T02:00:00Z", [{ name: "a", status: "failed", reason: "x" }]),
  ] }, now);
  assert.equal(s.repos[0].current.status, "success");
  assert.deepEqual(s.repos[0].timeline.map((t) => t.status), ["failed", "success"]);
});

test("last success and success rate are worked out per repo", () => {
  const s = summarise({ runs: [
    run("2026-10-10T02:00:00Z", [ok("a")]),
    run("2026-10-11T02:00:00Z", [{ name: "a", status: "failed", reason: "x" }]),
    run("2026-10-12T02:00:00Z", [{ name: "a", status: "failed", reason: "x" }]),
  ] }, now);
  const a = s.repos[0];
  assert.equal(a.lastSuccessAt, "2026-10-10T02:00:00Z");
  assert.equal(Math.round(a.successRate * 100), 33);
  assert.equal(s.alerts[0].repo, "a");
});

test("a repo missing from the latest run is marked as dropped, not failed", () => {
  const s = summarise({ runs: [
    run("2026-10-11T02:00:00Z", [ok("a"), ok("old")]),
    run("2026-10-12T02:00:00Z", [ok("a")]),
  ] }, now);
  const old = s.repos.find((r) => r.name === "old");
  assert.equal(old.dropped, true);
  assert.equal(s.totals.repos, 1);
  assert.equal(s.overall, "success");
});

test("warnings make the overall status a warning", () => {
  const s = summarise({ runs: [run("2026-10-12T02:00:00Z", [ok("a"), { name: "b", status: "warning", reason: "smaller" }])] }, now);
  assert.equal(s.overall, "warning");
});

test("timeline is capped at 30 runs", () => {
  const runs = Array.from({ length: 40 }, (_, i) => run(new Date(Date.UTC(2026, 8, 1 + i)).toISOString(), [ok("a")]));
  assert.equal(summarise({ runs }, now).repos[0].timeline.length, 30);
});

test("formatBytes and timeAgo read naturally", () => {
  assert.equal(formatBytes(18063), "18 KB");
  assert.equal(formatBytes(3.5 * 1024 * 1024), "3.5 MB");
  assert.equal(timeAgo("2026-10-12T08:30:00Z", now), "30 min ago");
  assert.equal(timeAgo("2026-10-12T02:00:00Z", now), "7 h ago");
  assert.equal(timeAgo(null, now), "never");
});
