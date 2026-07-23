const VERSION = "2022-06-28";
const FILE_VERSION = "2026-03-11";
const MANAGED_IMAGE_CAPTION = "TunNest · ";
const MANAGED_BLOCK_MARKER = "\u2063\u200b\u2063";
let nextRequestAt = 0;
let notionRequestTail = Promise.resolve();
const ensuredDatabaseSchemas = new Map();
const NOTION_QUERY_BATCH_SIZE = 50;

export const NOTION_DATABASE_SCHEMAS = {
  clip: {
    label: "网页剪藏", title: "囤囤 · 网页剪藏", icon: "🔖",
    properties: {
      "标题": { title: {} }, "封面": { files: {} }, "类型": { select: {} }, "原文": { url: {} },
      "作者": { rich_text: {} }, "摘要": { rich_text: {} }, "标签": { multi_select: {} },
      "收藏时间": { date: {} }, "外部 ID": { rich_text: {} }
    }
  },
  weread: {
    label: "微信读书", title: "囤囤 · 微信读书", icon: "📚",
    properties: {
      "书名": { title: {} }, "封面": { files: {} }, "作者": { rich_text: {} }, "原书链接": { url: {} },
      "划线数量": { number: {} }, "同步摘要": { rich_text: {} }, "标签": { multi_select: {} },
      "同步时间": { date: {} }, "外部 ID": { rich_text: {} }
    }
  },
  douban: {
    label: "豆瓣用户收藏", title: "囤囤 · 豆瓣用户", icon: "👤",
    properties: {
      "名称": { title: {} }, "封面": { files: {} }, "类型": { select: {} }, "原条目": { url: {} },
      "主创": { rich_text: {} }, "状态": { select: {} }, "评分": { number: {} },
      "短评": { rich_text: {} }, "标签": { multi_select: {} },
      "收藏时间": { date: {} }, "外部 ID": { rich_text: {} }
    }
  },
  doubanMovieTop250: {
    label: "豆瓣电影 Top 250", title: "囤囤 · 豆瓣电影 Top 250", icon: "🎞️",
    properties: top250Properties()
  },
  doubanBookTop250: {
    label: "豆瓣图书 Top 250", title: "囤囤 · 豆瓣图书 Top 250", icon: "📚",
    properties: top250Properties()
  },
  doubanMusicTop250: {
    label: "豆瓣音乐 Top 250", title: "囤囤 · 豆瓣音乐 Top 250", icon: "🎵",
    properties: top250Properties()
  },
  weibo: {
    label: "微博博文", title: "囤囤 · 微博博文", icon: "📰",
    properties: {
      "博文": { title: {} }, "封面": { files: {} }, "用户": { rich_text: {} }, "原博文": { url: {} },
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
  const database = await ensureDatabaseSchema(token, notionId(databaseId), source);
  const invalid = Object.entries(schema.properties).flatMap(([name, definition]) => {
    const expected = Object.keys(definition)[0], actual = database.properties?.[name]?.type;
    return actual === expected ? [] : [`${name}（应为 ${typeLabel(expected)}${actual ? `，当前为 ${typeLabel(actual)}` : "，当前缺失"}）`];
  });
  if (invalid.length) throw new Error(`${schema.label}数据库字段不完整：${invalid.join("、")}`);
  return { id: database.id, title: database.title?.map((part) => part.plain_text).join("") || schema.title, source };
}

export async function syncItems(token, databaseId, items, source, onProgress = () => {}, options = {}) {
  sourceSchema(source);
  const normalizedDatabaseId = notionId(databaseId);
  await ensureDatabaseSchema(token, normalizedDatabaseId, source, options.signal);
  const existingPages = await preloadExistingPages(token, normalizedDatabaseId, items, options.signal, onProgress);
  const results = new Array(items.length);
  const concurrency = items.length > 1 ? (isDoubanSource(source) ? 3 : 2) : 1;
  let nextIndex = 0, completed = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++, item = items[index];
      throwIfAborted(options.signal);
      await onProgress(completed, items.length, `${index + 1}/${items.length} · 正在写入「${String(item.title || "未命名内容").slice(0, 28)}」`);
      try {
        const context = {
          signal: options.signal,
          existingPages,
          onDetail: (detail) => onProgress(completed, items.length, `${index + 1}/${items.length} · ${detail}`)
        };
        results[index] = { ok: true, id: await upsertItem(token, normalizedDatabaseId, item, source, context) };
      } catch (error) {
        if (options.signal?.aborted) throw error;
        results[index] = { ok: false, error: error.message, title: item.title };
      }
      completed++;
      await onProgress(completed, items.length, completed < items.length ? `已处理 ${completed}/${items.length} 条` : "正在完成同步");
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function upsertItem(token, databaseId, item, source, context = {}) {
  const { signal, onDetail = () => {}, existingPages = null } = context;
  const externalId = String(item.externalId || item.url || item.title).slice(0, 1900);
  let existingPage = existingPages?.get(externalId);
  if (!existingPages) {
    const query = await notion(token, `/databases/${databaseId}/query`, withSignal({ method: "POST", body: JSON.stringify({ filter: { property: "外部 ID", rich_text: { equals: externalId } }, page_size: 1 }) }, signal));
    existingPage = query.results?.[0];
  }
  if (existingPage && isTop250Source(source) && hasNotionHostedCover(existingPage) && top250Unchanged(existingPage, item, externalId)) {
    await onDetail("内容未变化，已跳过写入");
    return existingPage.id;
  }
  const properties = propertiesFor(item, externalId, source);
  let cover = pageCover(item), version = VERSION;
  if (isDoubanSource(source) && isDoubanImageUrl(representativeImageUrl(item))) {
    if (hasNotionHostedCover(existingPage)) {
      delete properties["封面"];
      cover = null;
    } else {
      try {
        await onDetail("正在上传豆瓣封面");
        const fileUploadId = await uploadImage(token, representativeImageUrl(item), 0, signal, (detail) => onDetail(`豆瓣封面 · ${detail}`), "douban");
        properties["封面"] = uploadedImageFiles(fileUploadId);
        cover = uploadedPageCover(fileUploadId);
        version = FILE_VERSION;
      } catch (error) {
        if (signal?.aborted) throw error;
        console.warn("豆瓣封面上传失败，保留原图链接", error);
        await onDetail("封面上传失败，保留原图链接");
      }
    }
  }
  if (existingPage) {
    await notion(token, `/pages/${existingPage.id}`, withSignal({ method: "PATCH", body: JSON.stringify({ properties, ...(cover ? { cover } : {}) }) }, signal), version);
    if (isTop250Source(source)) return existingPage.id;
    if (source === "weibo") await syncUploadedImages(token, existingPage.id, item, context);
    await onDetail("正在更新正文");
    await replaceManagedBlocks(token, existingPage.id, item, signal);
    return existingPage.id;
  }
  const page = await notion(token, "/pages", withSignal({ method: "POST", body: JSON.stringify({ parent: { database_id: databaseId }, properties, ...(cover ? { cover } : {}), ...(!isTop250Source(source) ? { children: [managedBlock(item)] } : {}) }) }, signal), version);
  if (source === "weibo") await syncUploadedImages(token, page.id, item, context);
  return page.id;
}

async function replaceManagedBlocks(token, pageId, item, signal) {
  const children = await notion(token, `/blocks/${pageId}/children?page_size=100`, withSignal({}, signal));
  let managed = (children.results || []).find((block) => block.type === "toggle" && (block.toggle?.rich_text || []).map((part) => part.plain_text || part.text?.content || "").join("") === "TunNest 自动同步区域");
  if (!managed) managed = await findManagedSyncedBlock(token, children.results || [], signal);
  if (managed) await notion(token, `/blocks/${managed.id}`, withSignal({ method: "DELETE" }, signal));
  await notion(token, `/blocks/${pageId}/children`, withSignal({ method: "PATCH", body: JSON.stringify({ children: [managedBlock(item)] }) }, signal));
}

function managedBlock(item) {
  const children = blocksFor(item).slice(0, 100);
  if (children[0]?.type === "bookmark") children[0].bookmark.caption = rich(MANAGED_BLOCK_MARKER);
  else children.unshift({ object: "block", type: "paragraph", paragraph: { rich_text: rich(MANAGED_BLOCK_MARKER) } });
  return { object: "block", type: "synced_block", synced_block: { synced_from: null, children: children.slice(0, 100) } };
}

async function findManagedSyncedBlock(token, blocks, signal) {
  for (const block of blocks) {
    if (block.type !== "synced_block" || block.synced_block?.synced_from) continue;
    const children = await notion(token, `/blocks/${block.id}/children?page_size=1`, withSignal({}, signal));
    const first = children.results?.[0];
    const marker = first?.type === "bookmark" ? captionText(first.bookmark?.caption) : first?.type === "paragraph" ? captionText(first.paragraph?.rich_text) : "";
    if (marker.includes(MANAGED_BLOCK_MARKER)) return block;
  }
  return null;
}

function propertiesFor(item, externalId, source) {
  const tags = { multi_select: (item.tags || []).slice(0, 20).map((name) => ({ name: String(name).slice(0, 100) })) };
  const cover = imageFiles(item);
  const metadata = item.metadata || {};
  if (source === "clip") return {
    "标题": { title: rich(item.title, 1900) }, "封面": cover, "类型": { select: { name: kindLabel(item.kind) } },
    "原文": { url: item.url || null }, "作者": { rich_text: rich(item.author || "", 1900) },
    "摘要": { rich_text: rich(item.excerpt || "", 1900) }, "标签": tags,
    "收藏时间": date(item.capturedAt), "外部 ID": { rich_text: rich(externalId, 1900) }
  };
  if (source === "weread") return {
    "书名": { title: rich(item.title, 1900) }, "封面": cover, "作者": { rich_text: rich(item.author || "", 1900) },
    "原书链接": { url: item.url || null }, "划线数量": number((item.highlights || []).length),
    "同步摘要": { rich_text: rich(item.excerpt || "", 1900) }, "标签": tags,
    "同步时间": date(item.capturedAt), "外部 ID": { rich_text: rich(externalId, 1900) }
  };
  if (source === "douban") return {
    "名称": { title: rich(item.title, 1900) }, "封面": cover, "类型": { select: { name: kindLabel(item.kind) } },
    "原条目": { url: item.url || null }, "主创": { rich_text: rich(item.author || "", 1900) },
    "状态": { select: { name: doubanStatus(metadata.status, item.kind) } }, "评分": number(metadata.rating),
    "短评": { rich_text: rich(item.excerpt || "", 1900) }, "标签": tags,
    "收藏时间": date(item.capturedAt), "外部 ID": { rich_text: rich(externalId, 1900) }
  };
  if (["doubanMovieTop250", "doubanBookTop250", "doubanMusicTop250"].includes(source)) return {
    "名称": { title: rich(item.title, 1900) }, "封面": cover,
    "排名": number(metadata.rank), "评分": number(metadata.rating), "评价人数": number(metadata.ratingCount),
    "信息": { rich_text: rich(metadata.info || item.author || "", 1900) },
    "推荐语": { rich_text: rich(metadata.quote || "", 1900) }, "原条目": { url: item.url || null },
    "标签": tags, "抓取时间": date(item.capturedAt), "外部 ID": { rich_text: rich(externalId, 1900) }
  };
  return {
    "博文": { title: rich(item.title, 1900) }, "封面": cover, "用户": { rich_text: rich(item.author || "", 1900) },
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

async function syncUploadedImages(token, pageId, item, context = {}) {
  const { signal, onDetail = () => {} } = context;
  const images = (item.images || []).slice(0, 20).map((image, index) => ({
    url: typeof image === "string" ? image : image?.url,
    caption: typeof image === "string" ? `配图 ${index + 1}` : image.caption || `配图 ${index + 1}`
  })).filter((image) => /^https:\/\//i.test(image.url || ""));
  if (!images.length) return;
  const children = await notion(token, `/blocks/${pageId}/children?page_size=100`, withSignal({}, signal));
  const managedImages = (children.results || []).filter((block) => block.type === "image" && captionText(block.image?.caption).startsWith(MANAGED_IMAGE_CAPTION));
  const managedFallbacks = (children.results || []).filter((block) => block.type === "paragraph" && captionText(block.paragraph?.rich_text).startsWith(`${MANAGED_IMAGE_CAPTION}配图上传失败`));
  if (managedImages.length === images.length && images.length && !managedFallbacks.length) return;
  const blocks = [], errors = [];
  let firstUploadedFile = null;
  for (const [index, image] of images.entries()) {
    throwIfAborted(signal);
    try {
      const fileUploadId = await uploadImage(token, image.url, index, signal, (detail) => onDetail(`配图 ${index + 1}/${images.length} · ${detail}`));
      if (!firstUploadedFile) firstUploadedFile = { id: fileUploadId, caption: image.caption };
      blocks.push({
        object: "block", type: "image",
        image: { type: "file_upload", file_upload: { id: fileUploadId }, caption: rich(`${MANAGED_IMAGE_CAPTION}${image.caption}`, 1900) }
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      errors.push(`${image.caption}：${error.message}`);
      blocks.push(imageFallbackBlock(image));
    }
  }
  try {
    await onDetail("正在插入配图");
    await notion(token, `/blocks/${pageId}/children`, withSignal({ method: "PATCH", body: JSON.stringify({ children: blocks }) }, signal), FILE_VERSION);
  } catch (error) {
    if (signal?.aborted) throw error;
    await notion(token, `/blocks/${pageId}/children`, withSignal({ method: "PATCH", body: JSON.stringify({ children: images.map(imageFallbackBlock) }) }, signal));
    throw new Error(`Notion 图片块创建失败：${error.message}`);
  }
  if (firstUploadedFile) {
    try {
      await notion(token, `/pages/${pageId}`, withSignal({ method: "PATCH", body: JSON.stringify({ properties: { "封面": { files: [{ name: firstUploadedFile.caption, type: "file_upload", file_upload: { id: firstUploadedFile.id } }] } } }) }, signal), FILE_VERSION);
    } catch (error) { console.warn("微博封面属性写入失败，保留原图外链", error); }
  }
  if (errors.length) throw new Error(`微博配图上传失败，已保留原图链接：${errors[0]}`);
  for (const block of [...managedImages, ...managedFallbacks]) await notion(token, `/blocks/${block.id}`, withSignal({ method: "DELETE" }, signal));
}

async function uploadImage(token, url, index, signal, onDetail = () => {}, source = "weibo") {
  const label = source === "douban" ? "豆瓣封面" : "微博配图";
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error(`${label}地址无效：${url}`); }
  const supported = source === "douban" ? isDoubanImageUrl(url) : /(^|\.)sinaimg\.cn$/i.test(parsed.hostname);
  if (!supported) throw new Error(`不支持的${label}域名：${parsed.hostname}`);
  const filenameBase = `tunnest-${source === "douban" ? "douban-cover" : "weibo"}-${index + 1}`;
  let downloadFailure = "";
  try {
    await onDetail("正在下载原图");
    const headers = { Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8" };
    if (source === "douban") {
      headers.Referer = "https://www.douban.com/";
      headers["User-Agent"] = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138.0 Safari/537.36";
    }
    const { response, body: sourceBlob } = await timedFetch(
      url,
      withSignal({ credentials: "omit", cache: "no-store", headers }, signal),
      45000,
      `${label}下载`,
      (value) => value.ok ? value.blob() : null
    );
    if (!response.ok) throw new Error(`${label}下载失败 (${response.status})`);
    const declaredType = normalizeImageType(sourceBlob.type);
    if (sourceBlob.type && !declaredType) throw new Error(`${label}返回的不是图片（${sourceBlob.type}）`);
    const contentType = declaredType || imageTypeFromPath(parsed.pathname);
    if (!contentType) throw new Error(`${label}格式异常：${sourceBlob.type || "未知类型"}`);
    if (!sourceBlob.size) throw new Error(`${label}返回了空图片`);
    const blob = sourceBlob.type === contentType ? sourceBlob : sourceBlob.slice(0, sourceBlob.size, contentType);
    if (blob.size > 20 * 1024 * 1024) throw new Error(`单张${label}超过 Notion 20MB 上传限制`);
    const filename = `${filenameBase}.${imageExtension(contentType, parsed.pathname)}`;
    await onDetail("正在上传至 Notion");
    const upload = await notion(token, "/file_uploads", {
      method: "POST", body: JSON.stringify({ mode: "single_part", filename, content_type: blob.type }), signal
    }, FILE_VERSION);
    const form = new FormData();
    form.append("file", blob, filename);
    const sent = await notion(token, `/file_uploads/${upload.id}/send`, { method: "POST", body: form, signal }, FILE_VERSION);
    if (sent.status !== "uploaded") throw new Error(`Notion 图片上传未完成：${sent.status || "未知状态"}`);
    return upload.id;
  } catch (error) { if (signal?.aborted) throw error; downloadFailure = error.message; }

  let importFailure = "";
  try {
    await onDetail("正在尝试备用导入");
    let imported = await notion(token, "/file_uploads", {
      method: "POST", body: JSON.stringify({ mode: "external_url", external_url: url, filename: `${filenameBase}.${imageExtension("", parsed.pathname)}` }), signal
    }, FILE_VERSION);
    for (let attempt = 0; imported.status === "pending" && attempt < 8; attempt++) {
      await pause(750, signal);
      await onDetail(`备用导入处理中 ${attempt + 1}/8`);
      imported = await notion(token, `/file_uploads/${imported.id}`, withSignal({}, signal), FILE_VERSION);
    }
    if (imported.status === "uploaded") return imported.id;
    importFailure = imported.file_import_result || imported.status || "导入超时";
  } catch (error) { if (signal?.aborted) throw error; importFailure = error.message; }
  throw new Error(`${downloadFailure || `${label}下载失败`}；Notion 远程导入失败（${importFailure || "未知原因"}）`);
}

async function notion(token, path, init = {}, version = VERSION, attempt = 0) {
  await reserveNotionRequest(init.signal);
  const formData = typeof FormData !== "undefined" && init.body instanceof FormData;
  const { response, body: data } = await timedFetch(
    `https://api.notion.com/v1${path}`,
    { ...init, headers: { Authorization: `Bearer ${token}`, "Notion-Version": version, ...(!formData ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) } },
    formData ? 90000 : 45000,
    formData ? "Notion 文件上传" : "Notion 请求",
    (value) => value.json().catch(() => ({}))
  );
  if (response.status === 429 && attempt < 3) {
    const retryAfter = Math.max(1, Number(response.headers?.get?.("Retry-After")) || 1);
    await pause(retryAfter * 1000, init.signal);
    return notion(token, path, init, version, attempt + 1);
  }
  if (!response.ok) throw new Error(data.message || `Notion 请求失败 (${response.status})`); return data;
}
function sourceSchema(source) { const schema = NOTION_DATABASE_SCHEMAS[source]; if (!schema) throw new Error("未知 Notion 数据库类型"); return schema; }
function isTop250Source(source) { return ["doubanMovieTop250", "doubanBookTop250", "doubanMusicTop250"].includes(source); }
function isDoubanSource(source) { return source === "douban" || isTop250Source(source); }
function rich(value, max = 2000) { return value ? [{ type: "text", text: { content: String(value).slice(0, max) } }] : []; }
function split(value) { return String(value).split(/\n{2,}/).map((part) => part.trim()).filter(Boolean).flatMap((part) => part.match(/[\s\S]{1,1900}/g) || []); }
function notionId(value) { const match = String(value || "").match(/[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i); if (!match) throw new Error("Notion 页面或数据库 ID 无效"); return match[0]; }
function kindLabel(value) { return ({ article: "文章", webpage: "网页", book: "书籍", movie: "电影", music: "音乐", review: "评论", post: "博文" })[value] || value || "其他"; }
function doubanStatus(value, kind) { const book = kind === "book"; return ({ mark: book ? "想读" : "想看", doing: book ? "在读" : "在看", done: book ? "读过" : "看过" })[value] || "未标记"; }
function date(value) { const parsed = Date.parse(value); return { date: { start: Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString() } }; }
function number(value) { const parsed = Number(value); return { number: value === null || value === undefined || value === "" || !Number.isFinite(parsed) ? null : parsed }; }
function typeLabel(value) { return ({ title: "标题", rich_text: "文本", select: "选择", multi_select: "多选", url: "URL", date: "日期", number: "数字", files: "文件与媒体" })[value] || value; }
function captionText(caption) { return (caption || []).map((part) => part.plain_text || part.text?.content || "").join(""); }
function imageExtension(type, pathname) { return ({ "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif" })[type] || pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1] || "jpg"; }
function normalizeImageType(value) { const type = String(value || "").split(";", 1)[0].toLowerCase(); return type === "image/jpg" ? "image/jpeg" : type.startsWith("image/") ? type : ""; }
function imageTypeFromPath(pathname) { return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", avif: "image/avif" })[pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase()] || ""; }
function imageFallbackBlock(image) { return { object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: `${MANAGED_IMAGE_CAPTION}配图上传失败 · ${image.caption}（打开原图）`, link: { url: image.url } } }] } }; }
function top250Properties() { return { "名称": { title: {} }, "封面": { files: {} }, "排名": { number: {} }, "评分": { number: {} }, "评价人数": { number: {} }, "信息": { rich_text: {} }, "推荐语": { rich_text: {} }, "原条目": { url: {} }, "标签": { multi_select: {} }, "抓取时间": { date: {} }, "外部 ID": { rich_text: {} } }; }
function representativeImageUrl(item) { const image=(item.images||[])[0],value=typeof image==="string"?image:image?.url;return normalizeImageUrl(item.coverUrl||value); }
function isDoubanImageUrl(value) { try { return /(^|\.)doubanio\.com$/i.test(new URL(value).hostname); } catch { return false; } }
function hasNotionHostedCover(page) { return (page?.properties?.["封面"]?.files || []).some((file) => file.type === "file" || file.type === "file_upload"); }
function uploadedPageCover(id) { return { type: "file_upload", file_upload: { id } }; }
function uploadedImageFiles(id) { return { files: [{ name: "封面", type: "file_upload", file_upload: { id } }] }; }
function top250Unchanged(page, item, externalId) {
  const properties = page?.properties || {}, metadata = item.metadata || {};
  return propertyText(properties["名称"]) === String(item.title || "").slice(0, 1900)
    && propertyNumber(properties["排名"]) === nullableNumber(metadata.rank)
    && propertyNumber(properties["评分"]) === nullableNumber(metadata.rating)
    && propertyNumber(properties["评价人数"]) === nullableNumber(metadata.ratingCount)
    && propertyText(properties["信息"]) === String(metadata.info || item.author || "").slice(0, 1900)
    && propertyText(properties["推荐语"]) === String(metadata.quote || "").slice(0, 1900)
    && (properties["原条目"]?.url || "") === String(item.url || "")
    && propertyText(properties["外部 ID"]) === externalId
    && sameStrings((properties["标签"]?.multi_select || []).map((tag) => tag.name), (item.tags || []).slice(0, 20).map((tag) => String(tag).slice(0, 100)));
}
function propertyText(property) { return (property?.title || property?.rich_text || []).map((part) => part.plain_text ?? part.text?.content ?? "").join(""); }
function propertyNumber(property) { return property?.number === null || property?.number === undefined ? null : Number(property.number); }
function nullableNumber(value) { const parsed = Number(value); return value === null || value === undefined || value === "" || !Number.isFinite(parsed) ? null : parsed; }
function sameStrings(left, right) { const a = [...left].sort(), b = [...right].sort(); return a.length === b.length && a.every((value, index) => value === b[index]); }
function normalizeImageUrl(value) { const normalized=String(value||"").trim().replace(/^http:/i,"https:").replace(/^\/\//,"https://");if(!normalized)return "";try{const url=new URL(normalized);return url.protocol==="https:"&&url.href.length<=2000?url.href:"";}catch{return "";} }
function pageCover(item) { const url=representativeImageUrl(item);return url?{type:"external",external:{url}}:null; }
function imageFiles(item) { const url=representativeImageUrl(item);return{files:url?[{name:"封面",type:"external",external:{url}}]:[]}; }
function ensureDatabaseSchema(token, databaseId, source, signal) {
  const schema=sourceSchema(source),key=`${databaseId}:${source}`;
  if(ensuredDatabaseSchemas.has(key))return ensuredDatabaseSchemas.get(key);
  const promise=(async()=>{
    const database=await notion(token,`/databases/${databaseId}`,withSignal({},signal));
    database.properties={...(database.properties||{})};
    const expectedTitle=Object.entries(schema.properties).find(([,definition])=>"title" in definition)?.[0];
    if(expectedTitle&&!database.properties[expectedTitle]){
      const currentTitle=Object.entries(database.properties).find(([,property])=>property.type==="title");
      if(!currentTitle)throw new Error(`${schema.label}数据库没有可用的标题属性`);
      const[currentName,currentProperty]=currentTitle;
      await notion(token,`/databases/${databaseId}`,withSignal({method:"PATCH",body:JSON.stringify({properties:{[currentName]:{name:expectedTitle}}})},signal));
      delete database.properties[currentName];
      database.properties[expectedTitle]={...currentProperty,name:expectedTitle,type:"title"};
    }
    const conflicts=Object.entries(schema.properties).flatMap(([name,definition])=>{
      const expected=Object.keys(definition)[0],actual=database.properties[name]?.type;
      return actual&&actual!==expected?[`${name}（应为 ${typeLabel(expected)}，当前为 ${typeLabel(actual)}）`]:[];
    });
    if(conflicts.length)throw new Error(`${schema.label}数据库字段类型不匹配：${conflicts.join("、")}`);
    const missing=Object.fromEntries(Object.entries(schema.properties).filter(([name])=>!database.properties[name]));
    if(Object.keys(missing).length){
      await notion(token,`/databases/${databaseId}`,withSignal({method:"PATCH",body:JSON.stringify({properties:missing})},signal));
      for(const[name,definition]of Object.entries(missing))database.properties[name]={name,type:Object.keys(definition)[0],...definition};
    }
    return database;
  })().catch(error=>{ensuredDatabaseSchemas.delete(key);throw error;});
  ensuredDatabaseSchemas.set(key,promise);
  return promise;
}
function withSignal(init, signal) { return signal ? { ...init, signal } : init; }
function throwIfAborted(signal) { if (signal?.aborted) throw new Error("同步已停止"); }
async function reserveNotionRequest(signal) {
  const previous = notionRequestTail;
  let release;
  notionRequestTail = new Promise((resolve) => { release = resolve; });
  await previous;
  try {
    const delay = Math.max(0, nextRequestAt - Date.now());
    if (delay) await pause(delay, signal);
    nextRequestAt = Date.now() + 350;
  } finally { release(); }
}
async function preloadExistingPages(token, databaseId, items, signal, onProgress) {
  if (items.length < 5) return null;
  const ids = [...new Set(items.map((item) => String(item.externalId || item.url || item.title).slice(0, 1900)))];
  const pages = new Map();
  try {
    await onProgress(0, items.length, `正在批量比对 ${items.length} 条已有记录`);
    for (let offset = 0; offset < ids.length; offset += NOTION_QUERY_BATCH_SIZE) {
      const chunk = ids.slice(offset, offset + NOTION_QUERY_BATCH_SIZE);
      let cursor;
      do {
        const response = await notion(token, `/databases/${databaseId}/query`, withSignal({
          method: "POST",
          body: JSON.stringify({
            filter: { or: chunk.map((id) => ({ property: "外部 ID", rich_text: { equals: id } })) },
            page_size: 100,
            ...(cursor ? { start_cursor: cursor } : {})
          })
        }, signal));
        for (const page of response.results || []) {
          const id = propertyText(page.properties?.["外部 ID"]);
          if (id) pages.set(id, page);
        }
        cursor = response.has_more ? response.next_cursor : null;
      } while (cursor);
    }
    return pages;
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn("Notion 批量比对失败，改用逐条查询", error);
    return null;
  }
}
function pause(milliseconds, signal) { return new Promise((resolve, reject) => { throwIfAborted(signal); const timer=setTimeout(done,milliseconds); function abort(){clearTimeout(timer);reject(new Error("同步已停止"));} function done(){signal?.removeEventListener("abort",abort);resolve();} signal?.addEventListener("abort",abort,{once:true}); }); }
async function timedFetch(url, init, timeoutMs, label, readBody) {
  const parentSignal = init.signal;
  throwIfAborted(parentSignal);
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  parentSignal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await readBody(response);
    return { response, body };
  } catch (error) {
    if (parentSignal?.aborted) throw new Error("同步已停止");
    if (timedOut) throw new Error(`${label}超时，请重试`);
    throw error;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", abort);
  }
}
