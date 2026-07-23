import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const popup = readFileSync(new URL("../extension/popup.js", import.meta.url), "utf8");
const background = readFileSync(new URL("../extension/background.js", import.meta.url), "utf8");
const popupHtml = readFileSync(new URL("../extension/popup.html", import.meta.url), "utf8");

test("binds popup actions before starting asynchronous initialization", () => {
  const binding = popup.indexOf('button.addEventListener("click"');
  const initialization = popup.indexOf("initialize().catch");
  assert.ok(binding >= 0 && initialization > binding);
  assert.doesNotMatch(popup, /^const status\s*=\s*await/m);
});

test("persists synchronization progress for popup reopen", () => {
  assert.match(background, /chrome\.storage\.local\.set\(\{ syncState \}\)/);
  assert.match(background, /phase: "writing"/);
  assert.match(background, /updateSyncState\(\{ completed: offset \+ completed, total, detail:/);
  assert.match(popup, /chrome\.storage\.onChanged\.addListener/);
  assert.match(popupHtml, /id="syncProgress"/);
});

test("can stop a running sync and recover an orphaned state", () => {
  assert.match(background, /CANCEL_SYNC/);
  assert.match(background, /new AbortController\(\)/);
  assert.match(background, /missingRun/);
  assert.match(background, /age>2\*60\*1000/);
  assert.match(popup, /async function cancelSync\(\)/);
  assert.match(popupHtml, /id="cancelSync"/);
});
