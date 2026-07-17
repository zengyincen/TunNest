import { PRODUCT } from "./config.js";
import { activateLicense, deactivateCurrentDevice, entitlement } from "./lib/license.js";

const $ = (selector) => document.querySelector(selector);
const keys = ["licenseKey","notionToken","notionDatabaseId","doubanUserId","doubanApiKey","doubanAuthToken","weiboUids","weiboPages"];
const stored = await chrome.storage.local.get(keys);
for (const key of ["licenseKey","notionToken","doubanUserId","doubanApiKey","doubanAuthToken","weiboUids","weiboPages"]) if ($(`#${key}`)) $(`#${key}`).value = stored[key] || $(`#${key}`).value || "";
$("#databaseId").value = stored.notionDatabaseId || "";
renderPlans();
await renderEntitlement();

$("#activate").addEventListener("click", async () => {
  setToast("license", "正在在线验证…");
  try { await activateLicense($("#licenseKey").value); setToast("license", "激活成功"); await renderEntitlement(); }
  catch (error) { setToast("license", error.message, true); }
});

$("#deactivateDevice").addEventListener("click", async () => {
  if (!confirm("释放后，本机需要重新输入许可证才能使用付费功能。继续吗？")) return;
  try { await deactivateCurrentDevice(); $("#licenseKey").value=""; await renderEntitlement(); setToast("license","本机授权已释放"); }
  catch (error) { setToast("license",error.message,true); }
});

$("#installationCode").addEventListener("click", () => navigator.clipboard.writeText($("#installationCode").textContent));
$("#connectNotion").addEventListener("click", async () => {
  setToast("notion", "正在连接…");
  const result = await chrome.runtime.sendMessage({ type:"SETUP_NOTION", notionToken:$("#notionToken").value.trim(), parentPage:$("#parentPage").value.trim(), databaseId:$("#databaseId").value.trim() });
  if (result.ok) { $("#databaseId").value=result.database.id; setToast("notion",`已连接 ${result.database.title}`); }
  else setToast("notion",result.error,true);
});
$("#saveSources").addEventListener("click", async () => {
  const settings=Object.fromEntries(["doubanUserId","doubanApiKey","doubanAuthToken","weiboUids","weiboPages"].map((key)=>[key,$(`#${key}`).value.trim()]));
  const result=await chrome.runtime.sendMessage({type:"SAVE_SETTINGS",settings}); setToast("source",result.ok?"设置已保存":result.error,!result.ok);
});

async function renderEntitlement() {
  const value=await entitlement({force:true});
  $("#installationCode").textContent=value.installationCode;
  $("#deactivateDevice").classList.toggle("hidden",value.mode!=="paid");
  const detail=value.license?.expiresAt ? `有效期至 ${new Date(value.license.expiresAt).toLocaleDateString("zh-CN")}` : value.mode==="trial" ? `完整试用至 ${new Date(value.trialEnd).toLocaleDateString("zh-CN")}` : value.mode==="paid" ? "永久更新 · 优先客服" : "同步已暂停，购买后立即恢复";
  $("#entitlement").innerHTML=`<div class="top-row"><div><b>${value.label}</b><div class="hint">${detail}</div></div><span class="badge">${value.active?"可用":"需订阅"}</span></div>`;
}
function renderPlans() {
  $("#plans").innerHTML=PRODUCT.plans.map((plan)=>`<div class="plan ${plan.id==="yearly"?"featured":""}"><div class="plan-name">${plan.name}</div><div class="price">${plan.price}</div><div class="hint">完整同步<br>${PRODUCT.browserDeviceLimit} 台浏览器设备<br>${PRODUCT.actionsLimit} 个 GitHub Actions 槽位<br>后续更新 · 优先客服</div><button class="${plan.id==="yearly"?"blue":""}" data-buy="${plan.checkoutUrl}">选择</button></div>`).join("");
  document.querySelectorAll("[data-buy]").forEach((button)=>button.addEventListener("click",()=>chrome.tabs.create({url:button.dataset.buy})));
}
function setToast(prefix,value,error=false){const node=$(`#${prefix}Toast`);node.textContent=value;node.classList.toggle("error",error);}
