const VERSION = "2022-06-28";
let nextRequestAt = 0;

export async function createArchiveDatabase(token, pageOrUrl) {
  const pageId = notionId(pageOrUrl);
  const data = await notion(token, "/databases", {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "page_id", page_id: pageId },
      icon: { type: "emoji", emoji: "◌" },
      title: [{ type: "text", text: { content: "囤囤 TunNest" } }],
      properties: {
        "标题": { title: {} }, "类型": { select: {} }, "平台": { select: {} },
        "原文": { url: {} }, "作者": { rich_text: {} }, "摘要": { rich_text: {} },
        "标签": { multi_select: {} }, "采集时间": { date: {} }, "外部 ID": { rich_text: {} }
      }
    })
  });
  return data.id;
}

export async function verifyNotion(token, databaseId) {
  const database = await notion(token, `/databases/${notionId(databaseId)}`);
  return { id: database.id, title: database.title?.map((part) => part.plain_text).join("") || "囤囤 TunNest" };
}

export async function syncItems(token, databaseId, items, onProgress = () => {}) {
  const results = [];
  for (const [index, item] of items.entries()) {
    try { results.push({ ok: true, id: await upsertItem(token, notionId(databaseId), item) }); }
    catch (error) { results.push({ ok: false, error: error.message, title: item.title }); }
    onProgress(index + 1, items.length);
  }
  return results;
}

async function upsertItem(token, databaseId, item) {
  const externalId = String(item.externalId || item.url || item.title).slice(0, 1900);
  const query = await notion(token, `/databases/${databaseId}/query`, { method: "POST", body: JSON.stringify({ filter: { property: "外部 ID", rich_text: { equals: externalId } }, page_size: 1 }) });
  const properties = propertiesFor(item, externalId);
  if (query.results?.[0]) {
    await notion(token, `/pages/${query.results[0].id}`, { method: "PATCH", body: JSON.stringify({ properties }) });
    await replaceManagedBlocks(token, query.results[0].id, item);
    return query.results[0].id;
  }
  const page = await notion(token, "/pages", { method: "POST", body: JSON.stringify({ parent: { database_id: databaseId }, properties, children: [managedBlock(item)] }) });
  return page.id;
}

async function replaceManagedBlocks(token, pageId, item) {
  const children = await notion(token, `/blocks/${pageId}/children?page_size=100`);
  const managed = (children.results || []).find((block) => block.type === "toggle" && (block.toggle?.rich_text || []).map((part) => part.plain_text || part.text?.content || "").join("") === "TunNest 自动同步区域");
  if (managed) await notion(token, `/blocks/${managed.id}`, { method: "DELETE" });
  await notion(token, `/blocks/${pageId}/children`, { method: "PATCH", body: JSON.stringify({ children: [managedBlock(item)] }) });
}

function managedBlock(item) {
  return { object: "block", type: "toggle", toggle: { rich_text: rich("TunNest 自动同步区域"), color: "gray_background", children: blocksFor(item).slice(0, 100) } };
}

function propertiesFor(item, externalId) {
  return {
    "标题": { title: rich(item.title, 1900) },
    "类型": { select: { name: kindLabel(item.kind) } },
    "平台": { select: { name: sourceLabel(item.source) } },
    "原文": { url: item.url || null }, "作者": { rich_text: rich(item.author || "", 1900) },
    "摘要": { rich_text: rich(item.excerpt || "", 1900) },
    "标签": { multi_select: (item.tags || []).slice(0, 20).map((name) => ({ name: String(name).slice(0, 100) })) },
    "采集时间": { date: { start: item.capturedAt || new Date().toISOString() } },
    "外部 ID": { rich_text: rich(externalId, 1900) }
  };
}

function blocksFor(item) {
  const blocks = [];
  if (item.url) blocks.push({ object: "block", type: "bookmark", bookmark: { url: item.url } });
  if (item.excerpt) blocks.push({ object: "block", type: "callout", callout: { icon: { type: "emoji", emoji: "✦" }, rich_text: rich(item.excerpt, 1900) } });
  for (const highlight of (item.highlights || []).slice(0, 70)) {
    const value = [highlight.chapter, highlight.text, highlight.note ? `笔记：${highlight.note}` : ""].filter(Boolean).join("\n");
    blocks.push({ object: "block", type: "quote", quote: { rich_text: rich(value, 1900), color: "yellow_background" } });
  }
  if (item.content) for (const part of split(item.content).slice(0, 80)) blocks.push({ object: "block", type: "paragraph", paragraph: { rich_text: rich(part, 1900) } });
  return blocks.slice(0, 100);
}

async function notion(token, path, init = {}) {
  const delay = Math.max(0, nextRequestAt - Date.now()); if (delay) await new Promise((resolve) => setTimeout(resolve, delay)); nextRequestAt = Date.now() + 350;
  const response = await fetch(`https://api.notion.com/v1${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Notion-Version": VERSION, "Content-Type": "application/json", ...(init.headers || {}) } });
  const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.message || `Notion 请求失败 (${response.status})`); return data;
}
function rich(value, max = 2000) { return value ? [{ type: "text", text: { content: String(value).slice(0, max) } }] : []; }
function split(value) { return value.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean).flatMap((part) => part.match(/[\s\S]{1,1900}/g) || []); }
function notionId(value) { const match = String(value || "").match(/[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i); if (!match) throw new Error("Notion 页面或数据库 ID 无效"); return match[0]; }
function kindLabel(value) { return ({ article: "文章", webpage: "网页", book: "书籍", movie: "电影", review: "评论", post: "博文" })[value] || value; }
function sourceLabel(value) { return ({ weread: "微信读书", douban: "豆瓣", weibo: "微博", web: "网页" })[value] || value; }
