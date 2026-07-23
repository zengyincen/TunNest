import assert from "node:assert/strict";
import test from "node:test";
import { extractCurrentPage } from "../extension/lib/sources.js";

test("extracts meaningful webpage images, video and audio without duplicates", () => {
  const previous = {
    document: Object.getOwnPropertyDescriptor(globalThis, "document"),
    window: Object.getOwnPropertyDescriptor(globalThis, "window"),
    location: Object.getOwnPropertyDescriptor(globalThis, "location")
  };
  const element = (values = {}) => ({
    id: "", className: "", width: 0, height: 0, clientWidth: 0, clientHeight: 0,
    getAttribute(name) { return values[name] || ""; },
    closest() { return null; },
    querySelectorAll() { return []; },
    ...values
  });
  const hero = element({ src: "https://cdn.example.com/hero.jpg", currentSrc: "https://cdn.example.com/hero.jpg", naturalWidth: 1200, naturalHeight: 800, alt: "", getAttribute(name) { return name === "alt" ? "头图" : ""; } });
  const photo = element({ src: "https://cdn.example.com/photo.webp", currentSrc: "https://cdn.example.com/photo.webp", naturalWidth: 900, naturalHeight: 600, getAttribute(name) { return name === "alt" ? "现场照片" : ""; } });
  const icon = element({ src: "https://cdn.example.com/icon.png", currentSrc: "https://cdn.example.com/icon.png", naturalWidth: 32, naturalHeight: 32, className: "site-icon" });
  const dataImage = element({ src: "data:image/png;base64,AAAA", currentSrc: "data:image/png;base64,AAAA", naturalWidth: 800, naturalHeight: 600 });
  const video = element({
    src: "https://cdn.example.com/movie.mp4", currentSrc: "https://cdn.example.com/movie.mp4", poster: "https://cdn.example.com/poster.jpg",
    getAttribute(name) { return name === "title" ? "访谈视频" : ""; },
    querySelectorAll() { return [element({ src: "https://cdn.example.com/movie.mp4" })]; }
  });
  const audio = element({
    src: "https://cdn.example.com/podcast.mp3", currentSrc: "https://cdn.example.com/podcast.mp3",
    getAttribute(name) { return name === "title" ? "播客音频" : ""; },
    querySelectorAll() { return []; }
  });
  const root = {
    innerText: "网页正文",
    querySelectorAll(selector) {
      return ({ img: [hero, photo, icon, dataImage], video: [video], audio: [audio] })[selector] || [];
    }
  };
  const metadata = {
    'link[rel="canonical"]': { href: "https://example.com/article" },
    'meta[property="og:title"]': element({ getAttribute: () => "测试文章" }),
    'meta[property="og:image"]': element({ getAttribute: () => "https://cdn.example.com/hero.jpg" })
  };
  const document = {
    title: "测试文章",
    body: root,
    querySelector(selector) {
      if (selector === "article, main, [role=main], #link-report, .WB_detail") return root;
      return metadata[selector] || null;
    }
  };
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: document },
    window: { configurable: true, value: { getSelection: () => ({ toString: () => "" }) } },
    location: { configurable: true, value: { href: "https://example.com/article", hostname: "example.com" } }
  });
  try {
    const result = extractCurrentPage();
    assert.deepEqual(result.media.map(({ type, url }) => ({ type, url })), [
      { type: "image", url: "https://cdn.example.com/hero.jpg" },
      { type: "image", url: "https://cdn.example.com/photo.webp" },
      { type: "image", url: "https://cdn.example.com/poster.jpg" },
      { type: "video", url: "https://cdn.example.com/movie.mp4" },
      { type: "audio", url: "https://cdn.example.com/podcast.mp3" }
    ]);
    assert.equal(result.media.some(({ url }) => /icon|data:/.test(url)), false);
  } finally {
    for (const [name, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
