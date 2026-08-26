const GATEWAY = "https://i.weread.qq.com/api/agent/gateway";

const DEFAULT_RETRIES = 6;
const DEFAULT_RETRY_DELAY_MS = 5_000;
const DEFAULT_MIN_INTERVAL_MS = 1_200;

export async function getWereadItems(apiKey, options = {}) {
  if (!apiKey) throw new Error("缺少 WEREAD_API_KEY");
  const client = createGatewayClient(apiKey, options);
  const books = [];
  let lastSort;
  for (;;) {
    const data = await client("/user/notebooks", { count: 100, ...(lastSort !== undefined ? { lastSort } : {}) });
    const batch = data.books || [];
    books.push(...batch);
    if (!data.hasMore || !batch.length) break;
    lastSort = batch[batch.length - 1].sort;
  }

  const items = [];
  for (const entry of books) {
    const book = entry.book || entry;
    const bookId = String(book.bookId || "");
    if (!bookId) continue;
    const marks = await client("/book/bookmarklist", { bookId });
    const notes = await allReviews(client, bookId);
    const chaptersData = await client("/book/chapterinfo", { bookId });
    const chapters = Object.fromEntries((chaptersData.chapters || []).map((chapter) => [
      String(chapter.chapterUid), chapter.title || chapter.chapterTitle || ""
    ]));
    const bookmarks = marks.updated || [];
    const reviews = (notes.reviews || []).map((value) => value.review || value);
    const highlights = [
      ...bookmarks.map((mark, index) => ({
        externalId: String(mark.bookmarkId || `mark-${index}`),
        text: mark.markText || "",
        chapter: chapters[String(mark.chapterUid)] || "",
        position: index
      })),
      ...reviews.map((note, index) => ({
        externalId: String(note.reviewId || `note-${index}`),
        text: note.abstract || note.content || "",
        note: note.type === 1 ? note.content : "",
        chapter: chapters[String(note.chapterUid)] || "",
        position: bookmarks.length + index
      }))
    ].filter((item) => item.text);
    items.push({
      source: "weread",
      kind: "book",
      externalId: bookId,
      title: book.title || book.bookName || "未命名书籍",
      author: book.author || "",
      url: `https://weread.qq.com/web/bookDetail/${bookId}`,
      excerpt: `${highlights.length} 条划线与笔记`,
      tags: ["微信读书"],
      coverUrl: book.cover || book.coverUrl,
      highlights,
      capturedAt: new Date().toISOString()
    });
  }
  return items;
}

function createGatewayClient(apiKey, options) {
  const fetchImpl = options.fetchImpl || fetch;
  const minIntervalMs = Math.max(0, options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS);
  let nextRequestAt = 0;
  const acquire = async () => {
    const now = Date.now();
    const waitMs = Math.max(0, nextRequestAt - now);
    nextRequestAt = Math.max(now, nextRequestAt) + minIntervalMs;
    if (waitMs) await pause(waitMs);
  };
  return (apiName, params = {}) => gateway(apiKey, apiName, params, { ...options, fetchImpl, beforeAttempt: acquire });
}

async function allReviews(client, bookId) {
  const reviews = [];
  let synckey = 0;
  for (;;) {
    const data = await client("/review/list/mine", { bookid: bookId, synckey, count: 100 });
    reviews.push(...(data.reviews || []));
    if (!data.hasMore || !(data.reviews || []).length) break;
    synckey = data.synckey || 0;
  }
  return { reviews };
}

async function gateway(apiKey, apiName, params, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_RETRIES);
  const baseDelayMs = Math.max(0, options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
  for (let attempt = 0; ; attempt++) {
    let response;
    let data = {};
    try {
      await options.beforeAttempt?.();
      response = await fetchImpl(GATEWAY, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ api_name: apiName, skill_version: "1.0.4", ...params })
      });
      data = await response.json().catch(() => ({}));
    } catch (error) {
      if (attempt >= maxRetries) throw error;
      await retryWait(baseDelayMs, attempt, options, error);
      continue;
    }
    const errorMessage = data.errmsg || `微信读书 Gateway 失败：${apiName}`;
    if (response.ok && !data.errcode && !data.upgrade_info) return data;
    if (data.upgrade_info) throw new Error(`微信读书 Gateway 需要升级：${data.upgrade_info}`);
    if (!isRetryableGatewayFailure(response.status, errorMessage) || attempt >= maxRetries) {
      throw new Error(errorMessage);
    }
    const retryAfterMs = retryAfterFrom(response, data);
    await retryWait(retryAfterMs ?? baseDelayMs, attempt, options, new Error(errorMessage));
  }
}

function isRetryableGatewayFailure(status, message) {
  if ([408, 425, 429].includes(Number(status)) || Number(status) >= 500) return true;
  return /请求频率|频率超限|过于频繁|rate\s*limit|too many requests|temporar/i.test(String(message));
}

function retryAfterFrom(response, data) {
  const header = response?.headers?.get?.("retry-after");
  if (header !== undefined && header !== null && header !== "") {
    const seconds = Number(header);
    return Number.isFinite(seconds) ? seconds * 1000 : null;
  }
  const value = data.retry_after ?? data.retryAfter;
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return number < 100 ? number * 1000 : number;
}

async function retryWait(baseDelayMs, attempt, options, error) {
  const jitter = options.retryJitterMs === false ? 0 : Math.floor(Math.random() * 250);
  const delayMs = Math.max(0, baseDelayMs * (2 ** attempt) + jitter);
  await options.onRetry?.({ attempt: attempt + 1, delayMs, error });
  if (delayMs) await pause(delayMs);
}

function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
