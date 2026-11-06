// The map's AI assistant: builds the knowledge-base prompt (decisions guide + the plan's data tables + what the user has
// selected + any simulated changes) and streams the answer. Used by the Vercel function and server.js.
//
// Which model answers:
//   - every request goes to Ollama first (OLLAMA_HOST/KEY/MODEL), which answers questions itself
//   - if the request involves a plan change, Ollama hands it on (it replies with the FORWARD marker, or starts writing a
//     <changes> block) and Claude Sonnet 5.5 (CLAUDE_KEY, medium thinking) plans the change instead
//   - if Claude fails (bad key, rate limit, outage, refusal), Ollama plans the change itself and the answer says so
// The generator yields events, sent to the page as NDJSON lines:
//   {meta: {model, label, provider, mode, via, reason}}   who is answering (again after a restart)
//   {s: 'thinking'}                                   the model has started thinking (a new planning step)
//   {think: '...'}                                    Claude's reasoning summary, streamed into that step
//   {tool: {id, name, phase, title, ...}}             a tool step: writing -> running -> done (results, moved sites, ops)
//   {t: '...'}                                        answer text
//   {demote: true}                                    the text since the last step was a progress note, not the answer
//   {restart: true}                                   drop the text so far; another model answers (meta follows)
import Anthropic from '@anthropic-ai/sdk';
import * as PE from './plan-engine.mjs';

const ARABIC = /[؀-ۿ]/;
const CLAUDE_DEFAULT = 'claude-sonnet-5-5';
const CLAUDE_NAMES = { 'claude-sonnet-5-5': 'Claude Sonnet 5.5', 'claude-opus-5-5': 'Claude Opus 5.5', 'claude-haiku-5-5': 'Claude Haiku 5.5' };
const claudeLabel = id => CLAUDE_NAMES[id] || String(id).replace(/^claude-/, 'Claude ').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/-/g, ' ').replace(/\b[a-z]/g, c => c.toUpperCase());
const ollamaLabel = id => String(id || 'Ollama').replace(/:(\d+(?:\.\d+)?)b$/i, ' $1B').replace(/:/g, ' ');

// the models this deployment uses, for the page's "who answers" line
export function models(env) {
  const claude = !!(env.CLAUDE_KEY || env.ANTHROPIC_API_KEY);
  return {
    changes: claude ? { label: claudeLabel(env.CLAUDE_MODEL || CLAUDE_DEFAULT), provider: 'Anthropic' } : { label: ollamaLabel(env.OLLAMA_MODEL), provider: 'Ollama' },
    questions: { label: ollamaLabel(env.OLLAMA_MODEL), provider: 'Ollama' }
  };
}

// ---- Ollama decides whether a request is a plan change: it replies with this marker instead of answering
const FORWARD = '<forward-to-planner/>';
const ROUTING = `ROUTING (read first)
You answer questions about the plan. Plan changes are handled by a separate planner. If the user's last message asks to change the plan in any way (move, swap, reassign, add or remove an engineer or a site, change an engineer's gender or base, re-split a zone's patches, undo a simulated change, try a "what if" change), or answers a question that was asked about such a change, reply with exactly ${FORWARD} and nothing else. Questions about the plan, about pending simulated changes and their impact, and about rules are not changes: answer those yourself as below, and never write a <changes> block.`;

