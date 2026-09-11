// Cloudflare Pages middleware: AIScroll locale routing + GamerScroll legacy redirects.

let aiscrollArticleIndexPromise = null;

// AIScroll 검색 인덱스(현재 빌드된 기사 slug→category). 성공 응답만 isolate에 캐시하고
// 실패는 다음 요청에서 다시 시도한다 (실패를 빈 목록으로 캐시하면 모든 슬러그가 "없음"이 됨).
async function loadAiscrollArticleIndex() {
  if (!aiscrollArticleIndexPromise) {
    aiscrollArticleIndexPromise = fetch("https://aiscroll.io/ko/articles-search.json", {
      cf: { cacheTtl: 300, cacheEverything: true }
    })
      .then((res) => (res && res.ok ? res.json() : null))
      .catch(() => null);
  }
  const list = await aiscrollArticleIndexPromise;
  if (!Array.isArray(list)) {
    aiscrollArticleIndexPromise = null;
    return null;
  }
  return list;
}

// slug → category. null = AIScroll에 없는 기사, undefined = 인덱스 조회 실패(판단 불가).
async function resolveAiscrollCategory(slug) {
  if (!slug) return null;
  const list = await loadAiscrollArticleIndex();
  if (!list) return undefined;
  const found = list.find((item) => item && item.slug === slug);
  return found ? (found.category || "news") : null;
}

// 삭제·미발행 기사: 존재하지 않는 페이지로 301 보내 soft-404 체인을 만들지 않고 410으로 닫는다.
function goneResponse() {
  return new Response("Gone", {
    status: 410,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "X-Robots-Tag": "noindex"
    }
  });
}

async function handleGamerScrollLegacyRedirect(url, path) {
  // 구 /tech/ai|vibecoding/<slug> → AIScroll 기사 (인덱스로 현재 카테고리 확인).
  const match = path.match(/^\/tech\/(ai|vibecoding)\/([^/]+)(\/.*)?$/);
  if (match) {
    const section = match[1];
    const slug = decodeURIComponent(match[2] || "");
    const suffix = match[3] && match[3] !== "/" ? match[3] : "/";
    const category = await resolveAiscrollCategory(slug);
    if (category === null) return goneResponse();
    // 인덱스 조회 실패 시 기본값: 2026-09 재출발 후 카테고리는 글 종류(news/guides/…)라 섹션과 무관
    const resolved = category || "news";
    const target = `https://aiscroll.io/ko/article/${resolved}/${encodeURIComponent(slug)}${suffix}`;
    return Response.redirect(target + url.search, 301);
  }

  // 구 /tech/normal/<slug> → 게이머스크롤 매거진 재배치 (2026-08-02): 소스 JSON은 reports/issue·hotpick으로 이동됨.
  // 맵에 없는 슬러그는 삭제된 기사 → 410.
  const normalMatch = path.match(/^\/tech\/normal\/([^/]+)\/?$/);
  if (normalMatch) {
    const slug = decodeURIComponent(normalMatch[1] || "");
    const type = TECH_NORMAL_MOVED[slug];
    if (type) {
      return Response.redirect(`${url.origin}/magazine/${type}/${encodeURIComponent(slug)}/` + url.search, 301);
    }
    return goneResponse();
  }

  // 잔여 /tech/* (허브 페이지) → AIScroll 홈.
  // 과거 docs/_redirects의 /tech/* 캐치올은 동적 룰 상한으로 항상 죽어 있었음 — 여기서 의도 복원.
  if (path === "/tech" || path.startsWith("/tech/")) {
    return Response.redirect("https://aiscroll.io/ko/", 301);
  }

  // 2026-09-09 위키·출시 게임 섹션 폐기: 옛 URL은 가장 가까운 허브(리포트·게임 DB)로 301.
  if (path === "/wiki" || path.startsWith("/wiki/")) {
    return Response.redirect(`${url.origin}/reports/`, 301);
  }
  if (path === "/upcoming" || path === "/upcoming/" || path === "/upcoming.html") {
    return Response.redirect(`${url.origin}/games/`, 301);
  }
  // 옛 매거진 허브·카테고리 목록은 리포트 허브로 통합 (기사 URL /magazine/<type>/<slug>/ 은 유지).
  if (/^\/magazine\/?$/.test(path) || /^\/magazine\/(issue|insight|hotpick|ranking)\/?$/.test(path)) {
    return Response.redirect(`${url.origin}/reports/`, 301);
  }

  return null;
}

