// Prints the numbers the end-to-end demo will show, so the story can be checked against the rules.
import fs from 'node:fs';
import { Travel } from '../public/js/travel.js';
import { makeStory } from '../public/js/demo/story.js';
import { fmtT } from '../public/js/model.js';
const net = JSON.parse(fs.readFileSync(new URL('../public/data/network.json', import.meta.url)));
const tr = new Travel(); tr.google.ok = false;
const S = makeStory(net, tr), t = S.t1;
console.log('A', S.A.name, '| A2', S.A2.name, '| trip', S.trip1, 'depart', fmtT(t.depart), 'arrive', fmtT(t.arrive), 'resp', t.respBiz, t.respMet, 'due', fmtT(t.dueResp), 'res due', fmtT(t.dueRes));
console.log('barred near A', S.barredA.slice(0, 3).map(x => `${x.e.id} ${x.where} ${x.est.min}`));
console.log('female near A', S.femaleA.slice(0, 3).map(x => `${x.e.id} ${x.where} ${x.est.min}`));
console.log('outcomes', Object.fromEntries(Object.entries(S.outcomes).map(([k, o]) => [k, `${o.resBiz} ${o.resMet}`])));
const s = S.search;
console.log('B', S.B.name, 'ok', s.ok.map(c => `${c.e.id} ${c.where} eta${c.eta} cross${c.cross} score${c.score}`));
console.log('barred', s.barred.slice(0, 4).map(c => `${c.e.id} ${c.eta}`), s.barred.length, 'far', s.far.map(c => `${c.e.id} ${c.eta}`), 'zoneEx', s.zone, s.zoneEx.length, 'busy', s.busy.map(b => `${b.e.id} ${b.why} ${b.eta}`), 'kept', s.kept, 'absent', s.absent.map(a => a.e.id));
console.log('p1', { ...S.p1, depart: fmtT(S.p1.depart), onsite: fmtT(S.p1.onsite), restored: fmtT(S.p1.restored) });
console.log('fallback', S.fallback && S.fallback.e.id, 'waitFor', S.waitFor && `${S.waitFor.e.id} ${fmtT(S.waitFor.until)} +${S.waitFor.est.min}`);
