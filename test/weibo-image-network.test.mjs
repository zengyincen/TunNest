import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));
const background = readFileSync(new URL("../extension/background.js", import.meta.url), "utf8");
const notion = readFileSync(new URL("../extension/lib/notion.js", import.meta.url), "utf8");

test("adds a narrowly scoped Referer rule for extension image downloads", () => {
  assert.ok(manifest.permissions.includes("declarativeNetRequestWithHostAccess"));
  assert.ok(manifest.host_permissions.includes("https://*.sinaimg.cn/*"));
  assert.match(background, /initiatorDomains:\s*\[chrome\.runtime\.id\]/);
  assert.match(background, /requestDomains:\s*\["sinaimg\.cn"\]/);
  assert.match(background, /resourceTypes:\s*\["xmlhttprequest"\]/);
  assert.match(background, /header:\s*"Referer",\s*operation:\s*"set",\s*value:\s*"https:\/\/weibo\.com\/"/);
});

test("waits for the header rule and uploads downloaded bytes before external import", () => {
  assert.match(background, /source === "weibo" \|\| source === "douban"\) await remoteHeadersReady/);
  assert.ok(notion.indexOf('mode: "single_part"') < notion.indexOf('mode: "external_url"'));
  assert.match(notion, /credentials:\s*"omit"/);
  assert.match(notion, /cache:\s*"no-store"/);
  assert.match(notion, /async function timedFetch/);
  assert.match(notion, /formData \? 90000 : 45000/);
});
