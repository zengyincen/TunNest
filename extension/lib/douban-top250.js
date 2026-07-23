export const DOUBAN_TOP250_TARGETS = [
  { source: "doubanMovieTop250", kind: "movie", label: "电影", origin: "https://movie.douban.com" },
  { source: "doubanBookTop250", kind: "book", label: "图书", origin: "https://book.douban.com" },
  { source: "doubanMusicTop250", kind: "music", label: "音乐", origin: "https://music.douban.com" }
];

export async function fetchAllDoubanTop250(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const capturedAt = new Date().toISOString();
  const result = {};
  for (const target of DOUBAN_TOP250_TARGETS) {
    const items = [];
    for (let start = 0; start < 250; start += 25) {
      if (options.signal?.aborted) throw new Error("同步已停止");
      const url = target.origin + "/top250?start=" + start;
      await options.onProgress?.({ source: target.source, label: target.label, start, completedPages: start / 25, totalPages: 10 });
      const response = await fetchImpl(url, {
        credentials: "omit",
        cache: "no-store",
        signal: options.signal,
        headers: { Accept: "text/html,application/xhtml+xml", ...(options.headers || {}) }
      });
      const html = await response.text();
      if (!response.ok) throw new Error("豆瓣" + target.label + " Top 250 请求失败 (" + response.status + ")");
      const pageItems = parseDoubanTop250(html, target.kind, start, capturedAt);
      if (pageItems.length < 20) throw new Error("豆瓣" + target.label + " Top 250 第 " + (start / 25 + 1) + " 页只读取到 " + pageItems.length + " 条，页面结构可能变化或触发风控");
      items.push(...pageItems);
      if (start < 225) await pause(options.delayMs ?? 450, options.signal);
    }
    const unique = [...new Map(items.map((item) => [item.externalId, item])).values()];
    if (unique.length < 240) throw new Error("豆瓣" + target.label + " Top 250 去重后只读取到 " + unique.length + " 条，页面结构可能变化或触发风控");
    result[target.source] = unique;
  }
  return result;
}

export function parseDoubanTop250(html, kind, start = 0, capturedAt = new Date().toISOString()) {
  const source = sourceForKind(kind);
  const blocks = kind === "movie" ? movieBlocks(html) : tableBlocks(html);
  return blocks.map((block, index) => parseEntry(block, kind, source, start + index + 1, capturedAt)).filter(Boolean);
}

