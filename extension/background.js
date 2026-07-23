import { entitlement } from "./lib/license.js";
import { enrichDoubanHostedCovers, enrichMovieCovers } from "./lib/cover-providers.js";
import { DOUBAN_TOP250_TARGETS, fetchAllDoubanTop250 } from "./lib/douban-top250.js";
import { createArchiveDatabase, syncItems, verifyNotion } from "./lib/notion.js";
import { extractCurrentPage, fetchDouban, fetchWeiboDesktopInPage, fetchWeiboInPage, fetchWeread, fetchWereadInPage } from "./lib/sources.js";
const activeRuns = new Map();
const WEIBO_IMAGE_HEADER_RULE_ID = 1001;
const DOUBAN_API_HEADER_RULE_ID = 1002;
const DOUBAN_WEB_HEADER_RULE_ID = 1003;
const DOUBAN_DATABASE_SOURCES = ["douban", ...DOUBAN_TOP250_TARGETS.map((target) => target.source)];
let remoteHeadersReady = installRemoteHeaderRules().catch(logHeaderRuleError);

chrome.runtime.onInstalled.addListener(async () => {
  remoteHeadersReady = installRemoteHeaderRules().catch(logHeaderRuleError);
  await remoteHeadersReady;
  chrome.contextMenus.create({ id: "clip-page", title: "保存到囤囤 TunNest", contexts: ["page", "selection"] });
  chrome.alarms.create("daily-sync", { periodInMinutes: 1440 });
});
chrome.contextMenus.onClicked.addListener((_info, tab) => tab?.id && startSource("clip", tab.id).catch(() => {}));
chrome.commands.onCommand.addListener((command) => command === "clip-page" && activeTab().then((tab) => tab?.id && startSource("clip", tab.id)));
chrome.alarms.onAlarm.addListener((alarm) => alarm.name === "daily-sync" && runConfiguredSources().catch(() => {}));

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  const task = ({
    STATUS: () => status(),
    RUN_SOURCE: () => startSource(message.source),
    CANCEL_SYNC: () => cancelSync(message.source),
    SAVE_SETTINGS: () => saveSettings(message.settings),
    SETUP_NOTION: () => setupNotion(message),
    RECENT: () => recent(),
  })[message.type];
  if (!task) return false;
  task().then(respond).catch((error) => respond({ ok: false, error: error.message })); return true;
});

function startSource(source, tabId) {
  if (activeRuns.has(source)) return activeRuns.get(source).promise;
  const controller = new AbortController();
  const run = { controller, runId: crypto.randomUUID(), promise: null };
  run.promise = runSource(source, tabId, controller.signal, run.runId).finally(() => {
    if (activeRuns.get(source) === run) activeRuns.delete(source);
  });
  activeRuns.set(source, run);
  const { promise } = run;
  return promise;
}