// ---- the prompt, in three parts so the first two can be cached: rules + decisions guide (fixed), data tables (change only
// with the plan or the simulated changes), then what is particular to this question.
function promptParts({ plan, meta, decisions, picks, mentioned, draft, arabic }) {
  const guide = `You are the assistant inside "MOE Site Engineer Allocation Maps", a map of which field engineer looks after every MOE school and office in the UAE. The people asking are senior: the MOE director, the project lead and Team Leads.

HOW TO ANSWER
- Answer from the decisions guide and the data below only. Every number must come from them. Start from the SELECTED and MENTIONED details when they are given: they are exact. Copy each fact from its own row; never mix facts from two rows (an engineer's gender and type come from that engineer's row). If they do not cover something, say so plainly; do not guess or invent.
- Lead with the answer in one or two sentences, then the supporting facts. Be brief: about 150 words unless the user asks for a list or detail. Use short bullet lists and small tables where they help. No preamble, no closing offers.
- Reply in the language of the user's last message (Arabic or English).
- The user may attach files (spreadsheets, text, images, PDFs). Use them together with the plan's data, say which facts come from the file, and say so plainly when the file and the plan disagree.
- Refer to sites, engineers and zones with their ids in double square brackets, in place of the name: [[S041]], [[DXB-SHJ-P06]], [[AAN-B]]. The screen turns each one into a clickable name, so do not also write the name next to it. Write ids exactly as in the tables, with plain hyphens (-). Never invent an id.
- Write plain Markdown only: no HTML tags such as <br>; to break a line inside a table cell, use "; " instead.
- Never paste table rows, and add no citations or source marks (no 【…】, no "see table").
- Drive times are Google Maps typical times at 7:30 am (school run) unless you say 10:30 am. Give the road distance next to every drive time when the data has it, for example "18 min (9.4 km)". "Backup" is the nearest other engineer if a site's own engineer is off (an estimate).
- When asked "why", explain with the rule from the guide and the data (for example the drive time to the other candidates, gender, odd counts).

CHANGES (simulation)
- If the user asks to change the plan (move a school to another engineer, swap two schools, add or remove an engineer, change an engineer's gender or base, re-split a zone's pool patches), say in one or two sentences what you are changing and what to expect, then end your reply with exactly one block:
<changes>[ ...one JSON object per change... ]</changes>
- The allowed changes (use ids from the tables):
  {"op":"move","site":"S041","name":"Umm Sqaim Girls School Cycle 2","to":"DXB-SHJ-P03"}      move a site to an existing engineer
  {"op":"swap","a":"S041","aName":"Umm Sqaim Girls School Cycle 2","b":"S052","bName":"..."}  the two sites swap engineers
  {"op":"base","engineer":"DXB-SHJ-C03","site":"S060","name":"..."}                       base the engineer at one of its sites
  {"op":"add","kind":"pool","zone":"DXB-SHJ","gender":"Male"}   add a pool engineer; the zone's patches are re-split
  {"op":"add","kind":"city_shared","zone":"RAK","gender":"Female","sites":["S199","S205"],"names":["...","..."]}   add an engineer for given sites
  {"op":"remove","engineer":"AJM-UAQ-P09"}                       remove an engineer; its sites go to the nearest engineers in the zone
  {"op":"gender","engineer":"RAK-C03","gender":"Male"}
  {"op":"rebalance","zone":"KFK-DBA"}                            re-split the zone's pool patches
  kind is one of national, city_shared, pool; gender is Male or Female.
  Always give a site's exact name next to its id ("name", "aName"/"bName", "names"), copied from the same row: the map checks they agree.
- Before you write the block, check each change against the tables: the site and engineer ids exist, each name matches its id's row, and you know which rules it would break (crossing zones, a girls' school with a male engineer, and the rest below). Say what the change does to the drive time when the tables show it.
- Changes are only simulated: they show on the map as pending and need approval. Never say a change is approved or done. Tell the user they can review the impact, make more changes, then press "Request plan update" so the approvers (Sithesvaran Thirumaran, Sanath Swaroop) get an email.
- Allow changes that break a rule (sharing a national, a girls' school with a male engineer, a remote school without its national, crossing zones, going over or under the budget in the BUDGET line): still add the block, and say plainly which rule it breaks. The map then warns the user and asks them to confirm before simulating it.
- If a change request is ambiguous (which school, which engineer), ask one short question instead of guessing, and add no block.
- Only add a <changes> block when the user asks for a change. Questions never get one.

DECISIONS GUIDE (why and how the original plan was built. Its numbers describe that original plan; for the plan as it is now, always use the TOTALS and other lines in the DATA TABLES.)
${decisions}`;
  const tables = `DATA TABLES (pipe-separated)${draft?.lines?.length ? ' - these already include the pending simulated changes listed after them' : ''}
${PE.kbTables(plan, { arabic })}`;
  const { S, E, Z } = PE.index(plan);
  const sel = (picks || []).filter(p => (p.type === 'site' && S.has(p.id)) || (p.type === 'eng' && E.has(p.id)) || (p.type === 'zone' && Z.has(p.id)));
  const live = `Today is ${new Date().toISOString().slice(0, 10)}.

PLAN VERSION
${meta?.version ? `Live plan version ${meta.version}, ${meta.rebuild ? `${meta.note || 'rebuilt'}; made live` : 'approved'} ${String(meta.at || '').slice(0, 10)} by ${meta.by || 'an approver'}. The decisions guide describes how the original plan (version 0) was built; where its numbers differ from the data tables, the tables are right: they are the plan as it is now.` : 'The original plan (version 0); no changes have been approved yet.'}
${draft?.lines?.length ? `\nPENDING SIMULATED CHANGES (not approved). The data tables above ALREADY INCLUDE these changes.\n${draft.log.map(l => `- ${l.text}`).join('\n')}\nImpact against the approved plan:\n${draft.lines.map(l => `- ${l}`).join('\n')}\n` : ''}
${sel.length ? `\nSELECTED ON THE MAP (questions like "this", "these", "here" refer to them):\n${PE.details(plan, sel)}\n` : ''}${mentioned?.length ? `\nMENTIONED IN THE CONVERSATION (exact details):\n${PE.details(plan, mentioned)}\n` : ''}`;
  return { guide, tables, live };
}

