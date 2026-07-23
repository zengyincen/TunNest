type Env = WorkerBindings & { ADMIN_TOKEN: string };
const encoder = new TextEncoder();
const PLAN_DAYS: Record<string, number | null> = { monthly: 31, halfyear: 183, yearly: 366, lifetime: null };
const TRIAL_DAYS = 7;
const ACTIONS_LIMIT = 1;

export default { async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method === "OPTIONS") return withCors(new Response(null, { status: 204 }), env);
  try { return withCors(await route(request, env, ctx), env); }
  catch (error) { const status = error instanceof HttpError ? error.status : 500; if (status === 500) console.error(error); return withCors(json({ valid: false, error: error instanceof Error ? error.message : "服务器错误", ...(error instanceof HttpError ? error.detail || {} : {}) }, status), env); }
} };

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url); const path = url.pathname.replace(/\/+$/, "");
  if (path === "/v1/health" && request.method === "GET") return json({ ok: true, service: "tunnest-license", time: new Date().toISOString() });
  if (path === "/v1/images/douban" && request.method === "GET") return doubanImage(request, ctx);
  if (path === "/v1/licenses/verify" && request.method === "POST") return verify(request, env);
  if (path === "/v1/licenses/deactivate" && request.method === "POST") return deactivate(request, env);
  if (path === "/v1/trials/verify" && request.method === "POST") return verifyTrial(request, env);
  if (path === "/v1/admin/licenses" && request.method === "POST") { requireAdmin(request, env); return issue(request, env); }
  if (path.startsWith("/v1/admin/licenses/") && request.method === "PATCH") { requireAdmin(request, env); return update(request, env, path.split("/").pop()!); }
  throw new HttpError(404, "接口不存在");
}

async function doubanImage(request: Request, ctx: ExecutionContext): Promise<Response> {
  const value = new URL(request.url).searchParams.get("url") || "";
  let source: URL;
  try { source = new URL(value); } catch { throw new HttpError(400, "豆瓣图片地址无效"); }
  if (source.protocol !== "https:" || !/(^|\.)doubanio\.com$/i.test(source.hostname) || source.href.length > 2000) throw new HttpError(400, "仅支持豆瓣图片地址");
  const cache = caches.default;
  const cacheKey = new Request(request.url, { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;
  const upstream = await fetch(source.href, {
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      Referer: "https://www.douban.com/",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138.0 Safari/537.36"
    }
  });
  if (!upstream.ok) throw new HttpError(502, `豆瓣图片获取失败 (${upstream.status})`);
  const contentType = upstream.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().startsWith("image/")) throw new HttpError(502, "豆瓣返回的不是图片");
  const contentLength = Number(upstream.headers.get("Content-Length")) || 0;
  if (contentLength > 20 * 1024 * 1024) throw new HttpError(413, "豆瓣图片超过 20MB 限制");
  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=2592000, s-maxage=2592000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*"
  });
  const etag = upstream.headers.get("ETag"); if (etag) headers.set("ETag", etag);
  const response = new Response(upstream.body, { status: 200, headers });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

