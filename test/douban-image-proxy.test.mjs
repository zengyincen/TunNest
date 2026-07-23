import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const worker=readFileSync(new URL("../license-worker/src/index.ts",import.meta.url),"utf8");

test("serves cached Douban images through the Cloudflare worker",()=>{
  assert.match(worker,/path === "\/v1\/images\/douban"/);
  assert.match(worker,/\(\^\|\\\.\)doubanio\\\.com\$/);
  assert.match(worker,/caches\.default/);
  assert.match(worker,/ctx\.waitUntil\(cache\.put/);
  assert.match(worker,/new Response\(upstream\.body/);
  assert.match(worker,/Referer: "https:\/\/www\.douban\.com\/"/);
});
