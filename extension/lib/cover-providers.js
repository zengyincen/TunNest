const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
const DOUBAN_MIRROR_BASE = "https://dbimg.imnotfound.eu.org";
const CACHE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const CONCURRENCY = 5;
let doubanMirrorProbe;

export const MOVIE_COVER_PROVIDERS = ["douban", "tmdb-first", "tmdb-fallback"];
export const DOUBAN_IMAGE_PROVIDERS = ["mirror-first", "cloudflare", "lithub-first"];

export async function enrichDoubanHostedCovers(items, options = {}) {
  const configured = DOUBAN_IMAGE_PROVIDERS.includes(options.provider) ? options.provider : "mirror-first";
  const provider = configured === "lithub-first" ? "mirror-first" : configured;
  if (provider !== "mirror-first") return { items, activeProvider: "cloudflare", replaced: 0 };
  const health = await doubanMirrorAvailable(options.fetchImpl || fetch, options.signal);
  if (!health.ok) {
    await options.onStatus?.(`自建封面镜像不可用，已回退 Cloudflare：${health.error}`);
    return { items, activeProvider: "cloudflare", replaced: 0, error: health.error };
  }
  let replaced = 0;
  const output = items.map((item) => {
    const id = String(item.externalId || ""), kind = item.kind;
    if (!["movie", "book", "music"].includes(kind) || !/^\d+$/.test(id)) return item;
    replaced++;
    return {
      ...item,
      coverUrl: `${DOUBAN_MIRROR_BASE}/${kind}/${id}.jpg`,
      metadata: { ...(item.metadata || {}), coverSource: "TunNest Mirror", originalCoverUrl: item.coverUrl || "" }
    };
  });
  await options.onStatus?.(`已启用自建封面镜像 · ${replaced} 条`);
  return { items: output, activeProvider: "mirror", replaced };
}

export async function enrichMovieCovers(items, options = {}) {
  const provider = MOVIE_COVER_PROVIDERS.includes(options.provider) ? options.provider : "douban";
  if (provider === "douban") return { items, cache: options.cache || {}, matched: 0, searched: 0 };
  const token = String(options.tmdbAccessToken || "").trim();
  if (!token) throw new Error("已启用 TMDB 封面，请先填写 TMDB Read Access Token");

  const cache = pruneCache(options.cache || {}), results = [...items];
  const targets = items.map((item, index) => ({ item, index })).filter(({ item }) => item.kind === "movie" && (provider === "tmdb-first" || !validImageUrl(item.coverUrl)));
  let next = 0, completed = 0, matched = 0, searched = 0;
  async function worker() {
    while (next < targets.length) {
      const { item, index } = targets[next++];
      throwIfAborted(options.signal);
      const key = movieKey(item), cached = cache[key];
      let match = cached && Date.now() - Date.parse(cached.fetchedAt || 0) < CACHE_MAX_AGE ? cached : null;
      if (!match) {
        match = await searchTmdbMovie(item, token, options.signal);
        cache[key] = { ...match, fetchedAt: new Date().toISOString() };
        searched++;
      }
      if (match.url) {
        results[index] = {
          ...item,
          coverUrl: match.url,
          metadata: { ...(item.metadata || {}), coverSource: "TMDB", tmdbId: match.tmdbId, originalCoverUrl: item.coverUrl || "" }
        };
        matched++;
      }
      completed++;
      await options.onProgress?.({ completed, total: targets.length, matched, title: item.title });
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
  return { items: results, cache, matched, searched };
}

async function searchTmdbMovie(item, token, signal, attempt = 0) {
  const year = String(item.metadata?.years || item.metadata?.year || "").match(/(?:19|20)\d{2}/)?.[0] || "";
  const url = new URL("https://api.themoviedb.org/3/search/movie");
  url.search = new URLSearchParams({ query: item.title || "", language: "zh-CN", include_adult: "false", ...(year ? { year } : {}) }).toString();
  const response = await fetch(url, { signal, headers: { Accept: "application/json", Authorization: `Bearer ${token}` } });
  if (response.status === 429 && attempt < 3) {
    await pause(Math.max(1, Number(response.headers.get("Retry-After")) || 1) * 1000, signal);
    return searchTmdbMovie(item, token, signal, attempt + 1);
  }
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) throw new Error("TMDB Read Access Token 无效");
  if (!response.ok) throw new Error(data.status_message || `TMDB 请求失败 (${response.status})`);
  const candidate = bestMovieMatch(item, data.results || [], year);
  return candidate?.poster_path
    ? { url: `${TMDB_IMAGE_BASE}${candidate.poster_path}`, tmdbId: candidate.id }
    : { url: "", tmdbId: null };
}

function bestMovieMatch(item, candidates, expectedYear) {
  const wanted = normalizedTitle(item.title);
  const scored = candidates.filter((candidate) => candidate.poster_path).map((candidate) => {
    const titles = [candidate.title, candidate.original_title].map(normalizedTitle).filter(Boolean);
    const exact = titles.includes(wanted), candidateYear = String(candidate.release_date || "").slice(0, 4);
    const yearMatch = !expectedYear || candidateYear === expectedYear;
    return { candidate, exact, yearMatch, score: (yearMatch ? 20 : 0) + Math.min(10, Number(candidate.popularity) || 0) };
  }).filter(({ exact, yearMatch }) => exact && yearMatch).sort((left, right) => right.score - left.score);
  return scored[0]?.candidate || null;
}

function movieKey(item) { return `${item.externalId || normalizedTitle(item.title)}:${String(item.metadata?.years || item.metadata?.year || "").match(/(?:19|20)\d{2}/)?.[0] || ""}`; }
function normalizedTitle(value) { return String(value || "").normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, ""); }
function validImageUrl(value) { try { return new URL(value).protocol === "https:"; } catch { return false; } }
function pruneCache(cache) {
  const fresh = Object.entries(cache).filter(([, value]) => Date.now() - Date.parse(value?.fetchedAt || 0) < CACHE_MAX_AGE);
  return Object.fromEntries(fresh.slice(-1000));
}
async function doubanMirrorAvailable(fetchImpl, signal) {
  if (!doubanMirrorProbe || doubanMirrorProbe.fetchImpl !== fetchImpl || Date.now() - doubanMirrorProbe.checkedAt > 10 * 60 * 1000) doubanMirrorProbe = { fetchImpl, checkedAt: Date.now(), promise: (async () => {
    try {
      const response = await fetchImpl(`${DOUBAN_MIRROR_BASE}/movie/35337634.jpg`, { signal, cache: "no-store", headers: { Accept: "image/*", Range: "bytes=0-0" } });
      const type = String(response.headers?.get?.("Content-Type") || "").toLowerCase();
      await response.body?.cancel?.().catch?.(() => {});
      return response.ok && type.startsWith("image/") ? { ok: true } : { ok: false, error: `HTTP ${response.status}${type ? ` · ${type}` : ""}` };
    } catch (error) { return { ok: false, error: error.message || "网络连接失败" }; }
  })() };
  return doubanMirrorProbe.promise;
}
function throwIfAborted(signal) { if (signal?.aborted) throw new Error("同步已停止"); }
function pause(milliseconds, signal) { return new Promise((resolve, reject) => { const timer = setTimeout(resolve, milliseconds); signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("同步已停止")); }, { once: true }); }); }
