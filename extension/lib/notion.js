const VERSION = "2022-06-28";
let nextRequestAt = 0;

export const NOTION_DATABASE_SCHEMAS = {
  clip: {
    label: "网页剪藏", title: "囤囤 · 网页剪藏", icon: "🔖",
    properties: {
      "标题": { title: {} }, "类型": { select: {} }, "原文": { url: {} },
      "作者": { rich_text: {} }, "摘要": { rich_text: {} }, "标签": { multi_select: {} },
      "收藏时间": { date: {} }, "外部 ID": { rich_text: {} }
    }
  },
  weread: {
    label: "微信读书", title: "囤囤 · 微信读书", icon: "📚",
    properties: {
      "书名": { title: {} }, "作者": { rich_text: {} }, "原书链接": { url: {} },
      "划线数量": { number: {} }, "同步摘要": { rich_text: {} }, "标签": { multi_select: {} },
      "同步时间": { date: {} }, "外部 ID": { rich_text: {} }
    }
  },
  douban: {
    label: "豆瓣书影音", title: "囤囤 · 豆瓣书影音", icon: "🎬",
    properties: {
      "名称": { title: {} }, "类型": { select: {} }, "原条目": { url: {} },
      "主创": { rich_text: {} }, "状态": { select: {} }, "评分": { number: {} },
      "短评": { rich_text: {} }, "标签": { multi_select: {} },
      "收藏时间": { date: {} }, "外部 ID": { rich_text: {} }
    }
  },
  weibo: {
    label: "微博博文", title: "囤囤 · 微博博文", icon: "📰",
    properties: {
      "博文": { title: {} }, "用户": { rich_text: {} }, "原博文": { url: {} },
      "正文摘要": { rich_text: {} }, "转发数": { number: {} }, "评论数": { number: {} },
      "点赞数": { number: {} }, "标签": { multi_select: {} },
      "发布时间": { date: {} }, "外部 ID": { rich_text: {} }
    }
  }
};

export async function createArchiveDatabase(token, pageOrUrl, source) {
  const schema = sourceSchema(source);
  const pageId = notionId(pageOrUrl);
  const data = await notion(token, "/databases", {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "page_id", page_id: pageId },
      icon: { type: "emoji", emoji: schema.icon },
      title: [{ type: "text", text: { content: schema.title } }],
      properties: schema.properties
    })
  });
  return data.id;
}

export async function verifyNotion(token, databaseId, source) {
  const schema = sourceSchema(source);
  const database = await notion(token, `/databases/${notionId(databaseId)}`);
  const invalid = Object.entries(schema.properties).flatMap(([name, definition]) => {
    const expected = Object.keys(definition)[0], actual = database.properties?.[name]?.type;
    return actual === expected ? [] : [`${name}（应为 ${typeLabel(expected)}${actual ? `，当前为 ${typeLabel(actual)}` : "，当前缺失"}）`];
  });
  if (invalid.length) throw new Error(`${schema.label}数据库字段不完整：${invalid.join("、")}`);
  return { id: database.id, title: database.title?.map((part) => part.plain_text).join("") || schema.title, source };
}

export async function syncItems(token, databaseId, items, source, onProgress = () => {}) {
  sourceSchema(source);
  const results = [];
  for (const [index, item] of items.entries()) {
    try { results.push({ ok: true, id: await upsertItem(token, notionId(databaseId), item, source) }); }
    catch (error) { results.push({ ok: false, error: error.message, title: item.title }); }
    onProgress(index + 1, items.length);
  }
  return results;
}