// ---- Claude, the planner: the same knowledge base plus tools, so it can look up drive times, test changes on the plan
// engine, put the changes it recommends on the user's simulated plan, and save alternative plans as private map versions.
// It works as a long-running agent (many rounds, effort medium or high); every step is streamed so the page can show the
// planning as it happens.
const PLANNER = `PLANNING WITH TOOLS (you are the planner for plan changes; you can work through many steps)
Your tools:
- find_engineers: who could take a site, nearest first, with Google typical drive times, road distances and any rule that stops them.
- try_changes: tests changes on the plan engine without saving them, on top of the pending simulated changes and anything you staged in this conversation turn. It returns the drive times and road distances before and after, the MOE rules broken and the impact. The user watches each attempt on the map as it happens.
- stage_changes: puts the changes you recommend on the user's simulated plan, where they show as pending changes. Nothing is approved or emailed: only a person can press "Request plan update". A change that breaks an MOE rule waits on the map until the user confirms it.
- save_version: saves one complete alternative plan as its own private map version, with a link only people who have it can open. Use it when the user asks for options, alternatives or versions, or when there are two or more reasonable plans worth comparing.
How to work: investigate first (find_engineers when the user has not named the engineer; try_changes for every candidate change, and try better options when a test breaks a rule or makes a drive much longer). Then stage the changes you recommend with stage_changes, exactly as you tested them. When there are alternatives, save each one with save_version (give each a short clear name) and stage only the one you recommend, unless the user asked you not to stage anything. Use as many steps as the task needs, but no more. When the user names an exact change, test it and stage it as asked, even if it breaks a rule, and say which rule.
Then answer briefly with the facts from the tool results (drive times and distances before and after, rules, impact): say what you staged, and list every version you saved with its name and link. Do not write a <changes> block for changes you staged with stage_changes. If no change should be made, say why and stage nothing.`;

const OPS = ['move', 'swap', 'base', 'add', 'remove', 'gender', 'rebalance'];
const OPS_SCHEMA = { type: 'array', description: 'the changes, as JSON objects in the same form as the <changes> block', items: { type: 'object', required: ['op'], properties: { op: { type: 'string', enum: OPS } } } };
const TOOLS = [
  {
    name: 'find_engineers',
    description: "Engineers who could take a site, nearest first. For each: type, gender, zone, number of sites, base, the typical 7:30 am drive (Google Maps) and road distance from the engineer's base to the site, and whether an MOE rule stops them taking it. Also the site's current engineer and drive.",
    input_schema: { type: 'object', additionalProperties: false, required: ['site', 'name', 'scope'], properties: {
      site: { type: 'string', description: 'site id, for example S041' },
      name: { type: 'string', description: "the site's exact name, copied from the tables" },
      scope: { type: 'string', enum: ['zone', 'all'], description: "zone: engineers in the site's zone; all: every zone" } } },
    strict: true, eager_input_streaming: true
  },
  {
    name: 'try_changes',
    description: 'Test changes on the plan without saving them, on top of the pending simulated changes and anything already staged in this turn. Returns what each change did, the 7:30 am drive and road distance before and after for every site that changes engineer, MOE rules the changes would break, new things to watch, and the impact on the whole plan. The user sees each attempt on the map. Test every change before you stage or save it.',
    input_schema: { type: 'object', required: ['summary', 'ops'], properties: {
      summary: { type: 'string', description: 'what you are trying, in plain words for the user, for example "Move Umm Sqaim Girls School Cycle 2 to DXB-SHJ-P03"' },
      ops: OPS_SCHEMA } },
    eager_input_streaming: true
  },
  {
    name: 'stage_changes',
    description: "Put the changes you recommend on the user's simulated plan (pending, not approved). They are added after the pending simulated changes and anything already staged in this turn. A change that breaks an MOE rule is shown to the user to confirm before it is added. Nothing is emailed or approved.",
    input_schema: { type: 'object', required: ['summary', 'ops'], properties: {
      summary: { type: 'string', description: 'what you are staging, in plain words for the user' },
      ops: OPS_SCHEMA } },
    eager_input_streaming: true
  },
  {
    name: 'save_version',
    description: "Save one complete alternative plan as its own private map version and get its link. The version is the live plan plus the user's pending simulated changes from before this request plus the ops you give (so give every change that belongs to this alternative). It is not published and not sent to anyone: only people with the link can open it. Use it for options or alternatives the user can compare.",
    input_schema: { type: 'object', required: ['name', 'summary', 'ops'], properties: {
      name: { type: 'string', description: 'a short clear name, for example "Option A: Umm Sqaim to DXB-SHJ-P03"' },
      summary: { type: 'string', description: 'one or two sentences: what this version changes and why' },
      ops: OPS_SCHEMA } },
    eager_input_streaming: true
  }
];

