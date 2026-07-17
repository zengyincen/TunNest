export async function fetchWeread() {
  const notebook = await requestJson("https://weread.qq.com/api/user/notebook");
  const books = (notebook.books || notebook.bookList || notebook.updated || []).map((entry) => entry.book || entry).filter((book) => book.bookId);
  if (!books.length) throw new Error("没有读取到微信读书笔记，请确认已登录且已有划线");
  const items = [];
  for (const book of books) {
    const bookId = String(book.bookId);
    const [marks, reviews, chaptersData] = await Promise.all([
      requestJson(`https://i.weread.qq.com/book/bookmarklist?bookId=${encodeURIComponent(bookId)}`).catch(() => ({})),
      requestJson(`https://i.weread.qq.com/review/list?bookId=${encodeURIComponent(bookId)}&listType=11&mine=1&syncKey=0`).catch(() => ({})),
      requestJson("https://i.weread.qq.com/book/chapterInfos", { method: "POST", body: JSON.stringify({ bookIds: [bookId], synckeys: [0], teenmode: 0 }) }).catch(() => ({}))
    ]);
    const chapterList = chaptersData.data || chaptersData.updated || chaptersData.chapters || [];
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

export async function fetchDouban(settings) {
  if (!settings.doubanUserId || !settings.doubanApiKey) throw new Error("请先在设置中填写豆瓣用户 ID 和 API Key");
  const statuses = ["mark", "doing", "done"], types = ["book", "movie"], items = [];
  for (const type of types) for (const status of statuses) {
    for (let start = 0; start < 1000; start += 50) {
      const url = new URL(`https://frodo.douban.com/api/v2/user/${encodeURIComponent(settings.doubanUserId)}/interests`);
      url.search = new URLSearchParams({ type, status, start: String(start), count: "50", apiKey: settings.doubanApiKey }).toString();
      const data = await requestJson(url.toString(), { headers: { ...(settings.doubanAuthToken ? { Authorization: `Bearer ${settings.doubanAuthToken}` } : {}), Referer: "https://servicewechat.com/wx2f9b06c1de1ccfca/84/page-frame.html" } });
      const interests = data.interests || [];
      for (const interest of interests) items.push(doubanItem(interest, type));
      if (interests.length < 50) break;
    }
  }
  return unique(items);
}

export async function fetchWeibo(settings) {
  const uids = String(settings.weiboUids || "").split(/[,，\s]+/).filter(Boolean);
  if (!uids.length) throw new Error("请先在设置中填写微博用户 UID");
  const items = [];
  for (const uid of uids) {
    for (let page = 1; page <= Math.min(Number(settings.weiboPages) || 2, 10); page++) {
      const data = await requestJson(`https://m.weibo.cn/api/container/getIndex?type=uid&value=${encodeURIComponent(uid)}&containerid=107603${encodeURIComponent(uid)}&page=${page}`);
      if (data.ok !== 1) throw new Error(`微博 ${uid} 返回异常，可能需要重新登录`);
      const posts = (data.data?.cards || []).map((card) => card.mblog).filter(Boolean);
      for (const post of posts) items.push({ source: "weibo", kind: "post", externalId: String(post.id || post.mid), title: `${post.user?.screen_name || uid}：${plain(post.text).slice(0, 42)}`, author: post.user?.screen_name || uid, url: `https://weibo.com/${uid}/${post.bid || post.id}`, excerpt: plain(post.text).slice(0, 400), content: plain(post.text), tags: ["微博"], capturedAt: normalizeWeiboDate(post.created_at), metadata: { reposts: post.reposts_count, comments: post.comments_count, attitudes: post.attitudes_count } });
      if (!posts.length) break;
    }
  }
  return unique(items);
}

export function extractCurrentPage() {
  const get = (selector, attr = "content") => document.querySelector(selector)?.getAttribute(attr)?.trim() || "";
  const find = (...selectors) => { for (const selector of selectors) { const value = document.querySelector(selector)?.textContent?.trim(); if (value) return value; } return ""; };
  const selection = window.getSelection()?.toString().trim() || "";
  const canonical = document.querySelector('link[rel="canonical"]')?.href || location.href;
  const title = get('meta[property="og:title"]') || document.title.trim() || location.hostname;
  const author = get('meta[name="author"]') || get('meta[property="article:author"]') || find("[rel=author]", ".author", "#js_name");
  const excerpt = get('meta[name="description"]') || get('meta[property="og:description"]') || selection.slice(0, 400);
  const root = document.querySelector("article, main, [role=main], #link-report, .WB_detail") || document.body;
  const content = root.innerText.replace(/[\t\u00a0]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 120000);
  const douban = /(^|\.)douban\.com$/.test(location.hostname), weibo = /(^|\.)weibo\.(com|cn)$/.test(location.hostname);
  const kind = douban ? (/movie\.douban\.com\/subject/.test(location.href) ? "movie" : /book\.douban\.com\/subject/.test(location.href) ? "book" : "review") : weibo ? "post" : "webpage";
  const source = douban ? "douban" : weibo ? "weibo" : "web";
  return { source, kind, externalId: canonical, title, author, url: canonical, excerpt, content, tags: [douban ? "豆瓣" : weibo ? "微博" : "网页"], highlights: selection ? [{ text: selection }] : [], capturedAt: new Date().toISOString() };
}

function doubanItem(interest, type) {
  const subject = interest.subject || {}; const people = type === "book" ? (subject.author || []).map((item) => typeof item === "string" ? item : item.name) : (subject.directors || []).map((item) => item.name);
  const comment = interest.comment || ""; const externalId = String(subject.id || subject.url || `${type}-${subject.title}`);
  return { source: "douban", kind: type, externalId, title: subject.title || "未命名条目", author: people.filter(Boolean).join(" / "), url: subject.url || `https://${type}.douban.com/subject/${externalId}/`, excerpt: comment || subject.intro || "", content: subject.intro || "", coverUrl: subject.pic?.large || subject.pic?.normal, tags: ["豆瓣", ...(interest.tags || []).map((tag) => tag.name || tag), ...(subject.genres || [])].filter(Boolean), highlights: comment ? [{ text: comment, note: `评分：${interest.rating?.value || "未评分"}` }] : [], capturedAt: interest.create_time || new Date().toISOString(), metadata: { status: interest.status, rating: interest.rating?.value || null } };
}
async function requestJson(url, init = {}) { const response = await fetch(url, { credentials: "include", ...init, headers: { Accept: "application/json", "Content-Type": "application/json", ...(init.headers || {}) } }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.errmsg || data.msg || `请求失败 (${response.status})`); return data; }
function plain(html) { return String(html || "").replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim(); }
function normalizeWeiboDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(); }
function unique(items) { return [...new Map(items.map((item) => [`${item.source}:${item.externalId}`, item])).values()]; }