async function verify(request: Request, env: Env): Promise<Response> {
  const body = await readBody(request); const licenseKey = str(body.licenseKey), deviceId = str(body.deviceId);
  if (!licenseKey || !deviceId) throw new HttpError(400, "缺少许可证或设备 ID");
  const clientType = str(body.clientType) === "github-actions" ? "github-actions" : "extension";
  const deviceLabel = str(body.deviceLabel).slice(0, 80) || null;
  const row = await env.DB.prepare("SELECT * FROM licenses WHERE key_hash=?1").bind(await sha256(licenseKey)).first<any>();
  if (!row) throw new HttpError(404, "许可证不存在");
  if (row.status !== "active") throw new HttpError(403, row.status === "revoked" ? "许可证已撤销" : "许可证已暂停");
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) throw new HttpError(403, "许可证已过期");
  const deviceHash = await sha256(deviceId); const existing = await env.DB.prepare("SELECT id FROM activations WHERE license_id=?1 AND device_hash=?2").bind(row.id, deviceHash).first();
  if (!existing) {
    const count = await env.DB.prepare("SELECT COUNT(*) count FROM activations WHERE license_id=?1 AND client_type=?2").bind(row.id, clientType).first<{count:number}>();
    const limit = clientType === "github-actions" ? ACTIONS_LIMIT : row.device_limit;
    if ((count?.count || 0) >= limit) throw new HttpError(403, clientType === "github-actions" ? "该许可证已绑定其他 GitHub Actions 仓库" : "已达到浏览器设备数量上限");
    await env.DB.prepare("INSERT INTO activations(id,license_id,device_hash,extension_version,client_type,device_label) VALUES(?1,?2,?3,?4,?5,?6)").bind(id("act_"),row.id,deviceHash,str(body.extensionVersion)||null,clientType,deviceLabel).run();
  } else await env.DB.prepare("UPDATE activations SET last_seen_at=CURRENT_TIMESTAMP,extension_version=?1,device_label=COALESCE(?2,device_label) WHERE license_id=?3 AND device_hash=?4").bind(str(body.extensionVersion)||null,deviceLabel,row.id,deviceHash).run();
  return json({ valid: true, license: { id: row.id, customerId: row.customer_id, plan: row.plan, expiresAt: row.expires_at, supportPriority: !!row.support_priority, browserDeviceLimit: row.device_limit, actionsLimit: ACTIONS_LIMIT }, clientType });
}

async function verifyTrial(request: Request, env: Env): Promise<Response> {
  const body = await readBody(request); const deviceId = str(body.deviceId), trialSubjectId = str(body.trialSubjectId);
  if (!deviceId || !trialSubjectId) throw new HttpError(400, "缺少安装设备码或试用标识");
  const deviceHash = await sha256(deviceId), subjectHash = await sha256(trialSubjectId);
  let row = await env.DB.prepare("SELECT * FROM trials WHERE subject_hash=?1").bind(subjectHash).first<any>();
  if (!row) {
    const startedAt = new Date(); const expiresAt = new Date(startedAt.getTime() + TRIAL_DAYS * 86400000);
    await env.DB.prepare("INSERT INTO trials(id,subject_hash,device_hash,extension_version,started_at,expires_at) VALUES(?1,?2,?3,?4,?5,?6)").bind(id("tri_"),subjectHash,deviceHash,str(body.extensionVersion)||null,startedAt.toISOString(),expiresAt.toISOString()).run();
    row = { status:"active", started_at:startedAt.toISOString(), expires_at:expiresAt.toISOString() };
  } else {
    await env.DB.prepare("UPDATE trials SET last_seen_at=CURRENT_TIMESTAMP,extension_version=?1,device_hash=?2 WHERE subject_hash=?3").bind(str(body.extensionVersion)||null,deviceHash,subjectHash).run();
  }
  if (row.status !== "active") throw new HttpError(403, "该设备试用已停用", { code:"TRIAL_BLOCKED" });
  if (Date.parse(row.expires_at) <= Date.now()) throw new HttpError(403, "7 天完整试用已结束，请选择订阅方案", { code:"TRIAL_EXPIRED", trialExpired:true, expiresAt:row.expires_at });
  return json({ valid:true, trial:{ startedAt:row.started_at, expiresAt:row.expires_at, days:TRIAL_DAYS, fullAccess:true } });
}

async function deactivate(request: Request, env: Env): Promise<Response> {
  const body=await readBody(request); const licenseKey=str(body.licenseKey),deviceId=str(body.deviceId);
  if(!licenseKey||!deviceId)throw new HttpError(400,"缺少许可证或设备 ID");
  const license=await env.DB.prepare("SELECT id FROM licenses WHERE key_hash=?1").bind(await sha256(licenseKey)).first<{id:string}>();
  if(!license)throw new HttpError(404,"许可证不存在");
  await env.DB.prepare("DELETE FROM activations WHERE license_id=?1 AND device_hash=?2 AND client_type='extension'").bind(license.id,await sha256(deviceId)).run();
  return json({ok:true});
}