const legOf = (p, sid) => { const { S, E } = PE.index(p), s = S.get(sid), e = s && E.get(s.eng); if (!e) return null; if (e.base === sid) return { peak: 0, km: 0 }; return e.legs.find(x => x.to === sid) || null; };
const legMin = (p, sid) => legOf(p, sid)?.peak ?? null, legKm = (p, sid) => legOf(p, sid)?.km ?? null;
const cleanOps = ops => {
  if (!Array.isArray(ops) || !ops.length) throw new Error('ops must be a non-empty list of changes');
  ops = ops.slice(0, 12).filter(o => o && typeof o === 'object' && OPS.includes(o.op)).map(({ ack, _id, _bad, ...o }) => o);
  if (!ops.length) throw new Error(`each change needs "op", one of ${OPS.join(', ')}`);
  return ops;
};

// the tools work on a running plan: the user's pending changes, plus whatever the planner stages during this turn
function makeTools({ plan, view, draftOps, drive, saveVersion }) {
  const runOps = [...draftOps]; let runPlan = { n: runOps.length, plan: view };
  const current = async () => { if (runPlan.n !== runOps.length) runPlan = { n: runOps.length, plan: (await PE.simulate(plan, runOps, { drive })).plan }; return runPlan.plan; };
  async function findEngineers({ site, name, scope }) {
    const cur = await current(), { S } = PE.index(cur);
    const s = PE.resolveSite(cur, site, name), mine = cur.engineers.find(e => e.id === s.eng);
    const pool = cur.engineers.filter(e => e.id !== s.eng && (scope === 'all' || e.zone === s.zone) && S.get(e.base));
    const ranked = pool.map(e => ({ e, est: PE.est(S.get(e.base), s) })).sort((a, b) => a.est.peak - b.est.peak).slice(0, 8);
    let g = []; if (drive && !s.boat) { try { g = await drive(ranked.map(r => ({ a: { lat: S.get(r.e.base).lat, lng: S.get(r.e.base).lng }, b: { lat: s.lat, lng: s.lng } }))); } catch {} }
    const rows = ranked.map((r, i) => {
      const e = r.e, d = g?.[i] || r.est, stop = e.kind === 'national' ? 'nationals are never shared' : (s.g === 'G' && e.gender !== 'Female') ? "a girls' school needs a female engineer" : e.zone !== s.zone ? `different zone (${e.zone})` : '';
      return { engineer: e.id, type: PE.KNAME[e.kind], gender: e.gender, zone: e.zone, sites: e.sites.length, base: S.get(e.base).name, drive_min: d.peak, km: d.km, drive_source: d.src === 'google' ? 'Google' : 'estimate', rule: stop || null };
    }).sort((a, b) => (a.drive_min ?? 999) - (b.drive_min ?? 999));
    const out = { site: { id: s.id, name: s.name, zone: s.zone, gender: s.g === 'G' ? 'girls' : s.g === 'B' ? 'boys' : 'mixed', type: s.type, size: s.size }, current: mine ? { engineer: mine.id, type: PE.KNAME[mine.kind], gender: mine.gender, sites: mine.sites.length, drive_min: legMin(cur, s.id), km: legKm(cur, s.id) } : null, candidates: rows };
    return { forModel: out, show: { title: `Looked for engineers who could take ${s.name}`, site: s.id, current: out.current, rows: rows.slice(0, 6) } };
  }
  // simulate ops on top of the running plan and describe what they do
  async function test(ops) {
    const cur = await current(), res = await PE.simulate(plan, [...runOps, ...ops], { drive });
    const log = res.log.filter(l => l.i >= runOps.length).map(l => ({ ok: l.ok, text: l.text, i: l.i - runOps.length }));
    const had = new Set(PE.checks(cur).map(c => c.key)), now = PE.checks(res.plan).filter(c => !had.has(c.key));
    const vS = PE.index(cur).S;
    const moved = res.plan.sites.filter(s => vS.get(s.id) && vS.get(s.id).eng !== s.eng).slice(0, 40)
      .map(s => ({ site: s.id, name: s.name, from: vS.get(s.id).eng, to: s.eng, drive_before: legMin(cur, s.id), drive_after: legMin(res.plan, s.id), km_before: legKm(cur, s.id), km_after: legKm(res.plan, s.id) }));
    return { res, log, moved, rules: now.filter(c => c.level === 'rule').map(c => c.text), watch: now.filter(c => c.level === 'watch').map(c => c.text), impact: PE.impactLines(PE.impact(plan, res)) };
  }
  async function tryChanges({ summary, ops }) {
    ops = cleanOps(ops); const t = await test(ops);
    const out = { results: t.log.map(({ ok, text }) => ({ ok, text })), sites_changing_engineer: t.moved, rules_broken: t.rules, new_watch_items: t.watch, impact: t.impact };
    return { forModel: out, show: { title: String(summary || t.log.map(l => l.text).join('; ')).slice(0, 200), ok: t.log.some(l => l.ok), results: out.results, moved: t.moved.slice(0, 8), rules: t.rules, watch: t.watch.slice(0, 4), ops } };
  }
  async function stageChanges({ summary, ops }) {
    ops = cleanOps(ops); const t = await test(ops), good = ops.filter((o, i) => t.log.find(l => l.i === i)?.ok);
    if (!good.length) throw new Error(`none of these changes could be applied: ${t.log.map(l => l.text).join(' ')}`);
    runOps.push(...good);
    const out = { staged: good.length, results: t.log.map(({ ok, text }) => ({ ok, text })), sites_changing_engineer: t.moved, rules_broken: t.rules, impact: t.impact,
      note: t.rules.length ? 'These changes break MOE rules: the user is asked on the map to confirm before they are added.' : 'Added to the user\'s simulated plan as pending changes (not approved).' };
    return { forModel: out, show: { title: String(summary || '').slice(0, 200), ok: true, results: out.results, moved: t.moved.slice(0, 8), rules: t.rules, ops: good } };
  }
  async function saveVersionTool({ name, summary, ops }) {
    if (!saveVersion) throw new Error('saving versions needs the online map');
    ops = cleanOps(ops); name = String(name || '').trim().slice(0, 80) || 'Alternative plan';
    const v = await saveVersion({ name, summary: String(summary || '').slice(0, 600), ops: [...draftOps.map(({ ack, _id, _bad, ...o }) => o), ...ops], createdBy: 'Claude' });
    const out = { saved: true, name, link: v.link, changes: v.log.filter(l => l.ok).map(l => l.text), not_applied: v.log.filter(l => !l.ok).map(l => l.text), impact: v.lines };
    return { forModel: out, show: { title: name, ok: true, versionId: v.id, link: v.link, summary: String(summary || '').slice(0, 300), changes: out.changes.slice(-6) } };
  }
  return { find_engineers: findEngineers, try_changes: tryChanges, stage_changes: stageChanges, save_version: saveVersionTool };
}