async function upsertItem(token, databaseId, item, source) {
  const externalId = String(item.externalId || item.url || item.title).slice(0, 1900);
  const query = await notion(token, `/databases/${databaseId}/query`, { method: "POST", body: JSON.stringify({ filter: { property: "外部 ID", rich_text: { equals: externalId } }, page_size: 1 }) });
  const properties = propertiesFor(item, externalId, source);
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

function propertiesFor(item, externalId, source) {
  const tags = { multi_select: (item.tags || []).slice(0, 20).map((name) => ({ name: String(name).slice(0, 100) })) };
  const metadata = item.metadata || {};
  if (source === "clip") return {
    "标题": { title: rich(item.title, 1900) }, "类型": { select: { name: kindLabel(item.kind) } },
    "原文": { url: item.url || null }, "作者": { rich_text: rich(item.author || "", 1900) },
    "摘要": { rich_text: rich(item.excerpt || "", 1900) }, "标签": tags,
    "收藏时间": date(item.capturedAt), "外部 ID": { rich_text: rich(externalId, 1900) }
  };
  if (source === "weread") return {
    "书名": { title: rich(item.title, 1900) }, "作者": { rich_text: rich(item.author || "", 1900) },
    "原书链接": { url: item.url || null }, "划线数量": number((item.highlights || []).length),
    "同步摘要": { rich_text: rich(item.excerpt || "", 1900) }, "标签": tags,
    "同步时间": date(item.capturedAt), "外部 ID": { rich_text: rich(externalId, 1900) }
  };
  if (source === "douban") return {
    "名称": { title: rich(item.title, 1900) }, "类型": { select: { name: kindLabel(item.kind) } },
    "原条目": { url: item.url || null }, "主创": { rich_text: rich(item.author || "", 1900) },
    "状态": { select: { name: doubanStatus(metadata.status, item.kind) } }, "评分": number(metadata.rating),
    "短评": { rich_text: rich(item.excerpt || "", 1900) }, "标签": tags,
    "收藏时间": date(item.capturedAt), "外部 ID": { rich_text: rich(externalId, 1900) }
  };
  return {
    "博文": { title: rich(item.title, 1900) }, "用户": { rich_text: rich(item.author || "", 1900) },
    "原博文": { url: item.url || null }, "正文摘要": { rich_text: rich(item.excerpt || item.content || "", 1900) },
    "转发数": number(metadata.reposts), "评论数": number(metadata.comments), "点赞数": number(metadata.attitudes),
    "标签": tags, "发布时间": date(item.capturedAt), "外部 ID": { rich_text: rich(externalId, 1900) }
  };
}

function blocksFor(item) {
  const blocks = [];
  if (item.url) blocks.push({ object: "block", type: "bookmark", bookmark: { url: item.url } });
  if (item.excerpt) blocks.push({ object: "block", type: "callout", callout: { icon: { type: "emoji", emoji: "💡" }, rich_text: rich(item.excerpt, 1900) } });
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
function sourceSchema(source) { const schema = NOTION_DATABASE_SCHEMAS[source]; if (!schema) throw new Error("未知 Notion 数据库类型"); return schema; }
function rich(value, max = 2000) { return value ? [{ type: "text", text: { content: String(value).slice(0, max) } }] : []; }
function split(value) { return String(value).split(/\n{2,}/).map((part) => part.trim()).filter(Boolean).flatMap((part) => part.match(/[\s\S]{1,1900}/g) || []); }
function notionId(value) { const match = String(value || "").match(/[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i); if (!match) throw new Error("Notion 页面或数据库 ID 无效"); return match[0]; }
function kindLabel(value) { return ({ article: "文章", webpage: "网页", book: "书籍", movie: "电影", review: "评论", post: "博文" })[value] || value || "其他"; }
function doubanStatus(value, kind) { const book = kind === "book"; return ({ mark: book ? "想读" : "想看", doing: book ? "在读" : "在看", done: book ? "读过" : "看过" })[value] || "未标记"; }
function date(value) { const parsed = Date.parse(value); return { date: { start: Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString() } }; }
function number(value) { const parsed = Number(value); return { number: value === null || value === undefined || value === "" || !Number.isFinite(parsed) ? null : parsed }; }
function typeLabel(value) { return ({ title: "标题", rich_text: "文本", select: "选择", multi_select: "多选", url: "URL", date: "日期", number: "数字" })[value] || value; }
