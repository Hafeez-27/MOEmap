// Proposal and decision emails, sent through Resend from the verified antm.ai domain.
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function sendMail(env, { to, subject, html, text }) {
  const dest = env.MAIL_TEST_TO ? [env.MAIL_TEST_TO] : [to];          // MAIL_TEST_TO redirects every email while testing
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM || 'MOE Site Engineer Allocation Maps <maps@antm.ai>', to: dest, subject, html, text })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Email not sent (${r.status}): ${j.message || ''}`);
  return j.id;
}

const shell = body => `<!doctype html><html><body style="margin:0;background:#F4F6F9;font:15px/1.5 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#16202E">
<div style="max-width:640px;margin:0 auto;padding:24px 16px"><div style="background:#fff;border:1px solid #DCE2EA;border-radius:8px;padding:24px">${body}</div>
<p style="color:#6B778C;font-size:12px;margin:12px 4px">MOE Site Engineer Allocation Maps, prepared by Alpha Data for the UAE Ministry of Education.</p></div></body></html>`;
const btn = (href, label, primary) => `<a href="${esc(href)}" style="display:inline-block;padding:10px 18px;border-radius:6px;font-weight:600;text-decoration:none;${primary ? 'background:#16202E;color:#fff' : 'background:#fff;color:#16202E;border:1px solid #B8C2D0'}">${esc(label)}</a>`;
const list = items => items.length ? `<ul style="padding-left:20px;margin:6px 0 14px">${items.map(i => `<li style="margin:3px 0">${esc(i)}</li>`).join('')}</ul>` : '';

export function proposalEmail({ p, approver, reviewUrl, viewUrl }) {
  const g = p.groups || { headline: p.lines.filter(l => !/^(Rule warning|Watch|Resolved)/.test(l)), zones: [], moves: [], warnings: p.lines.filter(l => /^(Rule warning|Watch)/.test(l)), resolved: [] };
  const changes = p.log.filter(l => l.ok).map(l => l.text), broke = p.rulesBroken || g.warnings.filter(l => /^Rule/.test(l)), warn = g.warnings.filter(l => /^Watch/.test(l)), rest = [...g.headline, ...g.zones, ...g.resolved];
  const moves = g.moves.length ? `<h2 style="font-size:15px;margin:0">${g.moves.length} site${g.moves.length === 1 ? '' : 's'} change engineer</h2>${list(g.moves.slice(0, 12))}${g.moves.length > 12 ? `<p style="margin:-8px 0 14px;color:#46536A">…and ${g.moves.length - 12} more: see them on the map.</p>` : ''}` : '';
  const subject = `Plan update request: ${changes.length} change${changes.length === 1 ? '' : 's'} from ${p.requester}${(p.rulesBroken || []).length ? ` (breaks ${p.rulesBroken.length === 1 ? 'a rule' : p.rulesBroken.length + ' rules'})` : ''}`;
  const html = shell(`<h1 style="font-size:20px;margin:0 0 4px">Plan update request</h1>
<p style="margin:0 0 16px;color:#46536A">${esc(approver.name)}, ${esc(p.requester)} asked for ${changes.length} change${changes.length === 1 ? '' : 's'} to the engineer allocation on ${esc(new Date(p.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Dubai' }))} (UAE time).${p.note ? `<br>Their note: “${esc(p.note)}”` : ''}</p>
<h2 style="font-size:15px;margin:0">What changes</h2>${list(changes)}
${broke.length ? `<h2 style="font-size:15px;margin:0;color:#B42318">Rules ${esc(p.requester)} chose to break</h2>${list(broke)}<p style="margin:-6px 0 14px;color:#46536A">They were warned on the map and confirmed each one. Confirming the proposal accepts them.</p>` : '<p style="color:#1F7A45">No MOE rule is broken by these changes.</p>'}
<h2 style="font-size:15px;margin:0">Impact on the plan</h2>${list(rest)}
${warn.length ? `<h2 style="font-size:15px;margin:0">Things to watch</h2>${list(warn)}` : ''}
${moves}
<p style="margin:18px 0 6px">${btn(reviewUrl, 'Review and confirm', true)}&nbsp; ${btn(viewUrl, 'See it on the map')}</p>
<p style="color:#6B778C;font-size:13px;margin:10px 0 0">Confirming updates the live plan for everyone. The first of the two approvers to confirm or reject decides. This link is for ${esc(approver.email)} only and expires on ${esc(new Date(p.expiresAt).toLocaleDateString('en-GB', { dateStyle: 'medium' }))}.</p>`);
  const text = `Plan update request from ${p.requester}\n\nWhat changes:\n${changes.map(c => '- ' + c).join('\n')}\n\nImpact:\n${p.lines.map(c => '- ' + c).join('\n')}\n\nReview and confirm: ${reviewUrl}\nSee it on the map: ${viewUrl}\n`;
  return { subject, html, text };
}

export function decisionEmail({ p, d, viewUrl }) {
  const ok = d.decision === 'approved';
  const subject = `${ok ? 'Approved' : 'Rejected'}: plan update from ${p.requester}`;
  const html = shell(`<h1 style="font-size:20px;margin:0 0 6px">${ok ? 'Plan updated' : 'Plan update rejected'}</h1>
<p style="margin:0 0 14px;color:#46536A">${esc(d.byName)} ${ok ? `confirmed ${esc(p.requester)}'s ${p.log.filter(l => l.ok).length} change(s). The live map now shows plan version ${d.version}.` : `rejected ${esc(p.requester)}'s ${p.log.filter(l => l.ok).length} change(s). The live plan is unchanged.`}</p>
${list(p.log.filter(l => l.ok).map(l => l.text))}<p>${btn(viewUrl, 'Open the map', true)}</p>`);
  return { subject, html, text: `${subject}. ${d.byName} ${ok ? 'confirmed' : 'rejected'} it.` };
}