// pull a field out of a tool's half-written JSON, so the step's title can appear while Claude is still writing it
const partial = (json, key) => { const m = String(json).match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`)); return m ? m[1].replace(/\\"/g, '"').replace(/\\n/g, ' ') : ''; };
const TITLE_KEY = { find_engineers: 'name', save_version: 'name', try_changes: 'summary', stage_changes: 'summary' };
const DONE_TITLE = { find_engineers: 'Looked for engineers', try_changes: 'Tried a change', stage_changes: 'Staged changes', save_version: 'Saved a version' };

// effort: high for bigger asks (options, several changes, a whole zone, attached files), medium otherwise
export function planEffort(env, msgs) {
  if (env.CLAUDE_EFFORT) return env.CLAUDE_EFFORT;
  const last = [...msgs].reverse().find(m => m.role === 'user'), q = last?.content || '';
  const big = /\b(options?|alternatives?|scenarios?|versions?|compare|plans?|rebalance|re-?split|re-?balance|several|multiple|all|every|whole|zone|best|optimi[sz]e)\b|خيارات|بدائل|خطة/i.test(q)
    || (q.match(/\b(move|swap|add|remove|reassign|replace)\b/gi) || []).length > 1 || (last?.files || []).length > 0 || q.length > 260;
  return big ? 'high' : 'medium';
}

async function* askClaude({ env, parts, msgs, signal, tools, deadline = Date.now() + 230e3 }) {
  const client = new Anthropic({ apiKey: env.CLAUDE_KEY || env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 120_000 });
  const system = [
    { type: 'text', text: `${PLANNER}\n\n${parts.guide}`, cache_control: { type: 'ephemeral' } },   // same on every request
    { type: 'text', text: parts.tables, cache_control: { type: 'ephemeral' } },                     // same until the plan or the simulated changes change
    { type: 'text', text: parts.live }
  ];
  const effort = planEffort(env, msgs);
  const convo = msgs.map(toClaude), MAX_ROUNDS = 16;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    // the last round, or out of time (the site allows 300 s a request): no more tools, write the answer
    const last = round === MAX_ROUNDS - 1 || Date.now() > deadline;
    const stream = client.messages.stream({
      model: env.CLAUDE_MODEL || CLAUDE_DEFAULT, max_tokens: 64000,
      thinking: { type: 'adaptive', display: 'summarized' },   // readable summaries of the reasoning, shown as planning steps
      output_config: { effort },
      system, tools: TOOLS, tool_choice: last ? { type: 'none' } : { type: 'auto' }, messages: convo
    });
    const stop = () => stream.abort(); signal?.addEventListener('abort', stop, { once: true });
    const blocks = new Map(); let wrote = false;
    try {
      for await (const ev of stream) {
        if (ev.type === 'message_start' && round === 0) yield { meta: { model: ev.message.model, label: claudeLabel(ev.message.model), provider: 'Anthropic', effort } };
        else if (ev.type === 'content_block_start') {
          const b = ev.content_block; blocks.set(ev.index, { type: b.type, id: b.id, name: b.name, json: '', title: '' });
          if (b.type === 'thinking') yield { s: 'thinking' };
          else if (b.type === 'tool_use') yield { tool: { id: b.id, name: b.name, phase: 'writing', title: '' } };
        } else if (ev.type === 'content_block_delta') {
          const d = ev.delta, b = blocks.get(ev.index);
          if (d.type === 'thinking_delta' && d.thinking) yield { think: d.thinking };
          else if (d.type === 'text_delta') { wrote = true; yield { t: d.text }; }
          else if (d.type === 'input_json_delta' && b) {
            b.json += d.partial_json;
            const title = partial(b.json, TITLE_KEY[b.name] || 'summary');
            if (title && title !== b.title) { b.title = title; yield { tool: { id: b.id, name: b.name, phase: 'writing', title } }; }
          }
        }
      }
    } finally { signal?.removeEventListener('abort', stop); }
    const fin = await stream.finalMessage(), u = fin.usage || {};
    console.log(`[ask] ${fin.model} effort=${effort} round=${round} stop=${fin.stop_reason} in=${u.input_tokens} cache_read=${u.cache_read_input_tokens} cache_write=${u.cache_creation_input_tokens} out=${u.output_tokens}`);
    if (fin.stop_reason === 'refusal') throw new Error(`Claude declined (${fin.stop_details?.category || 'no category'}).`);
    if (fin.stop_reason !== 'tool_use') return;
    if (wrote) yield { demote: true };   // text written before a tool call was a progress note, not the answer
    convo.push({ role: 'assistant', content: fin.content });   // thinking blocks go back unchanged
    const results = [];
    for (const b of fin.content.filter(x => x.type === 'tool_use')) {
      const fn = tools[b.name]; let r, err = null;
      const title = [...blocks.values()].find(x => x.id === b.id)?.title || '';
      yield { tool: { id: b.id, name: b.name, phase: 'running', title } };
      try {
        if (!fn) throw new Error(`unknown tool ${b.name}`);
        if (!b.input || typeof b.input !== 'object' || Array.isArray(b.input)) throw new Error('INVALID_JSON: send the tool input again as a JSON object');
        r = await fn(b.input);
      } catch (e) { err = String(e.message || e).slice(0, 300); }
      yield { tool: { id: b.id, name: b.name, phase: 'done', ok: !err && r.show.ok !== false, error: err, ...(r ? r.show : { title: title || DONE_TITLE[b.name] || b.name }) } };
      results.push({ type: 'tool_result', tool_use_id: b.id, content: err ? `Error: ${err}` : JSON.stringify(r.forModel), ...(err ? { is_error: true } : {}) });
    }
    convo.push({ role: 'user', content: results });
  }
}

// ---- Ollama: answers questions, and decides which requests are plan changes
async function* askOllama({ env, parts, msgs, signal, route = false }) {
  const r = await fetch(`${env.OLLAMA_HOST}/api/chat`, {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OLLAMA_KEY}` },
    body: JSON.stringify({ model: env.OLLAMA_MODEL, messages: [{ role: 'system', content: [route ? ROUTING : '', parts.guide, parts.tables, parts.live].filter(Boolean).join('\n\n') }, ...msgs.map(toOllama)], stream: true, think: env.OLLAMA_THINK || 'medium', options: { temperature: 0.2, num_ctx: 131072 } })
  });
  if (!r.ok) throw new Error(`The AI service answered ${r.status}.`);
  const reader = r.body.getReader(), dec = new TextDecoder(); let buf = '', thinking = false;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true }); const lines = buf.split('\n'); buf = lines.pop();
    for (const l of lines) {
      if (!l.trim()) continue; let j; try { j = JSON.parse(l); } catch { continue; }
      if (j.error) throw new Error(String(j.error));
      if (j.message?.thinking && !thinking) { thinking = true; yield { s: 'thinking' }; }
      if (j.message?.content) yield { t: j.message.content };
    }
  }
}

