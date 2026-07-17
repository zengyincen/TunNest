import { PRODUCT } from "../config.js";

const CACHE_MS = 6 * 60 * 60 * 1000;
const OFFLINE_GRACE_MS = 24 * 60 * 60 * 1000;

export async function getInstallationIdentity() {
  const state = await chrome.storage.local.get(["deviceId", "deviceCreatedAt", "trialSubjectId"]);
  const deviceId = state.deviceId || crypto.randomUUID();
  const deviceCreatedAt = state.deviceCreatedAt || new Date().toISOString();
  if (!state.deviceId) await chrome.storage.local.set({ deviceId, deviceCreatedAt });
  let trialSubjectId = state.trialSubjectId;
  try {
    const synced = await chrome.storage.sync.get("trialSubjectId");
    trialSubjectId = synced.trialSubjectId || trialSubjectId || crypto.randomUUID();
    if (!synced.trialSubjectId) await chrome.storage.sync.set({ trialSubjectId });
  } catch {
    trialSubjectId = trialSubjectId || crypto.randomUUID();
  }
  if (!state.trialSubjectId) await chrome.storage.local.set({ trialSubjectId });
  return { deviceId, deviceCreatedAt, trialSubjectId, installationCode: await installationCode(deviceId) };
}

export async function entitlement({ force = false } = {}) {
  const identity = await getInstallationIdentity();
  const state = await chrome.storage.local.get(["licenseKey", "licenseCache"]);
  if (!force && fresh(state.licenseCache)) return { ...state.licenseCache, installationCode: identity.installationCode };

  try {
    const value = state.licenseKey
      ? await paidEntitlement(state.licenseKey, identity)
      : await trialEntitlement(identity);
    await chrome.storage.local.set({ licenseCache: value });
    return { ...value, installationCode: identity.installationCode };
  } catch (error) {
    if (error.code === "TRIAL_EXPIRED" || error.code === "TRIAL_BLOCKED") {
      const value = { active:false, mode:"expired", label:"7 天试用已结束", error:error.message, checkedAt:new Date().toISOString(), installationCode:identity.installationCode };
      await chrome.storage.local.set({ licenseCache:value });
      return value;
    }
    if (canUseOffline(state.licenseCache)) return { ...state.licenseCache, offline:true, label:`${state.licenseCache.label} · 离线宽限`, installationCode:identity.installationCode };
    return { active:false, mode:"invalid", error:error.message, label:"授权服务暂不可用", installationCode:identity.installationCode };
  }
}

export async function activateLicense(licenseKey) {
  const identity = await getInstallationIdentity();
  const value = await paidEntitlement(licenseKey.trim(), identity);
  await chrome.storage.local.set({ licenseKey:licenseKey.trim(), licenseCache:value });
  return value.license;
}

export async function deactivateCurrentDevice() {
  const identity = await getInstallationIdentity();
  const { licenseKey } = await chrome.storage.local.get("licenseKey");
  if (licenseKey) await post("/v1/licenses/deactivate", { licenseKey, deviceId:identity.deviceId });
  await chrome.storage.local.remove(["licenseKey", "licenseCache"]);
}

async function paidEntitlement(licenseKey, identity) {
  const result = await post("/v1/licenses/verify", {
    licenseKey, deviceId:identity.deviceId, clientType:"extension",
    deviceLabel:deviceLabel(), extensionVersion:chrome.runtime.getManifest().version
  });
  return { active:true, mode:"paid", license:result.license, label:planLabel(result.license.plan), checkedAt:new Date().toISOString() };
}

async function trialEntitlement(identity) {
  const result = await post("/v1/trials/verify", { deviceId:identity.deviceId, trialSubjectId:identity.trialSubjectId, extensionVersion:chrome.runtime.getManifest().version });
  const daysLeft=Math.max(1,Math.ceil((Date.parse(result.trial.expiresAt)-Date.now())/86400000));
  return { active:true, mode:"trial", trialEnd:result.trial.expiresAt, label:`试用剩余 ${daysLeft} 天`, checkedAt:new Date().toISOString() };
}

async function post(path, body) {
  if (!/^https:\/\//.test(PRODUCT.licenseApiBase) || PRODUCT.licenseApiBase.includes("example.workers.dev")) throw new RemoteError("许可证服务尚未配置", "SERVICE_NOT_CONFIGURED");
  const response = await fetch(`${PRODUCT.licenseApiBase}${path}`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.valid === false) throw new RemoteError(data.error || "许可证验证失败", data.code || "LICENSE_INVALID");
  return data;
}

function fresh(cache) { return cache?.checkedAt && Date.now() - Date.parse(cache.checkedAt) < CACHE_MS; }
function canUseOffline(cache) {
  if (!cache?.active || !cache.checkedAt || Date.now() - Date.parse(cache.checkedAt) >= OFFLINE_GRACE_MS) return false;
  return cache.mode !== "trial" || (cache.trialEnd && Date.parse(cache.trialEnd) > Date.now());
}
function deviceLabel() {
  const platform = navigator.userAgentData?.platform || navigator.platform || "Browser";
  return `${platform} · 囤囤扩展`;
}
async function installationCode(deviceId) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(deviceId)));
  const value = Array.from(digest.slice(0,6), (byte) => byte.toString(16).padStart(2,"0")).join("").toUpperCase();
  return value.match(/.{1,4}/g).join("-");
}
export function planLabel(plan) { return ({monthly:"月度会员",halfyear:"半年会员",yearly:"年度会员",lifetime:"永久会员"})[plan] || plan; }
class RemoteError extends Error { constructor(message, code) { super(message); this.code=code; } }
