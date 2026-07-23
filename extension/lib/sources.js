export async function fetchWeread(apiKey) {
  if (!apiKey) throw new Error("请先填写微信读书 Gateway API Key，或改用浏览器登录方式");
  const client = async (apiName, params = {}) => {
    const data = await requestJson("https://i.weread.qq.com/api/agent/gateway", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ api_name: apiName, skill_version: "1.0.4", ...params })
    });
    if (data.errcode) throw new Error(data.errmsg || `微信读书 Gateway 失败：${apiName}`);
    if (data.upgrade_info) throw new Error(`微信读书 Gateway 需要升级：${data.upgrade_info}`);
    return data;
  };
  const books = [], notebook = await client("/user/notebooks", { count: 100 });
  books.push(...(notebook.books || []));
  let lastSort = books.at(-1)?.sort, hasMore = Boolean(notebook.hasMore);
  while (hasMore && lastSort !== undefined) {
    const next = await client("/user/notebooks", { count: 100, lastSort });
    const batch = next.books || [];
    books.push(...batch);
    hasMore = Boolean(next.hasMore);
    if (!hasMore || !batch.length) break;
    lastSort = batch.at(-1)?.sort;
  }
  if (!books.length) throw new Error("微信读书没有返回笔记本内容");
  const items = [];
  for (const entry of books) {
    const book = entry.book || entry;
    const bookId = String(book.bookId);
    const [marks, reviews, chaptersData] = await Promise.all([
      client("/book/bookmarklist", { bookId }),
      client("/review/list", { bookId, listType: 11, mine: 1, syncKey: 0 }),
      client("/book/chapterinfo", { bookId })
    ]);
    const chapterList = chaptersData.chapters || chaptersData.updated || [];
    const chapters = Object.fromEntries(chapterList.map((chapter) => [String(chapter.chapterUid), chapter.title || chapter.chapterTitle || ""]));
    const bookmarks = marks.updated || marks.bookmarks || [];
    const notes = (reviews.reviews || []).map((entry) => entry.review || entry);
    const highlights = [
      ...bookmarks.map((mark, index) => ({ externalId: String(mark.bookmarkId || `mark-${index}`), text: mark.markText || mark.text || "", chapter: chapters[String(mark.chapterUid)] || "", position: index })),
      ...notes.map((note, index) => ({ externalId: String(note.reviewId || `note-${index}`), text: note.abstract || note.content || note.review || "", note: note.type === 1 ? note.content : "", chapter: chapters[String(note.chapterUid)] || "", position: bookmarks.length + index }))
    ].filter((item) => item.text);
    items.push({ source: "weread", kind: "book", externalId: bookId, title: book.title || book.bookName || "未命名书籍", author: book.author || "", url: `https://weread.qq.com/web/bookDetail/${bookId}`, excerpt: `${highlights.length} 条划线与笔记`, tags: ["微信读书"], coverUrl: book.cover || book.coverUrl, highlights, capturedAt: new Date().toISOString() });
  }
  return items;
}

