import { entitlement } from "./lib/license.js";
import { createArchiveDatabase, syncItems, verifyNotion } from "./lib/notion.js";
import { extractCurrentPage, fetchDouban, fetchWeibo, fetchWeread } from "./lib/sources.js";

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.create({ id: "clip-page", title: "保存到囤囤 TunNest", contexts: ["page", "selection"] });
  chrome.alarms.create("daily-sync", { periodInMinutes: 1440 });
});
chrome.contextMenus.onClicked.addListener((_info, tab) => tab?.id && runSource("clip", tab.id).catch(() => {}));
chrome.commands.onCommand.addListener((command) => command === "clip-page" && activeTab().then((tab) => tab?.id && runSource("clip", tab.id)));
chrome.alarms.onAlarm.addListener((alarm) => alarm.name === "daily-sync" && runConfiguredSources().catch(() => {}));

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  const task = ({
    STATUS: () => status(),
    RUN_SOURCE: () => runSource(message.source),
    SAVE_SETTINGS: () => saveSettings(message.settings),
    SETUP_NOTION: () => setupNotion(message),
    RECENT: () => recent(),
  })[message.type];
  if (!task) return false;
  task().then(respond).catch((error) => respond({ ok: false, error: error.message })); return true;
});

async function runSource(source, tabId) {
  const access = await entitlement(); if (!access.active) throw new Error(access.error || "需要有效订阅才能同步");
  const settings = await chrome.storage.local.get(["notionToken", "notionDatabaseId", "doubanUserId", "doubanApiKey", "doubanAuthToken", "weiboUids", "weiboPages"]);
  if (!settings.notionToken || !settings.notionDatabaseId) throw new Error("请先连接 Notion");
  let items;
  if (source === "clip") {
    const targetId = tabId || (await activeTab())?.id; if (!targetId) throw new Error("没有可剪藏的页面");
    const result = await chrome.scripting.executeScript({ target: { tabId: targetId }, func: extractCurrentPage }); items = [result[0].result];
  } else if (source === "weread") items = await fetchWeread();
  else if (source === "douban") items = await fetchDouban(settings);
  else if (source === "weibo") items = await fetchWeibo(settings);
  else throw new Error("未知同步来源");
  const results = await syncItems(settings.notionToken, settings.notionDatabaseId, items);
  const succeeded = results.filter((item) => item.ok).length, failed = results.length - succeeded;
  await addHistory({ source, succeeded, failed, at: new Date().toISOString() });
  return { ok: failed === 0, count: items.length, succeeded, failed, error: failed ? results.find((item) => !item.ok)?.error : undefined };
}

async function runConfiguredSources() { for (const source of ["weread", "douban", "weibo"]) try { await runSource(source); } catch (error) { await addHistory({ source, succeeded: 0, failed: 1, error: error.message, at: new Date().toISOString() }); } }
async function status() { const access = await entitlement(); const settings = await chrome.storage.local.get(["notionToken", "notionDatabaseId"]); return { ok: true, access, notionConnected: !!(settings.notionToken && settings.notionDatabaseId) }; }
async function saveSettings(settings) { const allowed = ["doubanUserId", "doubanApiKey", "doubanAuthToken", "weiboUids", "weiboPages"]; await chrome.storage.local.set(Object.fromEntries(allowed.filter((key) => key in settings).map((key) => [key, settings[key]]))); return { ok: true }; }
async function setupNotion(message) { if (!message.notionToken) throw new Error("缺少 Notion Token"); let databaseId = message.databaseId; if (!databaseId) databaseId = await createArchiveDatabase(message.notionToken, message.parentPage); const database = await verifyNotion(message.notionToken, databaseId); await chrome.storage.local.set({ notionToken: message.notionToken, notionDatabaseId: database.id }); return { ok: true, database }; }
async function addHistory(entry) { const { syncHistory = [] } = await chrome.storage.local.get("syncHistory"); await chrome.storage.local.set({ syncHistory: [entry, ...syncHistory].slice(0, 30) }); }
async function recent() { const { syncHistory = [] } = await chrome.storage.local.get("syncHistory"); return { ok: true, items: syncHistory.slice(0, 8) }; }
async function activeTab() { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); return tab; }
