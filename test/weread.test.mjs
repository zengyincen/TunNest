import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fetchWereadInPage } from "../extension/lib/sources.js";
import { getWereadItems } from "../automation/sources/weread.mjs";

const background = readFileSync(new URL("../extension/background.js", import.meta.url), "utf8");
const options = readFileSync(new URL("../extension/options.html", import.meta.url), "utf8");
const optionsClient = readFileSync(new URL("../extension/options.js", import.meta.url), "utf8");

test("reads WeRead notes inside the logged-in first-party page", async () => {
  const runInPage = Function(`return (${fetchWereadInPage.toString()})`)();
  const previous = { location: globalThis.location, fetch: globalThis.fetch };
  globalThis.location = { hostname: "weread.qq.com" };
  globalThis.fetch = async (url) => {
    const value = String(url);
    let data = {};
    if (value.includes("/api/user/notebook")) data = { books: [{ book: { bookId: "book-1", title: "测试书", author: "作者", cover: "http://cdn.weread.qq.com/cover/book-1.jpg" } }] };
    else if (value.includes("bookmarklist")) data = { updated: [{ bookmarkId: "mark-1", chapterUid: 2, markText: "一条划线" }] };
    else if (value.includes("review/list")) data = { reviews: [{ review: { reviewId: "note-1", chapterUid: 2, type: 1, content: "一条笔记" } }] };
    else if (value.includes("chapterInfos")) data = { data: [{ updated: [{ chapterUid: 2, title: "第一章" }] }] };
    return { ok: true, status: 200, json: async () => data };
  };
  try {
    const result = await runInPage();
    assert.equal(result.ok, true);
    assert.equal(result.items[0].title, "测试书");
    assert.equal(result.items[0].highlights.length, 2);
    assert.equal(result.items[0].highlights[0].chapter, "第一章");
    assert.equal(result.items[0].coverUrl, "http://cdn.weread.qq.com/cover/book-1.jpg");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

test("offers browser-login and optional Gateway configuration", () => {
  assert.match(options, /id="wereadApiKey"/);
  assert.match(options, /id="openWeread"/);
  assert.match(optionsClient, /wereadApiKey/);
  assert.match(background, /fetchWereadFromLoggedInTab/);
  assert.match(background, /settings\.wereadApiKey \? await fetchWeread/);
});

test("retries a WeRead Gateway rate limit before failing the book", async () => {
  let calls = 0;
  const fetchImpl = async (_url, init) => {
    calls++;
    const body = JSON.parse(init.body);
    if (body.api_name === "/book/chapterinfo" && calls === 4) {
      return { ok: false, status: 429, headers: { get: () => "0" }, json: async () => ({ errmsg: "请求频率超限，请稍后再试" }) };
    }
    const data = body.api_name === "/user/notebooks"
      ? { books: [{ book: { bookId: "book-1", title: "测试书" } }] }
      : body.api_name === "/book/bookmarklist"
        ? { updated: [] }
        : body.api_name === "/review/list/mine"
          ? { reviews: [], hasMore: false }
          : { chapters: [] };
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => data };
  };
  const items = await getWereadItems("key", { fetchImpl, retryDelayMs: 0, minIntervalMs: 0 });
  assert.equal(items[0].externalId, "book-1");
  assert.equal(calls, 5);
});

test("does not retry a permanent WeRead authentication error", async () => {
  let calls = 0;
  await assert.rejects(
    getWereadItems("key", {
      fetchImpl: async () => {
        calls++;
        return { ok: false, status: 401, headers: { get: () => null }, json: async () => ({ errmsg: "用户不存在" }) };
      },
      retryDelayMs: 0,
      minIntervalMs: 0
    }),
    /用户不存在/
  );
  assert.equal(calls, 1);
});