async function runSource(source, tabId, signal, runId) {
  const startedAt = new Date().toISOString();
  await setSyncState({ source, runId, status: "running", phase: "checking", completed: 0, total: 0, startedAt, updatedAt: startedAt });
  try {
    const access = await entitlement(); if (!access.active) throw new Error(access.error || "需要有效订阅才能同步");
    if (source === "weibo" || source === "douban") await remoteHeadersReady.catch((error) => console.warn("远程请求头规则初始化失败", error));
    const settings = await chrome.storage.local.get(["notionToken", "notionDatabaseIds", "notionDatabaseId", "wereadApiKey", "doubanUserId", "doubanAuthToken", "doubanImageProvider", "movieCoverProvider", "tmdbAccessToken", "tmdbCoverCache", "weiboUids", "weiboPages"]);
    const databaseIds = databaseMap(settings), databaseId = databaseIds[source];
    if (!settings.notionToken) throw new Error("请先填写 Notion Integration Token");
    if (source === "douban") {
      const missing = DOUBAN_DATABASE_SOURCES.filter((target) => !databaseIds[target]);
      if (missing.length) throw new Error(`请先连接${missing.map(sourceLabel).join("、")}数据库`);
    } else if (!databaseId) throw new Error(`请先连接${sourceLabel(source)}数据库`);
    await updateSyncState({ phase: "reading" }, runId);
    let batches;
    if (source === "clip") {
      const targetId = tabId || (await activeTab())?.id; if (!targetId) throw new Error("没有可剪藏的页面");
      const result = await chrome.scripting.executeScript({ target: { tabId: targetId }, func: extractCurrentPage }); batches = [{ target: source, items: [result[0].result] }];
    } else if (source === "weread") batches = [{ target: source, items: settings.wereadApiKey ? await fetchWeread(settings.wereadApiKey) : await fetchWereadFromLoggedInTab() }];
    else if (source === "douban") {
      const userItems = await fetchDouban(settings);
      const top250 = await fetchAllDoubanTop250({
        signal,
        onProgress: ({ label, completedPages, totalPages }) => updateSyncState({ detail: `正在读取豆瓣${label} Top 250 · ${completedPages + 1}/${totalPages} 页` }, runId)
      });
      batches = [{ target: "douban", items: userItems }, ...DOUBAN_TOP250_TARGETS.map(({ source: target }) => ({ target, items: top250[target] }))];
      for (const batch of batches) {
        const hosted = await enrichDoubanHostedCovers(batch.items, {
          provider: settings.doubanImageProvider,
          signal,
          onStatus: (detail) => updateSyncState({ detail }, runId)
        });
        batch.items = hosted.items;
      }
      if ((settings.movieCoverProvider || "douban") !== "douban") {
        let cache = settings.tmdbCoverCache || {};
        for (const batch of batches.filter((entry) => entry.target === "douban" || entry.target === "doubanMovieTop250")) {
          const enriched = await enrichMovieCovers(batch.items, {
            provider: settings.movieCoverProvider,
            tmdbAccessToken: settings.tmdbAccessToken,
            cache,
            signal,
            onProgress: ({ completed, total, matched }) => updateSyncState({ detail: `正在匹配 TMDB 海报 · ${completed}/${total} · 已匹配 ${matched}` }, runId)
          });
          batch.items = enriched.items;
          cache = enriched.cache;
        }
        await chrome.storage.local.set({ tmdbCoverCache: cache });
      }
    }
    else if (source === "weibo") batches = [{ target: source, items: await fetchWeiboFromLoggedInTab(settings) }];
    else throw new Error("未知同步来源");
    if (signal.aborted) throw new Error("同步已停止");
    const total = batches.reduce((sum, batch) => sum + batch.items.length, 0), results = [];
    await updateSyncState({ phase: "writing", completed: 0, total }, runId);
    let offset = 0;
    for (const batch of batches) {
      const batchResults = await syncItems(
        settings.notionToken,
        databaseIds[batch.target],
        batch.items,
        batch.target,
        (completed, _batchTotal, detail) => updateSyncState({ completed: offset + completed, total, detail: `${sourceLabel(batch.target)} · ${detail}` }, runId),
        { signal }
      );
      results.push(...batchResults);
      offset += batch.items.length;
    }
    const succeeded = results.filter((item) => item.ok).length, failed = results.length - succeeded;
    const error = failed ? results.find((item) => !item.ok)?.error : undefined;
    const finishedAt = new Date().toISOString();
    await addHistory({ source, succeeded, failed, error, at: finishedAt });
    await updateSyncState({ status: failed ? "error" : "completed", phase: "done", completed: total, total, succeeded, failed, error, finishedAt }, runId);
    return { ok: failed === 0, count: total, succeeded, failed, error };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const stopped = signal.aborted;
    const message = stopped ? "同步已停止，可以重新开始" : error.message;
    if (!stopped) await addHistory({ source, succeeded: 0, failed: 1, error: message, at: finishedAt });
    await updateSyncState({ status: stopped ? "cancelled" : "error", phase: "done", error: message, detail: "", finishedAt }, runId);
    throw new Error(message);
  }
}

async function cancelSync(source) {
  const running = activeRuns.get(source);
  if (running) {
    running.controller.abort();
    activeRuns.delete(source);
  }
  const finishedAt = new Date().toISOString();
  await updateSyncState({ source, status: "cancelled", phase: "done", error: "同步已停止，可以重新开始", detail: "", finishedAt });
  return { ok: true };
}

