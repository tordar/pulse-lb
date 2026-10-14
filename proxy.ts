import { NextRequest, NextResponse } from "next/server";

/**
 * Two jobs, both about keeping work off the database.
 *
 * 1. Turn away commercial crawlers before they reach a route handler. These are
 *    SEO/data-broker and AI-training bots that either ignore robots.txt or
 *    crawl far harder than a personal listening dashboard is worth; a 403 here
 *    never opens a Postgres connection. Search engines are deliberately absent
 *    from the list — robots.txt is the right tool for those, and they respect it.
 *
 * 2. Mark every non-canonical host noindex. The raw deployment URL
 *    (pulse-<hash>-tordars-projects.vercel.app) was being crawled alongside the
 *    real domain, paying twice for the same pages.
 */
/*
 * Named bots only. Generic client strings (node-fetch, Go-http-client,
 * python-requests) are deliberately NOT here: the sync route's own
 * self-continuation hop is a server-side fetch back into this app, and matching
 * on a generic runtime UA would silently sever the chain mid-backfill.
 */
const BLOCKED_UA =
  /(AhrefsBot|SemrushBot|DotBot|MJ12bot|BLEXBot|PetalBot|DataForSeoBot|Bytespider|ClaudeBot|GPTBot|CCBot|Amazonbot|anthropic-ai|meta-externalagent|FacebookBot|ImagesiftBot|Barkrowler|serpstatbot|ZoominfoBot|SeekportBot|Timpibot|Diffbot|magpie-crawler|trendictionbot)/i;

function canonicalHost(): string | null {
  const explicit = process.env.APP_URL;
  if (explicit) {
    try {
      return new URL(explicit).host;
    } catch {
      return null;
    }
  }
  return process.env.VERCEL_PROJECT_PRODUCTION_URL ?? null;
}

export default function proxy(req: NextRequest) {
  const ua = req.headers.get("user-agent") ?? "";
  if (BLOCKED_UA.test(ua)) {
    return new NextResponse(null, {
      status: 403,
      headers: { "Cache-Control": "public, max-age=86400" },
    });
  }

  const res = NextResponse.next();
  const canonical = canonicalHost();
  if (canonical && req.headers.get("host") !== canonical) {
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return res;
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *  - Next's own assets,
     *  - robots.txt, which every blocked crawler still has to be able to read —
     *    403ing it would hide the very rules asking them to stay out,
     *  - the two server-to-server routes: the Stripe webhook (signature
     *    verified in the route) and /api/sync (the self-continuation hop, HMAC
     *    verified in the route). Neither should be judged on its user-agent.
     */
    "/((?!_next/static|_next/image|api/stripe|api/sync|robots.txt|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
