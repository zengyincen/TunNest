import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { isTransientNotionError, syncItemsWithRetry } from "../automation/lib/notion.mjs";

const automation = readFileSync(new URL("../automation/sync.mjs", import.meta.url), "utf8");

test("retries only transient Notion failures and preserves successful results", async () => {
  const calls = [], waits = [], retries = [];
  const items = [{ title: "福斯特医生 第一季" }, { title: "正常条目" }];
  const syncImpl = async (_token, _databaseId, batch) => {
    calls.push(batch);
    return calls.length === 1
      ? [{ ok: false, title: batch[0].title, error: "Notion 请求超时，请重试" }, { ok: true, id: "page-2" }]
      : [{ ok: true, id: "page-1" }];
  };
  const results = await syncItemsWithRetry("token", "database", items, "douban", {
    syncImpl,
    sleepImpl: async (milliseconds) => waits.push(milliseconds),
    onRetry: (event) => retries.push(event)
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], [items[0]]);
  assert.deepEqual(waits, [2000]);
  assert.equal(retries[0].count, 1);
  assert.equal(results.every((result) => result.ok), true);
});

test("does not retry permanent Notion validation failures", async () => {
  let calls = 0;
  const results = await syncItemsWithRetry("token", "database", [{ title: "错误字段" }], "douban", {
    syncImpl: async () => { calls++; return [{ ok: false, error: "body failed validation" }]; },
    sleepImpl: async () => { throw new Error("should not wait"); }
  });
  assert.equal(calls, 1);
  assert.equal(results[0].ok, false);
});

test("recognizes Notion timeout, throttling and server errors as transient", () => {
  for (const message of ["Notion 请求超时，请重试", "Notion 请求失败 (429)", "Notion 请求失败 (503)", "fetch failed", "service_unavailable"]) {
    assert.equal(isTransientNotionError(message), true, message);
  }
  assert.equal(isTransientNotionError("body failed validation"), false);
});

test("deduplicates repeated Douban mirror fallback messages in Actions", () => {
  assert.match(automation, /const doubanCoverMessages=new Set\(\)/);
  assert.match(automation, /if\(doubanCoverMessages\.has\(message\)\)return/);
  assert.doesNotMatch(automation, /onStatus:console\.log/);
});