function installRemoteHeaderRules() {
  return chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [WEIBO_IMAGE_HEADER_RULE_ID, DOUBAN_API_HEADER_RULE_ID, DOUBAN_WEB_HEADER_RULE_ID, 1004],
    addRules: [{
      id: WEIBO_IMAGE_HEADER_RULE_ID,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "Referer", operation: "set", value: "https://weibo.com/" },
          { header: "Origin", operation: "remove" }
        ]
      },
      condition: {
        initiatorDomains: [chrome.runtime.id],
        requestDomains: ["sinaimg.cn"],
        resourceTypes: ["xmlhttprequest"]
      }
    }, {
      id: DOUBAN_API_HEADER_RULE_ID,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [{
          header: "User-Agent",
          operation: "set",
          value: "api-client/1 com.douban.frodo/7.22.0.beta9(231) Android/23 product/Mate40 vendor/HUAWEI model/Mate40 brand/HUAWEI rom/android network/wifi platform/AndroidPad"
        }]
      },
      condition: {
        initiatorDomains: [chrome.runtime.id],
        requestDomains: ["frodo.douban.com"],
        resourceTypes: ["xmlhttprequest"]
      }
    }, {
      id: DOUBAN_WEB_HEADER_RULE_ID,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [{
          header: "User-Agent",
          operation: "set",
          value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138.0 Safari/537.36"
        }]
      },
      condition: {
        initiatorDomains: [chrome.runtime.id],
        requestDomains: ["movie.douban.com", "book.douban.com", "music.douban.com"],
        resourceTypes: ["xmlhttprequest"]
      }
    }]
  });
}
function logHeaderRuleError(error) { console.warn("远程请求头规则初始化失败", error); }

