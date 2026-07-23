import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fetchWereadInPage } from "../extension/lib/sources.js";

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
