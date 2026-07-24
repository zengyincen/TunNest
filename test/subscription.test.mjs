import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../product.config.json", import.meta.url)));
const licenseClient = readFileSync(new URL("../extension/lib/license.js", import.meta.url), "utf8");
const automation = readFileSync(new URL("../automation/sync.mjs", import.meta.url), "utf8");
const migration = readFileSync(new URL("../license-worker/migrations/0002_trials_and_client_slots.sql", import.meta.url), "utf8");
const worker = readFileSync(new URL("../license-worker/src/index.ts", import.meta.url), "utf8");

test("offers a seven-day full trial with acceptable device limits", () => {
  assert.equal(config.trialDays, 7);
  assert.equal(config.browserDeviceLimit, 3);
  assert.equal(config.actionsLimit, 1);
  assert.match(licenseClient, /chrome\.storage\.sync/);
  assert.match(licenseClient, /trialSubjectId/);
  assert.doesNotMatch(licenseClient, /installedAt|serialNumber|hardwareId/);
  assert.match(migration, /CREATE TABLE trials/);
  assert.match(migration, /subject_hash TEXT NOT NULL UNIQUE/);
});

test("requires a paid license for GitHub Actions", () => {
  assert.match(automation, /clientType:"github-actions"/);
  assert.match(automation, /TUNNEST_LICENSE_KEY/);
  assert.doesNotMatch(automation, /trials\/verify/);
});

test("binds license devices atomically when concurrent jobs verify the same repository", () => {
  assert.match(worker, /INSERT INTO activations[\s\S]*SELECT \?1,\?2,\?3,\?4,\?5,\?6/);
  assert.match(worker, /WHERE EXISTS\([\s\S]*license_id=\?2 AND device_hash=\?3/);
  assert.match(worker, /SELECT COUNT\(\*\)[\s\S]*client_type=\?5/);
  assert.match(worker, /ON CONFLICT\(license_id,device_hash\) DO UPDATE SET/);
  assert.match(worker, /activation\.meta\.changes === 0/);
  assert.doesNotMatch(worker, /const existing = await env\.DB/);
});

test("starts a trial idempotently when duplicate first checks race", () => {
  assert.match(worker, /INSERT OR IGNORE INTO trials/);
  assert.match(worker, /row = await env\.DB\.prepare\("SELECT \* FROM trials WHERE subject_hash=\?1"\)/);
});