async function runConfiguredSources() { const settings=await chrome.storage.local.get(["notionDatabaseIds","notionDatabaseId"]),ids=databaseMap(settings); for (const source of ["weread", "douban"]) if(source==="douban"?DOUBAN_DATABASE_SOURCES.every(target=>ids[target]):ids[source]) try { await startSource(source); } catch { /* runSource already records the failure. */ } }
async function fetchWereadFromLoggedInTab() {
  const tabs = await chrome.tabs.query({ url: ["https://weread.qq.com/*"] });
  let tab = newestTab(tabs);
  if (!tab?.id) tab = await chrome.tabs.create({ url: "https://weread.qq.com/", active: true });
  if (tab.status !== "complete") await waitForTab(tab.id, "微信读书页面加载超时");
  try {
    const injected = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", func: fetchWereadInPage });
    const result = injected?.[0]?.result || { ok: false, error: "微信读书页面未返回同步结果" };
    if (result.ok) return result.items || [];
    await chrome.tabs.update(tab.id, { active: true });
    throw new Error(`${result.error || "微信读书读取失败"}。请在打开的微信读书页面登录后重试，或在设置中填写 Gateway API Key。`);
  } catch (error) {
    await chrome.tabs.update(tab.id, { active: true });
    if (/Gateway API Key/.test(error.message)) throw error;
    throw new Error(`无法读取微信读书页面：${error.message}。请确认页面已登录，或在设置中填写 Gateway API Key。`);
  }
}
async function fetchWeiboFromLoggedInTab(settings) {
  const uids = String(settings.weiboUids || "").split(/[,，\s]+/).filter(Boolean);
  if (!uids.length) throw new Error("请先在设置中填写微博用户 UID");
  const pages = Math.min(Number(settings.weiboPages) || 2, 10);
  const desktopTabs = await chrome.tabs.query({ url: ["https://weibo.com/*"] });
  let tab = newestTab(desktopTabs);
  if (!tab?.id) tab = await chrome.tabs.create({ url: `https://weibo.com/u/${encodeURIComponent(uids[0])}`, active: true });
  if (tab.status !== "complete") await waitForTab(tab.id);
  const desktopResult = await runWeiboPageFunction(tab.id, fetchWeiboDesktopInPage, uids, pages);
  if (desktopResult?.ok) return desktopResult.items || [];

  const mobileTabs = await chrome.tabs.query({ url: ["https://m.weibo.cn/*"] });
  const mobileTab = newestTab(mobileTabs);
  let mobileResult;
  if (mobileTab?.id) mobileResult = await runWeiboPageFunction(mobileTab.id, fetchWeiboInPage, uids, pages);
  if (mobileResult?.ok) return mobileResult.items || [];

  await chrome.tabs.update(tab.id, { active: true });
  const desktopError = desktopResult?.error || "桌面微博未返回同步结果";
  const mobileError = mobileResult?.error ? `；移动接口：${mobileResult.error}` : "";
  const riskControlled = [desktopResult?.status, mobileResult?.status].includes(432);
  const advice = riskControlled
    ? "请在打开的微博页面完成验证，等待一段时间后再试。"
    : "请确认该主页能正常显示博文，并已登录桌面版微博后再试。";
  throw new Error(`${desktopError}${mobileError}。${advice}`);
}
function newestTab(tabs) { return tabs.find((item) => item.active) || tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0]; }
async function runWeiboPageFunction(tabId, func, uids, pages) {
  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func,
      args: [uids, pages]
    });
    return injected?.[0]?.result || { ok: false, error: "微博页面未返回同步结果" };
  } catch (error) {
    return { ok: false, error: `无法访问微博页面：${error.message}` };
  }
}
function waitForTab(tabId, timeoutMessage = "微博页面加载超时") {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); reject(new Error(timeoutMessage)); }, 15000);
    const listener = (updatedId, changeInfo) => {
      if (updatedId !== tabId || changeInfo.status !== "complete") return;
      clearTimeout(timeout); chrome.tabs.onUpdated.removeListener(listener); resolve();
    };
  });
}
async function status() { const access = await entitlement(); const settings = await chrome.storage.local.get(["notionToken", "notionDatabaseIds", "notionDatabaseId", "syncState"]),ids=databaseMap(settings),targets=["clip","weread",...DOUBAN_DATABASE_SOURCES,"weibo"],notionSources=Object.fromEntries(["clip","weread","douban","weibo"].map(source=>[source,!!(settings.notionToken&&(source==="douban"?DOUBAN_DATABASE_SOURCES.every(target=>ids[target]):ids[source]))])),notionDatabaseCount=targets.filter(target=>settings.notionToken&&ids[target]).length,notionDatabaseTotal=targets.length,syncState=normalizeSyncState(settings.syncState);if(settings.syncState?.status==="running"&&syncState?.status!=="running")await setSyncState(syncState);return { ok: true, access, notionConnected:notionDatabaseCount>0, notionDatabaseCount, notionDatabaseTotal, notionSources, syncState }; }
async function saveSettings(settings) { const allowed = ["wereadApiKey", "doubanUserId", "doubanAuthToken", "doubanImageProvider", "movieCoverProvider", "tmdbAccessToken", "weiboUids", "weiboPages"]; await chrome.storage.local.set(Object.fromEntries(allowed.filter((key) => key in settings).map((key) => [key, settings[key]]))); return { ok: true }; }
async function setupNotion(message) { const source=message.source;if(!["clip","weread","douban","doubanMovieTop250","doubanBookTop250","doubanMusicTop250","weibo"].includes(source))throw new Error("未知 Notion 数据库类型");if (!message.notionToken) throw new Error("缺少 Notion Token"); let databaseId = message.databaseId; if (!databaseId) databaseId = await createArchiveDatabase(message.notionToken, message.parentPage,source); const database = await verifyNotion(message.notionToken, databaseId,source),stored=await chrome.storage.local.get("notionDatabaseIds"),notionDatabaseIds={...(stored.notionDatabaseIds||{}),[source]:database.id}; await chrome.storage.local.set({ notionToken: message.notionToken, notionDatabaseIds }); return { ok: true, database }; }
async function addHistory(entry) { const { syncHistory = [] } = await chrome.storage.local.get("syncHistory"); await chrome.storage.local.set({ syncHistory: [entry, ...syncHistory].slice(0, 30) }); }
async function recent() { const { syncHistory = [] } = await chrome.storage.local.get("syncHistory"); return { ok: true, items: syncHistory.slice(0, 8) }; }
async function setSyncState(syncState) { await chrome.storage.local.set({ syncState }); }
async function updateSyncState(patch, runId) { const { syncState = {} } = await chrome.storage.local.get("syncState"); if(runId&&syncState.runId!==runId)return;await setSyncState({ ...syncState, ...patch, updatedAt: new Date().toISOString() }); }
function normalizeSyncState(value) { if (!value || value.status !== "running") return value || null; const age=Date.now()-Date.parse(value.updatedAt||value.startedAt||0),running=activeRuns.get(value.source),missingRun=!running||running.runId!==value.runId; return missingRun||age>2*60*1000?{...value,status:"error",phase:"done",detail:"",error:"上次同步已中断，请重新运行",finishedAt:new Date().toISOString()}:value; }
async function activeTab() { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); return tab; }
function databaseMap(settings){const ids={...(settings.notionDatabaseIds||{})};if(!ids.clip&&settings.notionDatabaseId)ids.clip=settings.notionDatabaseId;return ids;}
function sourceLabel(source){return({clip:"网页剪藏",weread:"微信读书",douban:"豆瓣用户",doubanMovieTop250:"电影 Top 250",doubanBookTop250:"图书 Top 250",doubanMusicTop250:"音乐 Top 250",weibo:"微博"})[source]||source;}