// Runs in the MAIN world of weread.qq.com so the requests stay first-party and
// use the user's current login without exporting cookies from the browser.
export async function fetchWereadInPage() {
  const fail = (message, status) => ({ ok: false, error: message, status });
  const request = async (path, init = {}) => {
    const response = await fetch(path, {
      credentials: "include",
      cache: "no-store",
      ...init,
      headers: { Accept: "application/json", "Content-Type": "application/json", ...(init.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    const code = data.errCode ?? data.errcode;
    if (response.status === 401 || code === -2012) {
      const error = new Error("微信读书登录已过期，请在打开的页面重新登录后再试");
      error.status = response.status || code;
      throw error;
    }
    if (!response.ok || (code !== undefined && code !== 0)) {
      const error = new Error(data.errmsg || data.msg || `微信读书请求失败 (${response.status})`);
      error.status = response.status || code;
      throw error;
    }
    return data;
  };

  if (location.hostname !== "weread.qq.com") return fail("同步必须在 weread.qq.com 页面中运行");
  try {
    const notebook = await request("/api/user/notebook");
    const books = (notebook.books || notebook.bookList || notebook.updated || []).map((entry) => entry.book || entry).filter((book) => book.bookId);
    if (!books.length) return fail("没有读取到微信读书笔记，请确认当前账号已有划线或笔记", "EMPTY");
    const items = [];
    for (const book of books) {
      const bookId = String(book.bookId);
      const [marks, reviews, chaptersData] = await Promise.all([
        request(`/web/book/bookmarklist?bookId=${encodeURIComponent(bookId)}`),
        request(`/web/review/list?bookId=${encodeURIComponent(bookId)}&listType=11&mine=1&syncKey=0`),
        request("/web/book/chapterInfos", { method: "POST", body: JSON.stringify({ bookIds: [bookId], synckeys: [0], teenmode: 0 }) })
      ]);
      const chapterList = chaptersData.data?.[0]?.updated || chaptersData.data?.[0]?.chapters || chaptersData.data || chaptersData.updated || chaptersData.chapters || [];
      const chapters = Object.fromEntries((Array.isArray(chapterList) ? chapterList : []).map((chapter) => [String(chapter.chapterUid), chapter.title || chapter.chapterTitle || ""]));
      const bookmarks = marks.updated || marks.bookmarks || [];
      const notes = (reviews.reviews || []).map((entry) => entry.review || entry);
      const highlights = [
        ...bookmarks.map((mark, index) => ({ externalId: String(mark.bookmarkId || `mark-${index}`), text: mark.markText || mark.text || "", chapter: chapters[String(mark.chapterUid)] || "", position: index })),
        ...notes.map((note, index) => ({ externalId: String(note.reviewId || `note-${index}`), text: note.abstract || note.content || note.review || "", note: note.type === 1 ? note.content : "", chapter: chapters[String(note.chapterUid)] || "", position: bookmarks.length + index }))
      ].filter((item) => item.text);
      items.push({ source: "weread", kind: "book", externalId: bookId, title: book.title || book.bookName || "未命名书籍", author: book.author || "", url: `https://weread.qq.com/web/bookDetail/${bookId}`, excerpt: `${highlights.length} 条划线与笔记`, tags: ["微信读书"], coverUrl: book.cover || book.coverUrl, highlights, capturedAt: new Date().toISOString() });
    }
    return { ok: true, items };
  } catch (error) {
    return fail(error?.message || String(error), error?.status);
  }
}

export async function fetchDouban(settings) {
  if (!settings.doubanUserId) throw new Error("请先在设置中填写豆瓣用户 ID");
  const userId = normalizeDoubanUserId(settings.doubanUserId);
  const statuses = ["mark", "doing", "done"], types = ["book", "movie"], items = [];
  for (const type of types) for (const status of statuses) {
    for (let start = 0; start < 1000; start += 50) {
      const path = `/api/v2/user/${encodeURIComponent(userId)}/interests`;
      const url = await signedDoubanUrl(path, { type, status, start: String(start), count: "50" });
      const data = await requestJson(url, { headers: settings.doubanAuthToken ? { Authorization: `Bearer ${settings.doubanAuthToken}` } : {} });
      const interests = data.interests || [];
      for (const interest of interests) items.push(doubanItem(interest, type));
      if (!interests.length || start + interests.length >= Number(data.total || interests.length)) break;
    }
  }
  return unique(items);
}

const DOUBAN_API_KEY = "0dad551ec0f84ed02907ff5c42e8ec70";
const DOUBAN_HMAC_SECRET = "bf7dddc7c9cfe6f7";
let doubanSigningKey;

async function signedDoubanUrl(path, params) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const payload = `GET&${encodeURIComponent(path)}&${timestamp}`;
  doubanSigningKey ||= crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(DOUBAN_HMAC_SECRET),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", await doubanSigningKey, new TextEncoder().encode(payload));
  const base64 = bytesToBase64(new Uint8Array(signature));
  const url = new URL(`https://frodo.douban.com${path}`);
  url.search = new URLSearchParams({ ...params, apiKey: DOUBAN_API_KEY, _ts: timestamp, _sig: base64, os_rom: "android" }).toString();
  return url.toString();
}

function normalizeDoubanUserId(value) {
  const match = String(value || "").trim().match(/douban\.com\/people\/([^/?#]+)/i);
  const userId = decodeURIComponent(match?.[1] || String(value || "").trim());
  if (!/^[A-Za-z0-9._-]+$/.test(userId)) throw new Error("豆瓣用户 ID 格式不正确，请填写个人主页 /people/ 后面的 ID");
  return userId;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

// This function is injected into the MAIN world of an open m.weibo.cn tab.
// Keep every helper inside the function: chrome.scripting serializes only this function body.
export async function fetchWeiboInPage(uids, requestedPages) {
  const cleanText = (html) => {
    const element = document.createElement("div");
    element.innerHTML = String(html || "").replace(/<br\s*\/?\s*>/gi, "\n");
    return (element.textContent || "").replace(/\u00a0/g, " ").trim();
  };
  const isoDate = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  };
  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const fail = (message, status) => ({ ok: false, error: message, status });
  const imageUrls = (status, prefix = "微博配图") => {
    const candidates = [];
    for (const pic of (status?.pics || [])) candidates.push(pic?.largest?.url || pic?.large?.url || pic?.original?.url || pic?.url);
    for (const id of (status?.pic_ids || [])) {
      const pic = status?.pic_infos?.[id];
      candidates.push(pic?.largest?.url || pic?.large?.url || pic?.original?.url || pic?.url);
    }
    for (const media of (status?.mix_media_info?.items || [])) if (media?.type === "pic") {
      const pic = media.data || {};
      candidates.push(pic?.largest?.url || pic?.large?.url || pic?.original?.url || pic?.url);
    }
    return [...new Set(candidates.filter(Boolean).map((url) => String(url).replace(/^http:/, "https:").replace(/^\/\//, "https://")))]
      .map((url, index) => ({ url, caption: `${prefix} ${index + 1}` }));
  };
  const expandedText = async (status) => {
    const preview = cleanText(status?.text_raw || status?.text);
    const needsFullText = Boolean(status?.isLongText || status?.continue_tag || /(?:\.\.\.|…)?展开\s*$/.test(preview));
    if (!needsFullText) return preview;
    const id = status?.idstr || status?.id || status?.mid;
    const response = await fetch(`/statuses/extend?id=${encodeURIComponent(id)}`, {
      credentials: "include", cache: "no-store", headers: { Accept: "application/json, text/plain, */*", "MWeibo-Pwa": "1", "X-Requested-With": "XMLHttpRequest" }
    });
    const data = await response.json().catch(() => ({}));
    const fullText = cleanText(data.data?.longTextContent || data.longTextContent);
    if (!response.ok || data.ok !== 1 || !fullText) throw new Error(`长微博 ${id} 全文读取失败 (${response.status})`);
    await wait(700 + Math.floor(Math.random() * 500));
    return fullText;
  };

  if (location.hostname !== "m.weibo.cn") return fail("同步必须在 m.weibo.cn 页面中运行");
  const pages = Math.max(1, Math.min(Number(requestedPages) || 2, 10));
  const items = [];

  try {
    for (const rawUid of uids) {
      const uid = String(rawUid).trim();
      if (!/^\d+$/.test(uid)) return fail(`微博 UID 格式不正确：${uid}`);
      let containerId = `107603${uid}`;
      const profileQuery = new URLSearchParams({ type: "uid", value: uid });
      const profileResponse = await fetch(`/api/container/getIndex?${profileQuery}`, {
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json, text/plain, */*", "MWeibo-Pwa": "1", "X-Requested-With": "XMLHttpRequest" }
      });
      const profile = await profileResponse.json().catch(() => ({}));
      const weiboTab = (profile.data?.tabsInfo?.tabs || []).find((tab) => tab.tab_type === "weibo" || tab.title === "微博");
      if (weiboTab?.containerid) containerId = String(weiboTab.containerid);
      for (let page = 1; page <= pages; page++) {
        const query = new URLSearchParams({ type: "uid", value: uid, containerid: containerId, page: String(page) });
        const response = await fetch(`/api/container/getIndex?${query}`, {
          credentials: "include",
          cache: "no-store",
          headers: { Accept: "application/json, text/plain, */*", "MWeibo-Pwa": "1", "X-Requested-With": "XMLHttpRequest" }
        });
        const raw = await response.text();
        let data = {};
        try { data = JSON.parse(raw); } catch { /* A challenge page is not JSON. */ }
        if (!response.ok) {
          const detail = data.msg || data.errmsg || data.error || "微博拒绝了请求";
          return fail(`微博 ${uid} 请求失败 (${response.status})：${detail}`, response.status);
        }
        if (data.ok !== 1) {
          const detail = data.msg || data.errmsg || data.error || (typeof data.data === "string" ? data.data : "未提供原因");
          return fail(`微博 ${uid} 返回异常：${detail}`, data.errno || data.error_code);
        }
        const posts = (data.data?.cards || []).map((card) => card.mblog).filter(Boolean);
        for (const post of posts) {
          const ownText = await expandedText(post);
          const retweeted = post.retweeted_status;
          const retweetedText = retweeted ? await expandedText(retweeted) : "";
          const text = retweetedText ? `${ownText}\n\n—— 转发自 @${retweeted.user?.screen_name || "原作者"} ——\n${retweetedText}` : ownText;
          const images = [...imageUrls(post), ...(retweeted ? imageUrls(retweeted, "转发微博配图") : [])];
          items.push({
            source: "weibo",
            kind: "post",
            externalId: String(post.id || post.mid),
            title: `${post.user?.screen_name || uid}：${ownText.slice(0, 42)}`,
            author: post.user?.screen_name || uid,
            url: `https://weibo.com/${uid}/${post.bid || post.id}`,
            excerpt: text.slice(0, 400),
            content: text,
            images,
            tags: ["微博"],
            capturedAt: isoDate(post.created_at),
            metadata: { reposts: post.reposts_count, comments: post.comments_count, attitudes: post.attitudes_count }
          });
        }
        if (!posts.length) break;
        if (page < pages) await wait(2200 + Math.floor(Math.random() * 800));
      }
    }
    return { ok: true, items: [...new Map(items.map((item) => [`${item.source}:${item.externalId}`, item])).values()] };
  } catch (error) {
    return fail(`微博页面请求失败：${error?.message || String(error)}`);
  }
}

// The desktop endpoint is the primary adapter because the old mobile container
// endpoint increasingly returns a misleading `这里还没有内容` risk-control response.
export async function fetchWeiboDesktopInPage(uids, requestedPages) {
  const cleanText = (html) => {
    const element = document.createElement("div");
    element.innerHTML = String(html || "").replace(/<br\s*\/?\s*>/gi, "\n");
    return (element.textContent || "").replace(/\u00a0|\u200b/g, " ").trim();
  };
  const isoDate = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  };
  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const fail = (message, status) => ({ ok: false, error: message, status });
  const imageUrls = (status, prefix = "微博配图") => {
    const candidates = [];
    for (const pic of (status?.pics || [])) candidates.push(pic?.largest?.url || pic?.large?.url || pic?.original?.url || pic?.url);
    for (const id of (status?.pic_ids || [])) {
      const pic = status?.pic_infos?.[id];
      candidates.push(pic?.largest?.url || pic?.large?.url || pic?.original?.url || pic?.url);
    }
    for (const media of (status?.mix_media_info?.items || [])) if (media?.type === "pic") {
      const pic = media.data || {};
      candidates.push(pic?.largest?.url || pic?.large?.url || pic?.original?.url || pic?.url);
    }
    return [...new Set(candidates.filter(Boolean).map((url) => String(url).replace(/^http:/, "https:").replace(/^\/\//, "https://")))]
      .map((url, index) => ({ url, caption: `${prefix} ${index + 1}` }));
  };
  const expandedStatus = async (status) => {
    const preview = status?.text_raw || cleanText(status?.text);
    const needsFullText = Boolean(status?.isLongText || status?.continue_tag || /(?:\.\.\.|…)?展开\s*$/.test(preview));
    if (!needsFullText) return { status, text: preview };
    const numericId = status?.idstr || status?.id || status?.mid;
    const blogId = status?.mblogid || status?.bid || numericId;
    const showResponse = await fetch(`/ajax/statuses/show?id=${encodeURIComponent(numericId)}&isGetLongText=true`, {
      credentials: "include", cache: "no-store", headers: { Accept: "application/json, text/plain, */*", "X-Requested-With": "XMLHttpRequest" }
    });
    const showData = await showResponse.json().catch(() => ({}));
    const shown = showData.data || showData;
    let fullText = shown.text_raw || cleanText(shown.text);
    let fullStatus = showResponse.ok && showData.ok ? { ...status, ...shown } : status;
    if (!fullText || /(?:\.\.\.|…)?展开\s*$/.test(fullText)) {
      const longResponse = await fetch(`/ajax/statuses/longtext?id=${encodeURIComponent(blogId)}`, {
        credentials: "include", cache: "no-store", headers: { Accept: "application/json, text/plain, */*", "X-Requested-With": "XMLHttpRequest" }
      });
      const longData = await longResponse.json().catch(() => ({}));
      fullText = cleanText(longData.data?.longTextContent || longData.longTextContent);
    }
    if (!fullText || /(?:\.\.\.|…)?展开\s*$/.test(fullText)) throw new Error(`长微博 ${numericId} 全文读取失败`);
    await wait(700 + Math.floor(Math.random() * 500));
    return { status: fullStatus, text: cleanText(fullText) };
  };

  if (!/(^|\.)weibo\.com$/.test(location.hostname)) return fail("同步必须在 weibo.com 页面中运行");
  const pages = Math.max(1, Math.min(Number(requestedPages) || 2, 10));
  const items = [];

  try {
    for (const rawUid of uids) {
      const uid = String(rawUid).trim();
      if (!/^\d+$/.test(uid)) return fail(`微博 UID 格式不正确：${uid}`);
      let sinceId = "";
      for (let page = 1; page <= pages; page++) {
        const query = new URLSearchParams({ uid, page: String(page), feature: "0" });
        if (sinceId) query.set("since_id", sinceId);
        const response = await fetch(`/ajax/statuses/mymblog?${query}`, {
          credentials: "include",
          cache: "no-store",
          headers: { Accept: "application/json, text/plain, */*", "X-Requested-With": "XMLHttpRequest" }
        });
        const raw = await response.text();
        let data = {};
        try { data = JSON.parse(raw); } catch { /* A login or challenge page is not JSON. */ }
        if (!response.ok) {
          const detail = data.msg || data.errmsg || data.error || "微博拒绝了请求";
          return fail(`微博 ${uid} 桌面接口失败 (${response.status})：${detail}`, response.status);
        }
        if (!data.ok) {
          const detail = data.msg || data.errmsg || data.error || "登录状态无效或账号不可访问";
          return fail(`微博 ${uid} 桌面接口返回异常：${detail}`, data.errno || data.error_code);
        }
        const posts = data.data?.list || [];
        if (page === 1 && !posts.length) return fail(`微博 ${uid} 没有返回博文，请确认 UID 正确且该主页可访问`, "EMPTY");
        for (const post of posts) {
          const expanded = await expandedStatus(post);
          const retweeted = expanded.status.retweeted_status || post.retweeted_status;
          const expandedRetweet = retweeted ? await expandedStatus(retweeted) : null;
          const ownText = expanded.text;
          const text = expandedRetweet ? `${ownText}\n\n—— 转发自 @${expandedRetweet.status.user?.screen_name || "原作者"} ——\n${expandedRetweet.text}` : ownText;
          const images = [...imageUrls(expanded.status), ...(expandedRetweet ? imageUrls(expandedRetweet.status, "转发微博配图") : [])];
          items.push({
            source: "weibo",
            kind: "post",
            externalId: String(post.idstr || post.id || post.mid),
            title: `${post.user?.screen_name || uid}：${ownText.slice(0, 42)}`,
            author: post.user?.screen_name || uid,
            url: `https://weibo.com/${uid}/${post.mblogid || post.bid || post.idstr || post.id}`,
            excerpt: text.slice(0, 400),
            content: text,
            images,
            tags: ["微博"],
            capturedAt: isoDate(post.created_at),
            metadata: { reposts: post.reposts_count, comments: post.comments_count, attitudes: post.attitudes_count }
          });
        }
        sinceId = String(data.data?.since_id || "");
        if (!posts.length) break;
        if (page < pages) await wait(2500 + Math.floor(Math.random() * 1000));
      }
    }
    return { ok: true, items: [...new Map(items.map((item) => [`${item.source}:${item.externalId}`, item])).values()] };
  } catch (error) {
    return fail(`微博桌面页面请求失败：${error?.message || String(error)}`);
  }
}

export function extractCurrentPage() {
  const get = (selector, attr = "content") => document.querySelector(selector)?.getAttribute(attr)?.trim() || "";
  const find = (...selectors) => { for (const selector of selectors) { const value = document.querySelector(selector)?.textContent?.trim(); if (value) return value; } return ""; };
  const normalizeMediaUrl = (value) => {
    try {
      const url = new URL(String(value || "").trim(), location.href);
      if (url.protocol !== "https:" || url.href.length > 1900) return "";
      url.hash = "";
      return url.href;
    } catch { return ""; }
  };
  const mediaCaption = (element, fallback) => {
    const figureCaption = element?.closest?.("figure")?.querySelector?.("figcaption")?.textContent?.trim();
    return (figureCaption || element?.getAttribute?.("alt") || element?.getAttribute?.("title") || element?.getAttribute?.("aria-label") || fallback).trim().slice(0, 240);
  };
  const selection = window.getSelection()?.toString().trim() || "";
  const canonical = document.querySelector('link[rel="canonical"]')?.href || location.href;
  const title = get('meta[property="og:title"]') || document.title.trim() || location.hostname;
  const author = get('meta[name="author"]') || get('meta[property="article:author"]') || find("[rel=author]", ".author", "#js_name");
  const excerpt = get('meta[name="description"]') || get('meta[property="og:description"]') || selection.slice(0, 400);
  const coverValue = get('meta[property="og:image"]') || get('meta[name="twitter:image"]') || get('meta[property="twitter:image"]');
  let coverUrl = ""; try { if (coverValue) coverUrl = new URL(coverValue, location.href).href; } catch { /* Invalid page metadata is ignored. */ }
  const root = document.querySelector("article, main, [role=main], #link-report, .WB_detail") || document.body;
  const content = root.innerText.replace(/[\t\u00a0]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 120000);
  const media = [], seenMedia = new Set(), mediaCounts = { image: 0, video: 0, audio: 0 };
  const mediaLimits = { image: 20, video: 4, audio: 4 };
  const addMedia = (type, value, caption, element) => {
    const url = normalizeMediaUrl(value);
    if (!url || seenMedia.has(url) || media.length >= 24 || mediaCounts[type] >= mediaLimits[type]) return;
    if (type === "image" && element) {
      const width = Number(element.naturalWidth || element.width || element.clientWidth || 0);
      const height = Number(element.naturalHeight || element.height || element.clientHeight || 0);
      const hint = `${element.id || ""} ${element.className || ""} ${caption || ""} ${url}`.toLowerCase();
      if (width && height && (width < 96 || height < 72 || width * height < 14000)) return;
      if (/(?:avatar|emoji|icon|logo|sprite|badge|tracking|pixel)/.test(hint) && (!width || !height || width * height < 90000)) return;
    }
    seenMedia.add(url);
    mediaCounts[type]++;
    media.push({ type, url, caption: String(caption || `${({ image: "网页图片", video: "网页视频", audio: "网页音频" })[type]} ${mediaCounts[type]}`).slice(0, 240) });
  };
  addMedia("image", coverUrl, "网页封面");
  for (const image of root.querySelectorAll("img")) {
    const source = image.currentSrc || image.getAttribute("data-original") || image.getAttribute("data-src") || image.getAttribute("data-lazy-src") || image.src;
    addMedia("image", source, mediaCaption(image, `网页图片 ${mediaCounts.image + 1}`), image);
  }
  for (const video of root.querySelectorAll("video")) {
    if (video.poster) addMedia("image", video.poster, mediaCaption(video, `视频封面 ${mediaCounts.image + 1}`), video);
    addMedia("video", video.currentSrc || video.src, mediaCaption(video, `网页视频 ${mediaCounts.video + 1}`), video);
    for (const source of video.querySelectorAll("source[src]")) addMedia("video", source.src || source.getAttribute("src"), mediaCaption(video, `网页视频 ${mediaCounts.video + 1}`), video);
  }
  for (const audio of root.querySelectorAll("audio")) {
    addMedia("audio", audio.currentSrc || audio.src, mediaCaption(audio, `网页音频 ${mediaCounts.audio + 1}`), audio);
    for (const source of audio.querySelectorAll("source[src]")) addMedia("audio", source.src || source.getAttribute("src"), mediaCaption(audio, `网页音频 ${mediaCounts.audio + 1}`), audio);
  }
  const douban = /(^|\.)douban\.com$/.test(location.hostname), weibo = /(^|\.)weibo\.(com|cn)$/.test(location.hostname);
  const kind = douban ? (/movie\.douban\.com\/subject/.test(location.href) ? "movie" : /book\.douban\.com\/subject/.test(location.href) ? "book" : "review") : weibo ? "post" : "webpage";
  const source = douban ? "douban" : weibo ? "weibo" : "web";
  return { source, kind, externalId: canonical, title, author, url: canonical, excerpt, content, coverUrl, media, tags: [douban ? "豆瓣" : weibo ? "微博" : "网页"], highlights: selection ? [{ text: selection }] : [], capturedAt: new Date().toISOString() };
}

function doubanItem(interest, type) {
  const subject = interest.subject || {}; const people = type === "book" ? (subject.author || []).map((item) => typeof item === "string" ? item : item.name) : (subject.directors || []).map((item) => item.name);
  const comment = interest.comment || ""; const externalId = String(subject.id || subject.url || `${type}-${subject.title}`);
  return { source: "douban", kind: type, externalId, title: subject.title || "未命名条目", author: people.filter(Boolean).join(" / "), url: subject.url || `https://${type}.douban.com/subject/${externalId}/`, excerpt: comment || subject.intro || "", content: subject.intro || "", coverUrl: subject.pic?.large || subject.pic?.normal, tags: ["豆瓣", ...(interest.tags || []).map((tag) => tag.name || tag), ...(subject.genres || [])].filter(Boolean), highlights: comment ? [{ text: comment, note: `评分：${interest.rating?.value || "未评分"}` }] : [], capturedAt: interest.create_time || new Date().toISOString(), metadata: { status: interest.status, rating: interest.rating?.value || null, year: subject.year || String(subject.card_subtitle || "").match(/(?:19|20)\d{2}/)?.[0] || "" } };
}
async function requestJson(url, init = {}) { const response = await fetch(url, { credentials: "include", ...init, headers: { Accept: "application/json", "Content-Type": "application/json", ...(init.headers || {}) } }); const data = await response.json().catch(() => ({})); if (!response.ok || (data.code && Number(data.code) !== 0)) { const detail=Number(data.code)===997?"豆瓣接口要求签名，请更新到最新版 TunNest":data.errmsg||data.localized_message||data.msg; throw new Error(detail || `请求失败 (${response.status})`); } return data; }
function unique(items) { return [...new Map(items.map((item) => [`${item.source}:${item.externalId}`, item])).values()]; }