// a quick Ollama check on the last few messages only, run alongside the full answer, so a plan change reaches Claude fast
async function quickRoute({ env, msgs, draftOps, signal }) {
  const recent = msgs.slice(-4).map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${(m.files?.length ? `[attached: ${m.files.map(f => f.name).join(', ')}] ` : '') + m.content.replace(/<changes>[\s\S]*?<\/changes>/g, '[proposed changes]').slice(0, 700)}`).join('\n');
  const r = await fetch(`${env.OLLAMA_HOST}/api/chat`, {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OLLAMA_KEY}` },
    body: JSON.stringify({ model: env.OLLAMA_MODEL, stream: false, think: 'low', options: { temperature: 0, num_ctx: 4096 }, messages: [
      { role: 'system', content: `You route messages for a map of MOE school engineer allocations. Reply with one word. CHANGE if the user's last message asks to change the allocation plan in any way (move, swap or reassign a school or office, add or remove an engineer, change an engineer's gender or base, re-split a zone's pool patches, undo a change, try a "what if" change), or answers a question the assistant asked about such a change. QUESTION for anything else, including questions about the plan, about pending changes and their impact, and about rules.${draftOps?.length ? ' The user has simulated changes pending.' : ''}` },
      { role: 'user', content: recent }] })
  });
  if (!r.ok) throw new Error(`router ${r.status}`);
  const j = await r.json(), w = String(j.message?.content || '').trim().toUpperCase();
  return w.startsWith('CHANGE') ? 'change' : w.startsWith('QUESTION') ? 'question' : null;
}