async function issue(request: Request, env: Env): Promise<Response> {
  const body = await readBody(request); const plan = str(body.plan); if (!(plan in PLAN_DAYS)) throw new HttpError(400, "套餐无效");
  const customerId = str(body.customerId); if (!customerId) throw new HttpError(400, "缺少 customerId");
  const licenseKey = `tunnest_${random(32)}`; const startsAt = new Date(); const days = PLAN_DAYS[plan]; const expiresAt = days ? new Date(startsAt.getTime() + days * 86400000).toISOString() : null; const licenseId = id("lic_");
  await env.DB.prepare("INSERT INTO licenses(id,key_hash,customer_id,plan,starts_at,expires_at,device_limit,support_priority,note) VALUES(?1,?2,?3,?4,?5,?6,?7,1,?8)").bind(licenseId,await sha256(licenseKey),customerId,plan,startsAt.toISOString(),expiresAt,Math.min(Math.max(Number(body.deviceLimit)||3,1),10),str(body.note)||null).run();
  await audit(env,"license.issued",licenseId,{customerId,plan,expiresAt}); return json({ ok:true, licenseKey, license:{ id:licenseId,customerId,plan,expiresAt } },201);
}

async function update(request: Request, env: Env, licenseId: string): Promise<Response> {
  const body=await readBody(request); const status=str(body.status); if(status&&!['active','suspended','revoked'].includes(status))throw new HttpError(400,"状态无效");
  const current=await env.DB.prepare("SELECT * FROM licenses WHERE id=?1").bind(licenseId).first<any>(); if(!current)throw new HttpError(404,"许可证不存在");
  let expiresAt=current.expires_at; if(body.extendDays)expiresAt=new Date(Math.max(Date.now(),expiresAt?Date.parse(expiresAt):Date.now())+Number(body.extendDays)*86400000).toISOString();
  await env.DB.prepare("UPDATE licenses SET status=?1,expires_at=?2,device_limit=?3,updated_at=CURRENT_TIMESTAMP WHERE id=?4").bind(status||current.status,expiresAt,body.deviceLimit?Math.min(Math.max(Number(body.deviceLimit),1),10):current.device_limit,licenseId).run();
  if(body.clearDevices===true)await env.DB.prepare("DELETE FROM activations WHERE license_id=?1").bind(licenseId).run(); await audit(env,"license.updated",licenseId,{status,expiresAt}); return json({ok:true});
}

function requireAdmin(request:Request,env:Env){if(!env.ADMIN_TOKEN||request.headers.get("Authorization")!==`Bearer ${env.ADMIN_TOKEN}`)throw new HttpError(401,"管理员认证失败");}
async function readBody(request:Request):Promise<Record<string,any>>{if(!(request.headers.get("content-type")||"").includes("application/json"))throw new HttpError(415,"仅支持 JSON");return request.json();}
async function sha256(value:string):Promise<string>{const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(value)));return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");}
function random(length:number){const chars="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";return Array.from(crypto.getRandomValues(new Uint8Array(length)),b=>chars[b%chars.length]).join("");}
function id(prefix=""){return prefix+crypto.randomUUID().replace(/-/g,"");}
function str(value:unknown){return typeof value==="string"?value.trim():"";}
function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json;charset=utf-8","Cache-Control":"no-store"}});}
function withCors(response:Response,env:Env){const headers=new Headers(response.headers);headers.set("Access-Control-Allow-Origin",env.ALLOWED_ORIGIN||"*");headers.set("Access-Control-Allow-Headers","Content-Type,Authorization");headers.set("Access-Control-Allow-Methods","GET,POST,PATCH,OPTIONS");return new Response(response.body,{status:response.status,headers});}
async function audit(env:Env,action:string,licenseId:string,detail:unknown){await env.DB.prepare("INSERT INTO audit_logs(id,action,license_id,detail_json) VALUES(?1,?2,?3,?4)").bind(id("aud_"),action,licenseId,JSON.stringify(detail)).run();}
class HttpError extends Error{constructor(public status:number,message:string,public detail?:Record<string,unknown>){super(message);}}
