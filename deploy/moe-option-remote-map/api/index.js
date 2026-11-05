// One function serves the whole site, so nothing is reachable without the shared password (except the approval page,
// which is protected by the signed link in the approvers' email):
//   /            the map (after sign-in) or the password page
//   /login       checks the password, sets a 30-day cookie;  /logout clears it
//   /approve     approval page for a proposed plan change (token in the link)
//   /api/*, /tiles/*   see lib/app-api.mjs (signed-in only)
// Settings (Vercel environment variables): MAP_PASSWORD, GOOGLE_MAPS_API_KEY, OLLAMA_HOST/KEY/MODEL, RESEND_KEY,
// APPROVAL_SECRET, BLOB_READ_WRITE_TOKEN, SITE_URL
import crypto from 'node:crypto';
import { MAP } from '../lib/map.js';
import { LOGO_AD, LOGO_MOE } from '../lib/brand.js';
import { PLAN, DECISIONS, DRIVE_SEED } from '../lib/data.js';
import { makeApi } from '../lib/app-api.mjs';

const PASS = process.env.MAP_PASSWORD || '';
const COOKIE = 'moe_map';
const api = makeApi({ env: process.env, basePlan: PLAN, decisions: DECISIONS, driveSeed: DRIVE_SEED, logos: { ad: LOGO_AD, moe: LOGO_MOE } });
const sha = s => crypto.createHash('sha256').update(String(s)).digest();
const token = () => crypto.createHmac('sha256', PASS).update('moe-option-remote-map:v1').digest('base64url');
const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

function signedIn(req) {
  if (!PASS) return false;
  const c = (req.headers.get('cookie') || '').split(/;\s*/).find(x => x.startsWith(COOKIE + '='));
  return !!c && same(c.slice(COOKIE.length + 1), token());
}
const pathOf = req => { const u = new URL(req.url); return u.searchParams.get('path') || u.pathname; };
const originOf = req => `https://${req.headers.get('x-forwarded-host') || req.headers.get('host')}`;
const html = (body, status = 200, extra = {}) => new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', ...extra } });

const loginPage = (msg = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>MOE Site Engineer Allocation Maps</title><script>/* default zoom: 80% on a Mac, 67% on Windows (desktop only) */(function(){try{var n=navigator,p=(n.userAgentData&&n.userAgentData.platform)||n.platform||'',z=/Mac/i.test(p)&&!(n.maxTouchPoints>1)?0.8:/Win/i.test(p)?0.67:1;if(z!==1){document.documentElement.style.zoom=z;}}catch(e){}})();</script>
<style>
:root{--ink:#16202E;--ink2:#46536A;--mut:#6B778C;--line:#DCE2EA;--paper:#F4F6F9;--accent:#2A78D6;--bad:#B42318}
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 "IBM Plex Sans",-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;display:grid;place-items:center;padding:16px}
main{width:100%;max-width:380px;background:#fff;border:1px solid var(--line);border-radius:8px;padding:28px 26px}
.brand{display:flex;align-items:center;gap:14px;margin:0 0 20px;padding:0 0 18px;border-bottom:1px solid var(--line)}
.brand img{display:block;height:40px;width:auto}.brand i{width:1px;height:34px;background:var(--line)}
label{display:block;font-weight:600;font-size:13px;margin-bottom:6px}
input{width:100%;font:inherit;padding:10px 12px;border:1px solid #B8C2D0;border-radius:6px;background:#fff;color:var(--ink)}
input:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
button{margin-top:14px;width:100%;font:inherit;font-weight:600;padding:10px 12px;border:0;border-radius:6px;background:var(--ink);color:#fff;cursor:pointer}
button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.err{color:var(--bad);font-size:13.5px;margin:10px 0 0}
.foot{margin:16px 0 0;font-size:12.5px;color:var(--mut)}
</style></head><body><main>
<div class="brand"><img src="${LOGO_AD}" alt="Alpha Data" width="33" height="40"><i></i><img src="${LOGO_MOE}" alt="UAE Ministry of Education" width="123" height="40"></div>
<form method="post" action="/login"><label for="pw">Password</label>
<input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
${msg ? `<p class="err" role="alert">${msg}</p>` : ''}<button type="submit">Open the map</button></form>
<p class="foot">You stay signed in on this device for 30 days.</p>
</main></body></html>`;

async function route(req) {
  const p = pathOf(req);
  if (p === '/logout') return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` } });
  if (p === '/login' && req.method === 'POST') {
    const pw = new URLSearchParams(await req.text()).get('password') || '';
    if (PASS && same(pw, PASS)) return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': `${COOKIE}=${token()}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax` } });
    await new Promise(r => setTimeout(r, 800));
    return html(loginPage('That password is not right. Check it with the person who sent you the link.'), 401);
  }
  const r = await api(req, { signedIn: signedIn(req), origin: originOf(req) });
  if (r) return r;
  if (!PASS) return html(loginPage('This site has no password set yet, so it is closed.'), 503);
  if (!signedIn(req)) return html(loginPage(), p === '/' ? 200 : 401);
  return html(MAP);
}
export const GET = route, POST = route;
