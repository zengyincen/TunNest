import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDouban, normalizeDoubanUserId, signedDoubanUrl } from "../automation/sources/douban.mjs";

test("normalizes a Douban book interest", () => {
  const item = normalizeDouban({ status: "done", create_time: "2026-07-01T12:00:00+08:00", comment: "值得重读", rating: { value: 5 }, tags: [{ name: "社会学" }], subject: { id: "42", title: "测试书", url: "https://book.douban.com/subject/42/", author: ["某作者"], intro: "简介", genres: ["非虚构"] } }, "book");
  assert.equal(item.externalId, "42");
  assert.equal(item.kind, "book");
  assert.equal(item.highlights[0].text, "值得重读");
  assert.deepEqual(item.tags, ["豆瓣", "社会学", "非虚构"]);
});

test("signs current Frodo requests", () => {
  const url = signedDoubanUrl("frodo.douban.com", "/api/v2/user/ahbei/interests", { type: "book", status: "done", start: "0", count: "1" }, "1784779200");
  assert.equal(url.searchParams.get("_ts"), "1784779200");
  assert.equal(url.searchParams.get("os_rom"), "android");
  assert.equal(url.searchParams.get("_sig"), "BswcjvWC1otpKDkc58TEed+WcvU=");
});

test("accepts a full Douban profile URL", () => {
  assert.equal(normalizeDoubanUserId("https://www.douban.com/people/example.name/"), "example.name");
});