// 2026-08-02 매거진 재배치 슬러그 맵 (구 /tech/normal/<slug> → /magazine/<type>/<slug>/)
const TECH_NORMAL_MOVED = {
  "intel-arc-g3-handheld-gaming": "issue",
  "intel-core-ultra-200s-plus": "issue",
  "macbook-neo-reviews": "issue",
  "nakwon-last-paradise-cbt": "issue",
  "nvidia-dlss5-controversy": "issue",
  "rewinding-cadence-technical-test": "issue",
  "2d-animation-tech": "hotpick",
  "agile-jira-confluence-game-dev": "hotpick",
  "firebase-serverless-game-backend": "hotpick",
  "game-engine": "hotpick",
  "gantt-chart": "hotpick",
  "python-pandas-data-analysis": "hotpick",
  "version-control-system": "hotpick"
};

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  const country = request.headers.get("CF-IPCountry") || "";
  const path = url.pathname;
  const host = (request.headers.get("host") || url.hostname || "").toLowerCase();

  if (host.includes("gamerscroll.com")) {
    // www -> non-www 301: consolidate to the canonical bare host so Google does
    // not crawl both hosts and split indexing signals.
    if (host.startsWith("www.")) {
      return Response.redirect("https://gamerscroll.com" + path + url.search, 301);
    }
    const legacyRedirect = await handleGamerScrollLegacyRedirect(url, path);
    if (legacyRedirect) return legacyRedirect;
    // Privacy data fragment (fetched by layout.js) must not be indexed as a
    // standalone page — it duplicates the real /privacy/ page.
    if (path === "/assets/privacy-content" || path === "/assets/privacy-content.html") {
      const response = await next();
      try {
        const cloned = new Response(response.body, response);
        cloned.headers.set("X-Robots-Tag", "noindex");
        return cloned;
      } catch {
        return response;
      }
    }
    return next();
  }

  // HARD INVARIANT: KR auto-routing applies only to aiscroll.io.
  // functions/ is at repo root so Cloudflare Pages deploys it for BOTH
  // GamerScroll(docs/) and AIScroll(ai-docs/) projects. Skip on any non-aiscroll host.
  if (!host.includes("aiscroll.io")) return next();

  // Already on /ko/ tree — let it through.
  if (path === "/ko" || path.startsWith("/ko/")) return next();

  // EN opt-out: ?lang=en query sets a 1-year cookie so the preference persists.
  // aiscroll_lang=en cookie also pass-through on subsequent requests.
  if (url.searchParams.get("lang") === "en") {
    const response = await next();
    try {
      const cloned = new Response(response.body, response);
      cloned.headers.append("Set-Cookie", "aiscroll_lang=en; Path=/; Max-Age=31536000; SameSite=Lax; Secure");
      return cloned;
    } catch {
      return response;
    }
  }
  const cookie = request.headers.get("Cookie") || "";
  if (/(?:^|;\s*)aiscroll_lang=en(?:;|$)/.test(cookie)) return next();

  // Skip static assets / API-ish paths from country redirect to keep CDN/SEO predictable.
  if (
    path.startsWith("/assets/") ||
    path.startsWith("/favicon") ||
    path === "/manifest.json" ||
    path === "/robots.txt" ||
    path === "/sitemap.xml" ||
    path === "/rss.xml" ||
    path === "/service-worker.js" ||
    path === "/ads.txt" ||
    path === "/og-image.png" ||
    path.startsWith("/articles") ||
    /\.(png|jpg|jpeg|gif|webp|svg|ico|css|js|json|xml|txt|map)$/i.test(path)
  ) {
    return next();
  }

  // Bot UA pass-through — search engines always see the English tree for indexing.
  const ua = (request.headers.get("User-Agent") || "").toLowerCase();
  if (/(?:^|[^a-z])(?:googlebot|bingbot|baiduspider|duckduckbot|yandexbot|naverbot|yeti|facebookexternalhit|twitterbot|whatsapp|slackbot|applebot|petalbot|sogou|seznambot|ahrefsbot|semrushbot|mj12bot|crawler|spider|scrapy|wget|curl)/.test(ua)) {
    return next();
  }

  if (country === "KR") {
    const target = "/ko" + (path === "/" ? "/" : path);
    return Response.redirect(new URL(target + url.search, url.origin).toString(), 302);
  }

  const response = await next();
  // Debug: surface detected country header so we can diagnose middleware reach.
  try {
    const cloned = new Response(response.body, response);
    cloned.headers.set("X-AIScroll-Country", country || "none");
    cloned.headers.set("X-AIScroll-Middleware", "v1");
    return cloned;
  } catch {
    return response;
  }
}
