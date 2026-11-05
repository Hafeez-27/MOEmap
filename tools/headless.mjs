import fs from 'node:fs';
import { Sim } from '../public/js/engine.js';
import { Travel } from '../public/js/travel.js';
import { fmtDate } from '../public/js/model.js';
const net = JSON.parse(fs.readFileSync(new URL('../public/data/network.json', import.meta.url)));
const tr = new Travel(); tr.google.ok = false;
const sim = new Sim(net, tr);
const days = +(process.argv[2] || 5), scen = process.argv[3];
sim.on('dayEnd', d => {
  const k = sim.kpis('today');
  const types = {}; sim.log.filter(l => l.day === d.d).forEach(l => types[l.type] = (types[l.type] || 0) + 1);
  const engs = [...sim.engs.values()].filter(e => !e.absent);
  const util = engs.reduce((a, e) => a + e.busyHist.at(-1).busy / Math.max(1, e.busyHist.at(-1).avail), 0) / engs.length;
  const trips = engs.flatMap(e => e.segs.filter(s => s.k === 'travel').map(s => s.t1 - s.t0));
  trips.sort((a, b) => a - b);
  console.log(fmtDate(d.d), `recv ${d.recv} field ${d.field} remote ${d.remote} | resp ${d.respMet}/${d.respN} (${(d.respMet / d.respN * 100).toFixed(1)}%) res ${(d.resMet / Math.max(1, d.resN) * 100).toFixed(0)}% medOnsite ${d.onsite} | parts ${d.parts} vendor ${d.vendor} | aged ${d.aged} | absent ${k.absent} util ${(util * 100).toFixed(0)}% | trips ${trips.length} med ${trips[trips.length >> 1]} p90 ${trips[Math.floor(trips.length * .9)]}`, JSON.stringify(types));
});
let n = 0;
while (sim.days.length < days) { sim.step(); if (scen && sim.days.length === 0 && sim.t % 1440 === 540) sim.scenario(scen); if (++n > 3e6) break; }
console.log('violations', sim.violations, 'recs', sim.recs.map(r => r.reason));
console.log(sim.log.filter(l => l.type === 'allocate').slice(0, 3).map(l => l.reason).join('\n'));
console.log(sim.log.filter(l => l.type === 'escalate').slice(0, 2).map(l => l.reason).join('\n'));
