import { createHmac } from "node:crypto";

const DOUBAN_API_KEY = "0dad551ec0f84ed02907ff5c42e8ec70";
const DOUBAN_HMAC_SECRET = "bf7dddc7c9cfe6f7";
const DOUBAN_USER_AGENT = "api-client/1 com.douban.frodo/7.22.0.beta9(231) Android/23 product/Mate40 vendor/HUAWEI model/Mate40 brand/HUAWEI rom/android network/wifi platform/AndroidPad";

export async function getDoubanItems({ userId, authToken, apiHost = "frodo.douban.com" }) {
  const normalizedUserId = normalizeDoubanUserId(userId);
  const items = [];
  for (const type of ["book", "movie"]) for (const status of ["mark", "doing", "done"]) {
    for (let start = 0; start < 2000; start += 50) {
      const path = `/api/v2/user/${encodeURIComponent(normalizedUserId)}/interests`;
      const url = signedDoubanUrl(apiHost, path, { type, status, start: String(start), count: "50" });
      const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": DOUBAN_USER_AGENT, ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || (data.code && Number(data.code) !== 0)) {
        const detail = Number(data.code) === 997 ? "豆瓣接口要求签名，请更新 TunNest" : data.localized_message || data.msg;
        throw new Error(detail || `豆瓣接口失败 (${response.status})`);
      }
      const interests = data.interests || [];
      for (const interest of interests) items.push(normalizeDouban(interest, type));
      if (!interests.length || start + interests.length >= Number(data.total || interests.length)) break;
    }
  }
  return [...new Map(items.map((item) => [`${item.kind}:${item.externalId}`, item])).values()];
}

export function signedDoubanUrl(apiHost, path, params, timestamp = String(Math.floor(Date.now() / 1000))) {
  const payload = `GET&${encodeURIComponent(path)}&${timestamp}`;
  const signature = createHmac("sha1", DOUBAN_HMAC_SECRET).update(payload).digest("base64");
  const url = new URL(`https://${apiHost}${path}`);
  url.search = new URLSearchParams({ ...params, apiKey: DOUBAN_API_KEY, _ts: timestamp, _sig: signature, os_rom: "android" }).toString();
  return url;
}

export function normalizeDoubanUserId(value) {
  if (!value) throw new Error("缺少 DOUBAN_USER_ID");
  const match = String(value).trim().match(/douban\.com\/people\/([^/?#]+)/i);
  const userId = decodeURIComponent(match?.[1] || String(value).trim());
  if (!/^[A-Za-z0-9._-]+$/.test(userId)) throw new Error("DOUBAN_USER_ID 格式不正确");
  return userId;
}

export function normalizeDouban(interest, type) {
  const subject = interest.subject || {};
  const people = type === "book" ? (subject.author || []).map((item) => typeof item === "string" ? item : item.name) : (subject.directors || []).map((item) => item.name);
  const comment = interest.comment || "", externalId = String(subject.id || subject.url || `${type}-${subject.title}`);
  return { source: "douban", kind: type, externalId, title: subject.title || "未命名条目", author: people.filter(Boolean).join(" / "), url: subject.url || `https://${type}.douban.com/subject/${externalId}/`, excerpt: comment || subject.intro || "", content: subject.intro || "", coverUrl: subject.pic?.large || subject.pic?.normal, tags: ["豆瓣", ...(interest.tags || []).map((tag) => tag.name || tag), ...(subject.genres || [])].filter(Boolean), highlights: comment ? [{ text: comment, note: `评分：${interest.rating?.value || "未评分"}` }] : [], capturedAt: interest.create_time || new Date().toISOString(), metadata: { status: interest.status, rating: interest.rating?.value || null, year: subject.year || String(subject.card_subtitle || "").match(/(?:19|20)\d{2}/)?.[0] || "" } };
}
