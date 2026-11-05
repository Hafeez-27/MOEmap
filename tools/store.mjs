// Live plan, proposals and decisions in a private Vercel Blob store.
//   state/current.json        pointer to the live version {version, at, by, proposal}; moved forward with an ETag check
//   plans/v{n}.json           each approved plan, written once (version 0 is the plan built into the site)
//   proposals/{id}.json       a proposal's summary; proposals/{id}.plan.json the plan it would make
//   decisions/{id}.json       written once: whoever confirms or rejects first wins
//   scenarios/{id}.json       a saved map version (not published; opened only by its link); scenarios/{id}.plan.json its plan
import { put, get, list } from '@vercel/blob';

export function makeStore({ token, prefix = '' }) {
  if (!token) return null;
  const P = p => prefix + p;
  async function read(path) {
    const r = await get(P(path), { access: 'private', useCache: false, token }).catch(e => { if (/not.?found/i.test(e.message)) return null; throw e; });
    if (!r || r.statusCode !== 200) return null;
    return { data: JSON.parse(await new Response(r.stream).text()), etag: r.blob.etag };
  }
  const write = (path, obj, { overwrite = false, ifMatch } = {}) => put(P(path), JSON.stringify(obj), { access: 'private', addRandomSuffix: false, allowOverwrite: overwrite, contentType: 'application/json', cacheControlMaxAge: 60, token, ...(ifMatch ? { ifMatch } : {}) });
  return {
    async current() { const r = await read('state/current.json'); return r ? { ...r.data, etag: r.etag } : { version: 0 }; },
    async plan(v) { return v ? (await read(`plans/v${v}.json`))?.data || null : null; },
    async saveProposal(p, plan) { await write(`proposals/${p.id}.plan.json`, plan); await write(`proposals/${p.id}.json`, p); },
    async proposal(id) { return (await read(`proposals/${id}.json`))?.data || null; },
    async proposalPlan(id) { return (await read(`proposals/${id}.plan.json`))?.data || null; },
    async saveScenario(v, plan) { await write(`scenarios/${v.id}.plan.json`, plan); await write(`scenarios/${v.id}.json`, v); },
    async scenario(id) { return (await read(`scenarios/${id}.json`))?.data || null; },
    async scenarioPlan(id) { return (await read(`scenarios/${id}.plan.json`))?.data || null; },
    async decision(id) { return (await read(`decisions/${id}.json`))?.data || null; },
    // first decision wins: the write fails if a decision already exists
    async decide(id, d) { try { await write(`decisions/${id}.json`, d); return true; } catch (e) { if (/exist|overwrite|precondition/i.test(e.message)) return false; throw e; } },
    async redecide(id, d) { await write(`decisions/${id}.json`, d, { overwrite: true }); },
    // make a new live version from expected version n; fails with 'outdated' if the live plan moved on meanwhile
    async commit(plan, meta, expected) {
      const cur = await this.current();
      if ((cur.version || 0) !== expected) return { ok: false, reason: 'outdated', current: cur.version || 0 };
      const v = expected + 1;
      await write(`plans/v${v}.json`, plan);
      const ptr = { version: v, ...meta };
      try { await write('state/current.json', ptr, cur.etag ? { overwrite: true, ifMatch: cur.etag } : {}); }
      catch (e) { return { ok: false, reason: 'outdated', current: (await this.current()).version }; }
      return { ok: true, version: v };
    },
    async versions() {
      const r = await list({ prefix: P('decisions/'), token, limit: 200 });
      const out = [];
      for (const b of r.blobs) { const d = (await read(b.pathname.slice(prefix.length)))?.data; if (d?.decision === 'approved') out.push(d); }
      return out.sort((a, b) => (b.version || 0) - (a.version || 0));
    },
  };
}
