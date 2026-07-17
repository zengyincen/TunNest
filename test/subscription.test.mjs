import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../product.config.json", import.meta.url)));
const licenseClient = readFileSync(new URL("../extension/lib/license.js", import.meta.url), "utf8");
const automation = readFileSync(new URL("../automation/sync.mjs", import.meta.url), "utf8");
const migration = readFileSync(new URL("../license-worker/migrations/0002_trials_and_client_slots.sql", import.meta.url), "utf8");

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