// ---- files attached to a message (the page reads spreadsheets and text in the browser and sends images and PDFs as base64)
const MIMES = { image: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], pdf: ['application/pdf'] };
function cleanFiles(list) {
  return (Array.isArray(list) ? list : []).slice(0, 8).map(f => {
    const name = String(f?.name || 'file').replace(/[\r\n"]/g, ' ').slice(0, 120);
    if (f?.omitted) return { name, kind: String(f.kind || 'file').slice(0, 10), omitted: true };
    if (f?.kind === 'text' && typeof f.text === 'string') return { name, kind: 'text', text: f.text.slice(0, 150000) };
    if ((f?.kind === 'image' || f?.kind === 'pdf') && MIMES[f.kind].includes(f.mime) && typeof f.data === 'string' && f.data.length < 4.5e6 && /^[A-Za-z0-9+/]+=*$/.test(f.data)) return { name, kind: f.kind, mime: f.mime, data: f.data };
    return null;
  }).filter(Boolean);
}
const fileNote = f => f.omitted ? `[The user attached "${f.name}" earlier; it is no longer included.]` : null;
function toClaude(m) {
  if (m.role !== 'user' || !m.files?.length) return { role: m.role, content: m.content };
  const blocks = m.files.map(f => fileNote(f) ? { type: 'text', text: fileNote(f) }
    : f.kind === 'image' ? { type: 'image', source: { type: 'base64', media_type: f.mime, data: f.data } }
    : f.kind === 'pdf' ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.data }, title: f.name }
    : { type: 'text', text: `Attached file "${f.name}":\n${f.text}` });
  return { role: 'user', content: [...blocks, { type: 'text', text: m.content }] };
}
function toOllama(m) {
  if (m.role !== 'user' || !m.files?.length) return { role: m.role, content: m.content };
  const parts = m.files.map(f => fileNote(f) || (f.kind === 'text' ? `Attached file "${f.name}":\n${f.text}` : `[The user attached ${f.kind === 'pdf' ? 'a PDF' : 'an image'}, "${f.name}", which you cannot read.]`));
  return { role: 'user', content: `${parts.join('\n\n')}\n\n${m.content}` };
}
const seesFiles = m => m.role === 'user' && (m.files || []).some(f => !f.omitted && (f.kind === 'image' || f.kind === 'pdf'));

const isAbort = e => e?.name === 'AbortError' || e instanceof Anthropic.APIUserAbortError;
const why = e => e instanceof Anthropic.AuthenticationError ? 'its key was not accepted'
  : e instanceof Anthropic.RateLimitError ? 'it is busy (rate limit)'
  : e instanceof Anthropic.APIConnectionError ? 'it could not be reached'
  : /declined/.test(e?.message || '') ? 'it declined this request'
  : e instanceof Anthropic.APIError ? `it answered ${e.status || 'with an error'}` : 'it failed';

