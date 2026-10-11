import { test } from "node:test";
import assert from "node:assert/strict";
import { appendHistory, classify, issueTitle, lastSizes, planAlerts } from "../backup/lib.mjs";

const MB = 1024 * 1024;

test("a verified, restore-tested backup is a success", () => {
  assert.equal(classify({ restoreOk: true, sizeBytes: 5000 }, 4000).status, "success");
});

test("any error is a failure, with git's reason kept", () => {
  const r = classify({ error: "Repository not found, or it is private." });
  assert.equal(r.status, "failed");
  assert.match(r.reason, /not found/);
});

test("a backup that can't be restored is a failure, even though it was created", () => {
  assert.equal(classify({ restoreOk: false, sizeBytes: 5000 }).status, "failed");
});

test("a big drop in size is a warning (possible deletion or force-push)", () => {
  const r = classify({ restoreOk: true, sizeBytes: 2 * MB }, 10 * MB);
  assert.equal(r.status, "warning");
  assert.match(r.reason, /80% smaller/);
});

test("a backup that more than doubles is a warning (possible large file committed)", () => {
  assert.equal(classify({ restoreOk: true, sizeBytes: 9 * MB }, 3 * MB).status, "warning");
});

test("small repos changing size by under 1 MB never warn", () => {
  assert.equal(classify({ restoreOk: true, sizeBytes: 90_000 }, 20_000).status, "success");
});

test("the first ever backup has nothing to compare with, so it's a success", () => {
  assert.equal(classify({ restoreOk: true, sizeBytes: 50 * MB }, undefined).status, "success");
});

test("lastSizes ignores failed runs", () => {
  const history = { runs: [
    { repos: [{ name: "a", status: "success", sizeBytes: 100 }] },
    { repos: [{ name: "a", status: "failed" }] },
  ] };
  assert.deepEqual(lastSizes(history), { a: 100 });
});

test("appendHistory keeps only the newest runs", () => {
  let h = { version: 1, runs: [] };
  for (let i = 0; i < 5; i++) h = appendHistory(h, { id: i }, 3);
  assert.deepEqual(h.runs.map((r) => r.id), [2, 3, 4]);
});

const run = (repos) => ({ startedAt: "2026-10-12T02:23:00Z", repos });

test("a new failure opens one issue", () => {
  const steps = planAlerts(run([{ name: "carecircle", status: "failed", reason: "boom" }]), []);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].action, "create");
  assert.equal(steps[0].title, issueTitle("carecircle"));
});

test("a repeat failure comments on the open issue instead of opening another", () => {
  const steps = planAlerts(run([{ name: "carecircle", status: "failed", reason: "boom" }]),
    [{ number: 4, title: "Backup failed: carecircle" }]);
  assert.deepEqual(steps.map((s) => [s.action, s.number]), [["comment", 4]]);
});

test("a recovered repo closes its issue", () => {
  const steps = planAlerts(run([{ name: "carecircle", status: "success", reason: "ok" }]),
    [{ number: 4, title: "Backup failed: carecircle" }]);
  assert.deepEqual(steps.map((s) => s.action), ["close"]);
});

test("unrelated open issues are left alone", () => {
  const steps = planAlerts(run([{ name: "a", status: "success" }]), [{ number: 9, title: "Improve README" }]);
  assert.equal(steps.length, 0);
});

test("warnings don't open issues (they show on the dashboard instead)", () => {
  assert.equal(planAlerts(run([{ name: "a", status: "warning", reason: "smaller" }]), []).length, 0);
});
