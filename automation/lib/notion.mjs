import { syncItems } from "../../extension/lib/notion.js";

export { syncItems };

export async function syncItemsWithRetry(token, databaseId, items, source, options = {}) {
  const syncImpl = options.syncImpl || syncItems;
  const sleepImpl = options.sleepImpl || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const maxRetries = Math.max(0, Number(options.maxRetries ?? 2));
  const results = await syncImpl(token, databaseId, items, source, options.onProgress, options.syncOptions);
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const retryIndexes = results.flatMap((result, index) => !result.ok && isTransientNotionError(result.error) ? [index] : []);
    if (!retryIndexes.length) break;
    await options.onRetry?.({ attempt, maxRetries, count: retryIndexes.length, titles: retryIndexes.map((index) => items[index]?.title || "未命名内容") });
    await sleepImpl(attempt === 1 ? 2000 : 5000);
    const retryItems = retryIndexes.map((index) => items[index]);
    const retryResults = await syncImpl(token, databaseId, retryItems, source, options.onProgress, options.syncOptions);
    retryIndexes.forEach((originalIndex, retryIndex) => { results[originalIndex] = retryResults[retryIndex]; });
  }
  return results;
}

export function isTransientNotionError(value) {
  const message = String(value || "").toLowerCase();
  return /超时|timeout|timed out|fetch failed|network|socket|econnreset|429|rate.?limit|temporar|service.?unavailable|internal.?server|bad gateway|gateway.?timeout|请求失败 \((?:408|409|425|429|5\d\d)\)/i.test(message);
}
