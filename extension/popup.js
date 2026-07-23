const $ = (selector) => document.querySelector(selector);
let statusValue = null;
let syncState = null;
let localBusy = false;

// Bind interactions before any network or storage request so the first click is never lost.
document.querySelectorAll("[data-source]").forEach((button) => button.addEventListener("click", () => run(button.dataset.source)));
$("#settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("#upgrade").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("#cancelSync").addEventListener("click", cancelSync);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.syncState) return;
  syncState = changes.syncState.newValue || null;
  renderProgress(syncState);
  updateButtons();
  if (syncState?.status !== "running") loadHistory().catch(() => {});
});
initialize().catch((error) => toast(error.message, true));

async function initialize() {
  statusValue = await send({ type: "STATUS" });
  if (!localBusy) syncState = statusValue.syncState || null;
  renderStatus(statusValue);
  renderProgress(syncState);
  await loadHistory();
}

async function run(source) {
  if (localBusy || syncState?.status === "running") return;
  localBusy = true;
  syncState = { source, status: "running", phase: "checking", completed: 0, total: 0, startedAt: new Date().toISOString() };
  renderProgress(syncState);
  updateButtons();
  toast("");
  try {
    const result = await send({ type: "RUN_SOURCE", source });
    if (!result.ok) throw new Error(result.error || `${result.failed} 条同步失败`);
    toast(`完成 · ${result.succeeded} 条内容`);
    await loadHistory();
  } catch (error) {
    toast(error.message, true);
  } finally {
    localBusy = false;
    const stored = await chrome.storage.local.get("syncState");
    syncState = stored.syncState || syncState;
    renderProgress(syncState);
    updateButtons();
  }
}

function renderStatus(value) {
  const license = $("#licenseStatus"), notion = $("#notionStatus"), active = !!value.access?.active, count = value.notionDatabaseCount || 0;
  license.querySelector("span:last-child").textContent = value.access?.label || "未订阅";
  license.querySelector(".dot").className = `dot ${active ? "ok" : "warn"}`;
  notion.querySelector("span:last-child").textContent = count ? `Notion 已连接 ${count}/${value.notionDatabaseTotal || 7}` : "Notion 待设置";
  notion.querySelector(".dot").className = `dot ${count ? "ok" : ""}`;
  $("#paywallTitle").textContent = value.access?.mode === "expired" ? "7 天完整试用已结束" : "订阅验证暂不可用";
  $("#paywall").classList.toggle("hidden", active);
  updateButtons();
}

function renderProgress(state) {
  const panel = $("#syncProgress"), bar = $("#progressBar");
  if (!state || state.status !== "running") {
    panel.classList.add("hidden");
    bar.classList.remove("indeterminate");
    if (state?.status === "error" && recent(state.finishedAt || state.updatedAt)) toast(state.error || "同步失败", true);
    else if (state?.status === "cancelled" && recent(state.finishedAt || state.updatedAt)) toast("同步已停止，可以重新开始");
    else if (state?.status === "completed" && recent(state.finishedAt || state.updatedAt)) toast(`完成 · ${state.succeeded || state.completed || 0} 条内容`);
    return;
  }
  panel.classList.remove("hidden");
  $("#progressTitle").textContent = `正在同步${label(state.source)}`;
  const hasTotal = Number(state.total) > 0, completed = Number(state.completed) || 0, total = Number(state.total) || 0;
  $("#progressCount").textContent = hasTotal ? `${completed}/${total}` : "";
  $("#progressDetail").textContent = state.detail || ({ checking: "正在验证订阅与 Notion 配置", reading: "正在读取来源内容", writing: "正在写入 Notion，请保持浏览器运行" })[state.phase] || "正在处理";
  bar.classList.toggle("indeterminate", !hasTotal);
  bar.style.width = hasTotal ? `${Math.min(100, Math.round(completed / total * 100))}%` : "38%";
}

async function cancelSync() {
  if (syncState?.status !== "running") return;
  const button = $("#cancelSync");
  button.disabled = true;
  try {
    await send({ type: "CANCEL_SYNC", source: syncState.source });
    localBusy = false;
    syncState = { ...syncState, status: "cancelled", phase: "done", error: "同步已停止，可以重新开始", finishedAt: new Date().toISOString() };
    renderProgress(syncState);
    updateButtons();
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

function updateButtons() {
  const active = !!statusValue?.access?.active;
  const running = localBusy || syncState?.status === "running";
  document.querySelectorAll("[data-source]").forEach((button) => {
    const connected = statusValue ? !!statusValue.notionSources?.[button.dataset.source] : true;
    button.disabled = running || (statusValue ? !active || !connected : false);
  });
}

async function loadHistory() {
  const result = await send({ type: "RECENT" });
  $("#history").innerHTML = result.items?.length ? result.items.map((item) => `<div class="history"><span>${label(item.source)} · ${item.succeeded} 条${item.failed ? ` · 失败 ${item.failed}` : ""}</span><span>${new Date(item.at).toLocaleDateString("zh-CN")}</span></div>`).join("") : "<div class=\"history\"><span>暂无记录</span></div>";
}

function send(payload) { return chrome.runtime.sendMessage(payload); }
function toast(value, error = false) { $("#toast").textContent = value; $("#toast").classList.toggle("error", error); }
function label(value) { return ({ clip: "网页", weread: "微信读书", douban: "豆瓣", weibo: "微博" })[value] || value || "内容"; }
function recent(value) { const time = Date.parse(value || 0); return Number.isFinite(time) && Date.now() - time < 10 * 60 * 1000; }