function parseEntry(block, kind, source, fallbackRank, capturedAt) {
  const url = match(block, /href\s*=\s*["'](https:\/\/(?:movie|book|music)\.douban\.com\/subject\/\d+\/?)["']/i);
  const externalId = match(url, /\/subject\/(\d+)/i);
  if (!url || !externalId) return null;
  const imageTag = match(block, /(<img\b[^>]*>)/i);
  const coverUrl = normalizeCover(attribute(imageTag, "src"));
  const title = kind === "movie" ? attribute(imageTag, "alt") : listTitle(block);
  if (!title) return null;
  const indexedRank = Number(match(block, /moreurl\(this,\{i:["'](\d+)["']/i)) + 1;
  const rank = kind === "movie" ? Number(match(block, /<em\b[^>]*>\s*(\d+)\s*<\/em>/i) || fallbackRank) : indexedRank > fallbackRank - 1 ? indexedRank : fallbackRank;
  const rating = Number(match(block, /class\s*=\s*["'][^"']*rating_num(?:s)?[^"']*["'][^>]*>\s*([\d.]+)/i)) || null;
  const ratingCount = Number(String(match(block, /([\d,]+)\s*人评价/i) || "").replace(/,/g, "")) || null;
  const info = cleanText(match(block, /<p\b[^>]*class\s*=\s*["'][^"']*pl[^"']*["'][^>]*>([\s\S]*?)<\/p>/i) || movieInfo(block));
  const quote = cleanText(match(block, /<p\b[^>]*class\s*=\s*["'][^"']*quote[^"']*["'][^>]*>([\s\S]*?)<\/p>/i) || match(block, /<span\b[^>]*class\s*=\s*["'][^"']*inq[^"']*["'][^>]*>([\s\S]*?)<\/span>/i));
  const details = top250Details(info, kind);
  const label = ({ movie: "电影", book: "图书", music: "音乐" })[kind];
  return {
    source,
    kind,
    externalId,
    title: cleanText(title),
    author: details.director || details.author || details.artist || "",
    url,
    excerpt: quote || info,
    content: [info, quote].filter(Boolean).join("\n\n"),
    coverUrl,
    tags: ["豆瓣", label + " Top 250"],
    highlights: [],
    capturedAt,
    metadata: { rank, rating, ratingCount, info, quote, ...details }
  };
}

function top250Details(info, kind) {
  const parts = String(info || "").split(" / ").map((part) => part.trim()).filter(Boolean);
  if (kind === "movie") {
    const yearIndex = parts.findIndex((part) => /^\d{4}(?:\b|\()/i.test(part));
    const credits = (yearIndex < 0 ? parts : parts.slice(0, yearIndex)).join(" / ");
    const timeline = yearIndex < 0 ? [] : parts.slice(yearIndex);
    let yearCount = 0;
    while (yearCount < timeline.length && /^\d{4}(?:\b|\()/i.test(timeline[yearCount])) yearCount++;
    return {
      director: cleanText(match(credits, /导演:\s*([\s\S]*?)(?:\s+主演:|$)/i)),
      cast: cleanText(match(credits, /主演:\s*([\s\S]*)$/i)).replace(/\s*\/\.\.\.$/, ""),
      years: timeline.slice(0, yearCount).join(" / "),
      region: timeline[yearCount] || "",
      genres: timeline.slice(yearCount + 1).join(" / ").split(/\s+/).filter(Boolean)
    };
  }
  if (kind === "book") {
    const publicationIndex = parts.findLastIndex((part) => /(?:^|\D)\d{4}(?:\D|$)/.test(part));
    const publisherIndex = publicationIndex > 0 ? publicationIndex - 1 : -1;
    return {
      author: publisherIndex > 0 ? parts[0] || "" : "",
      translators: publisherIndex > 1 ? parts.slice(1, publisherIndex).join(" / ") : "",
      publisher: publisherIndex >= 0 ? parts[publisherIndex] : parts[0] || "",
      publicationDate: publicationIndex >= 0 ? parts[publicationIndex] : "",
      price: publicationIndex >= 0 ? parts.slice(publicationIndex + 1).join(" / ") : ""
    };
  }
  return {
    artist: parts[0] || "",
    releaseDate: parts[1] || "",
    releaseType: parts.length > 4 ? parts.slice(2, -2).join(" / ") : "",
    medium: parts.length >= 4 ? parts.at(-2) : "",
    genres: parts.length >= 3 ? String(parts.at(-1) || "").split(/\s*\/\s*/).filter(Boolean) : []
  };
}

function movieBlocks(html) {
  const body = match(html, /<ol\b[^>]*class\s*=\s*["'][^"']*grid_view[^"']*["'][^>]*>([\s\S]*?)<\/ol>/i) || "";
  return [...body.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((value) => value[1]);
}

function tableBlocks(html) {
  return [...String(html).matchAll(/<tr\b[^>]*class\s*=\s*["'][^"']*\bitem\b[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi)].map((value) => value[1]);
}

function listTitle(block) {
  const section = match(block, /<div\b[^>]*class\s*=\s*["'][^"']*pl2[^"']*["'][^>]*>([\s\S]*?)(?:<p\b|<div\b[^>]*class\s*=\s*["'][^"']*star)/i) || block;
  const anchor = match(section, /(<a\b[^>]*>[\s\S]*?<\/a>)/i);
  return attribute(anchor, "title") || cleanText(match(anchor, /<a\b[^>]*>([\s\S]*?)<\/a>/i));
}

function movieInfo(block) {
  const body = match(block, /<div\b[^>]*class\s*=\s*["'][^"']*bd[^"']*["'][^>]*>([\s\S]*?)<div\b/i) || "";
  return match(body, /<p\b[^>]*>([\s\S]*?)<\/p>/i);
}

function cleanText(value) {
  return decodeHtml(String(value || "").replace(/<br\s*\/?\s*>/gi, "\u0000").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .replace(/\s*\u0000\s*/g, " / ")
    .trim();
}

function decodeHtml(value) {
  const named = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
  return String(value).replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (all, entity) => {
    if (entity[0] !== "#") return named[entity.toLowerCase()] || all;
    const number = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return Number.isFinite(number) ? String.fromCodePoint(number) : all;
  });
}

function attribute(tag, name) {
  if (!tag) return "";
  const value = String(tag).match(new RegExp(name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')", "i"));
  return decodeHtml(value?.[1] ?? value?.[2] ?? "").trim();
}

function normalizeCover(value) {
  return String(value || "").replace(/^http:/i, "https:").replace("/s/public/", "/l/public/");
}

function sourceForKind(kind) {
  const source = ({ movie: "doubanMovieTop250", book: "doubanBookTop250", music: "doubanMusicTop250" })[kind];
  if (!source) throw new Error("不支持的豆瓣 Top 250 类型：" + kind);
  return source;
}

function match(value, pattern) { return String(value || "").match(pattern)?.[1] || ""; }

function pause(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => { clearTimeout(timeout); reject(new Error("同步已停止")); }, { once: true });
  });
}
