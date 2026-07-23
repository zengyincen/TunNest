import test from "node:test";
import assert from "node:assert/strict";
import { fetchWeiboDesktopInPage, fetchWeiboInPage } from "../extension/lib/sources.js";

test("runs as a self-contained page function and converts Weibo posts", async () => {
  const runInPage = Function(`return (${fetchWeiboInPage.toString()})`)();
  const restore = installPageGlobals({
    ok: 1,
    data: { cards: [{ mblog: { id: "123", bid: "AbCd", text: "一条微博", created_at: "2026-07-22T08:00:00Z", user: { screen_name: "测试用户" }, reposts_count: 1, comments_count: 2, attitudes_count: 3 } }] }
  });
  try {
    const result = await runInPage(["6063458646"], 1);
    assert.equal(result.ok, true);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].externalId, "123");
    assert.equal(result.items[0].author, "测试用户");
  } finally { restore(); }
});

test("keeps the error reason returned by Weibo", async () => {
  const restore = installPageGlobals({ ok: 0, msg: "访问频次过高", errno: 432 });
  try {
    const result = await fetchWeiboInPage(["6063458646"], 1);
    assert.equal(result.ok, false);
    assert.equal(result.status, 432);
    assert.match(result.error, /访问频次过高/);
  } finally { restore(); }
});

test("uses the current desktop feed response format", async () => {
  const restore = installPageGlobals({
    ok: 1,
    data: { since_id: "next-page", list: [{ idstr: "456", mblogid: "QrSt", text_raw: "桌面微博", created_at: "2026-07-22T09:00:00Z", user: { screen_name: "桌面用户" }, reposts_count: 4, comments_count: 5, attitudes_count: 6 }] }
  }, "weibo.com");
  try {
    const result = await fetchWeiboDesktopInPage(["6063458646"], 1);
    assert.equal(result.ok, true);
    assert.equal(result.items[0].externalId, "456");
    assert.equal(result.items[0].content, "桌面微博");
    assert.equal(result.items[0].url, "https://weibo.com/6063458646/QrSt");
  } finally { restore(); }
});

test("expands long posts and keeps original-resolution images", async () => {
  const feed = {
    ok: 1,
    data: { list: [{
      idstr: "789", mblogid: "LongId", isLongText: true, text_raw: "截断…展开",
      created_at: "2026-07-22T10:00:00Z", user: { screen_name: "长文用户" },
      pic_ids: ["pic-a"], pic_infos: { "pic-a": { largest: { url: "http://wx1.sinaimg.cn/large/a.jpg" } } }
    }] }
  };
  const restore = installPageGlobals((url) => url.includes("/ajax/statuses/show")
    ? { ok: 1, idstr: "789", text_raw: "这是没有被截断的完整长微博正文" }
    : feed, "weibo.com");
  try {
    const result = await fetchWeiboDesktopInPage(["6063458646"], 1);
    assert.equal(result.ok, true);
    assert.equal(result.items[0].content, "这是没有被截断的完整长微博正文");
    assert.deepEqual(result.items[0].images, [{ url: "https://wx1.sinaimg.cn/large/a.jpg", caption: "微博配图 1" }]);
  } finally { restore(); }
});

function installPageGlobals(payload, hostname = "m.weibo.cn") {
  const previous = { location: globalThis.location, document: globalThis.document, fetch: globalThis.fetch };
  globalThis.location = { hostname };
  globalThis.document = { createElement: () => ({ set innerHTML(value) { this.textContent = value; }, textContent: "" }) };
  globalThis.fetch = async (url) => {
    const value = typeof payload === "function" ? payload(String(url)) : payload;
    return { ok: true, status: 200, json: async () => value, text: async () => JSON.stringify(value) };
  };
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  };
}