// ---- stream the answer as events; draftOps are simulated on the live plan first, so the tables show what the user sees
export async function* ask({ env, plan, meta, decisions, picks, draftOps, messages, signal, drive, saveVersion }) {
  const deadline = Date.now() + 230e3;   // the site allows 300 s a request; the planner wraps up after about 230 s
  let msgs = (messages || []).filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-10);
  while (msgs.length && msgs[0].role !== 'user') msgs = msgs.slice(1);
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') throw new Error('No question.');
  msgs = msgs.map(m => ({ role: m.role, content: m.content.slice(0, 6000), ...(m.role === 'user' && m.files ? { files: cleanFiles(m.files) } : {}) }));
  let view = plan, draft = null;
  if (draftOps?.length) {
    const res = await PE.simulate(plan, draftOps.slice(0, 50));
    view = res.plan; draft = { log: res.log, lines: PE.impactLines(PE.impact(plan, res)) };
  }
  const arabic = msgs.some(m => ARABIC.test(m.content));
  const mentioned = PE.mentions(view, msgs.filter(m => m.role === 'user').slice(-3).map(m => [m.content, ...(m.files || []).filter(f => f.kind === 'text').map(f => f.text.slice(0, 20000))].join('\n')).join('\n'));
  const parts = promptParts({ plan: view, meta, decisions, picks: (picks || []).slice(0, 40), mentioned, draft, arabic });
  const hasClaude = !!(env.CLAUDE_KEY || env.ANTHROPIC_API_KEY), claudeName = claudeLabel(env.CLAUDE_MODEL || CLAUDE_DEFAULT);
  const ollama = { model: env.OLLAMA_MODEL, label: ollamaLabel(env.OLLAMA_MODEL), provider: 'Ollama' };

  // an image or PDF in the last two exchanges: Ollama's model cannot read it, so Claude answers
  if (hasClaude && msgs.slice(-4).some(seesFiles)) {
    let sent = false;
    try {
      for await (const ev of askClaude({ env, parts, msgs, signal, tools: makeTools({ plan, view, draftOps: (draftOps || []).slice(0, 50), drive, saveVersion }), deadline })) {
        if (ev.meta) { yield { meta: { ...ev.meta, mode: 'files', note: `${ollama.label} cannot read images or PDFs` } }; continue; }
        if (ev.t) sent = true; yield ev;
      }
      return;
    } catch (e) {
      if (isAbort(e) || signal?.aborted) return;
      console.log(`[ask] Claude failed on a file question: ${e?.status || ''} ${String(e?.message || e).slice(0, 160)}`);
      if (sent) yield { restart: true };
      yield { meta: { ...ollama, mode: 'question', reason: `${claudeName} was not available to read the file: ${why(e)}` } };
      yield* askOllama({ env, parts, msgs, signal }); return;
    }
  }
  // without Claude, Ollama answers everything, changes included
  if (!hasClaude) { yield { meta: { ...ollama, mode: 'question' } }; yield* askOllama({ env, parts, msgs, signal }); return; }

  // 1. Ollama receives the request: a quick routing check and the full answer start together. The answer's text is held
  //    back until the check says "question" (or the answer itself is clearly not the hand-off marker).
  yield { meta: { ...ollama, mode: 'question' } };
  const ac = new AbortController(), stopIt = () => ac.abort(); signal?.addEventListener('abort', stopIt, { once: true });
  const q = [], wake = { fn: null }, push = x => { q.push(x); wake.fn?.(); };
  let route = null, text = '', shown = 0, forward = false;
  quickRoute({ env, msgs, draftOps, signal: ac.signal }).then(r => push({ route: r || 'unsure' }), () => push({ route: 'unsure' }));
  (async () => { try { for await (const ev of askOllama({ env, parts, msgs, signal: ac.signal, route: true })) push({ ev }); push({ end: true }); } catch (e) { push({ fail: e }); } })();
  const handOff = () => text.includes(FORWARD) || text.includes('<changes>') || /^\s*<forward/i.test(text);
  try {
    for (let done = false; !done && !forward;) {
      if (!q.length) await new Promise(r => { wake.fn = r; }); wake.fn = null;
      while (q.length && !forward) {
        const x = q.shift();
        if (x.route) { route = x.route; if (route === 'change') forward = true; }
        else if (x.fail) { if (!(isAbort(x.fail) || signal?.aborted)) throw x.fail; done = true; }
        else if (x.end) { done = true; if (shown < text.length && !/^\s*</.test(text)) { yield { t: text.slice(shown) }; shown = text.length; } }
        else if (!x.ev.t) yield x.ev;
        else {
          text += x.ev.t;
          if (handOff()) forward = true;
          else if (route === 'question' || route === 'unsure' || shown || text.trimStart().length >= 24) { if (route || shown) { yield { t: text.slice(shown) }; shown = text.length; } }
        }
        // the check said "question" after text was held: release it
        if (!forward && route && route !== 'change' && shown < text.length && text.trimStart().length >= 24) { yield { t: text.slice(shown) }; shown = text.length; }
      }
    }
  } finally { if (forward || signal?.aborted) ac.abort(); signal?.removeEventListener('abort', stopIt); }
  if (!forward || signal?.aborted) return;
  console.log(`[ask] Ollama handed a plan change to Claude (${route === 'change' ? 'quick check' : 'in its answer'})`);

  // 2. it involves a plan change: Claude plans it
  if (shown) yield { restart: true };
  let sent = false;
  try {
    const tools = makeTools({ plan, view, draftOps: (draftOps || []).slice(0, 50), drive, saveVersion });
    for await (const ev of askClaude({ env, parts, msgs, signal, tools, deadline })) {
      if (ev.meta) { yield { meta: { ...ev.meta, mode: 'change', via: ollama.label } }; continue; }
      if (ev.t) sent = true; yield ev;
    }
  } catch (e) {
    if (isAbort(e) || signal?.aborted) return;
    console.log(`[ask] Claude failed, Ollama plans the change: ${e?.status || ''} ${String(e?.message || e).slice(0, 160)}`);
    if (sent) yield { restart: true };
    yield { meta: { ...ollama, mode: 'change', reason: `${claudeName} was not available: ${why(e)}` } };
    yield* askOllama({ env, parts, msgs, signal });
  }
}
