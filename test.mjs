// test.mjs — run with:  node test.mjs
// Checks the data files and the FPTP calculations used by every page.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { tally, seatResult, validateExitPoll, parliamentOutcome, uniformSwing, swingTargets, actualSwing, MAJORITY, TOTAL_SEATS } from './calc.js';
import { generateAll } from './sim.js';

const parties = JSON.parse(readFileSync(new URL('./parties.json', import.meta.url)));
const { constituencies: cons } = JSON.parse(readFileSync(new URL('./constituencies.json', import.meta.url)));
const pids = new Set(parties.map((p) => p.id));
let n = 0;
const test = (name, fn) => {
  fn();
  n++;
  console.log(`  ✓ ${name}`);
};

console.log('Data');
test('exactly 650 constituencies', () => assert.equal(cons.length, TOTAL_SEATS));
test('unique IDs and names', () => {
  assert.equal(new Set(cons.map((c) => c.id)).size, 650);
  assert.equal(new Set(cons.map((c) => c.name)).size, 650);
});
test('every constituency has region, electorate, candidates, previous winner', () => {
  for (const c of cons) {
    assert.ok(c.region && c.electorate > 0 && c.candidates.length >= 2, c.id);
    assert.ok(pids.has(c.previous.winner), c.id);
    assert.equal(new Set(c.candidates.map((k) => k.id)).size, c.candidates.length, `${c.id} candidate ids`);
    c.candidates.forEach((k) => assert.ok(pids.has(k.party), `${c.id} ${k.party}`));
  }
});
test('starting parties: UIP purple, BWP red, Conservative blue, Others grey', () => {
  assert.deepEqual(parties.map((p) => p.id), ['UIP', 'BWP', 'CON', 'IND']);
});
test('unique hex positions', () => assert.equal(new Set(cons.map((c) => `${c.hex.col},${c.hex.row}`)).size, 650));

console.log('Calculations');
test('majority threshold is 326', () => assert.equal(MAJORITY, 326));
test('nothing counts before declaration', () => {
  const res = { [cons[0].id]: { status: 'counting', votes: Object.fromEntries(cons[0].candidates.map((k, i) => [k.id, 1000 + i])) } };
  const t = tally(cons, res, parties);
  assert.equal(t.declared, 0);
  assert.equal(Object.values(t.seats).reduce((a, b) => a + b, 0), 0);
  assert.equal(t.counting, 1);
});
test('FPTP: most votes wins, one MP per seat, majority = winner minus runner-up', () => {
  const c = cons[5];
  const votes = Object.fromEntries(c.candidates.map((k, i) => [k.id, [5000, 7000, 6500, 200, 100][i] ?? 10]));
  const sr = seatResult(c, { status: 'declared', votes });
  assert.equal(sr.winner.votes, 7000);
  assert.equal(sr.majority, 500);
  assert.ok(sr.declared);
});
test('a tie is never declared', () => {
  const c = cons[7];
  const votes = Object.fromEntries(c.candidates.map((k, i) => [k.id, i < 2 ? 4000 : 10]));
  assert.equal(seatResult(c, { status: 'declared', votes }).declared, false);
});
const results = generateAll(cons, { UIP: 8, CON: -9, BWP: 2 }, 42);
const full = tally(cons, results, parties);
test('full simulated night: 650 declared, seats sum to 650, never more', () => {
  assert.equal(full.declared, 650);
  assert.equal(Object.values(full.seats).reduce((a, b) => a + b, 0), 650);
  assert.equal(full.toDeclare, 0);
});
test('gains equal losses nationally; held + gains = seats', () => {
  const g = Object.values(full.gains).reduce((a, b) => a + b, 0);
  const l = Object.values(full.losses).reduce((a, b) => a + b, 0);
  assert.equal(g, l);
  for (const p of parties) assert.equal((full.held[p.id] || 0) + (full.gains[p.id] || 0), full.seats[p.id] || 0);
});
test('vote shares sum to 100% and match raw votes', () => {
  const s = Object.values(full.share).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(s - 100) < 1e-9);
  for (const p of parties) assert.ok(Math.abs(full.share[p.id] - (full.votes[p.id] / full.totalVotes) * 100) < 1e-9);
});
test('seat totals reflect FPTP, not proportional shares', () => {
  const winner = Object.keys(full.seats).sort((a, b) => full.seats[b] - full.seats[a])[0];
  const seatPct = (full.seats[winner] / 650) * 100;
  assert.ok(Math.abs(seatPct - full.share[winner]) > 3, 'seat share should differ from vote share under FPTP');
});
test('outcome: majority needs 326', () => {
  assert.equal(parliamentOutcome({ A: 326, B: 324 }).type, 'majority');
  assert.equal(parliamentOutcome({ A: 326, B: 324 }).majority, 2);
  assert.equal(parliamentOutcome({ A: 325, B: 325 }).type, 'hung');
  assert.equal(parliamentOutcome({ A: 325, B: 300, C: 25 }).short, 1);
  assert.equal(parliamentOutcome({ A: 200 }, 300).type, 'in-play');
});
test('exit poll must total exactly 650 whole seats', () => {
  assert.ok(validateExitPoll({ UIP: 300, BWP: 200, CON: 120, IND: 30 }).ok);
  assert.equal(validateExitPoll({ UIP: 300, BWP: 200, CON: 120, IND: 29 }).ok, false);
  assert.equal(validateExitPoll({ UIP: 300.5, BWP: 199.5, CON: 120, IND: 30 }).ok, false);
});
test('exit poll is independent from results (tally ignores it)', () => {
  const before = JSON.stringify(tally(cons, {}, parties).seats);
  assert.equal(before, JSON.stringify(Object.fromEntries(parties.map((p) => [p.id, 0]))));
});
test('uniform swing 0 reproduces previous result', () => {
  const u = uniformSwing(cons, parties, 'CON', 'BWP', 0);
  assert.equal(u.changes.length, 0);
  assert.equal(Object.values(u.seats).reduce((a, b) => a + b, 0), 650);
});
test('swingometer targets fall exactly at their required swing', () => {
  const targets = swingTargets(cons, 'CON', 'BWP').filter((t) => t.holder === 'CON' && t.need > 0.2 && t.need < 5);
  const t = targets[0];
  const before = uniformSwing([t.con], parties, 'CON', 'BWP', t.need - 0.05);
  const after = uniformSwing([t.con], parties, 'CON', 'BWP', t.need + 0.05);
  assert.equal(before.changes.length, 0);
  assert.equal(after.changes[0]?.to, 'BWP');
});
test('actual swing uses declared seats only', () => {
  assert.equal(actualSwing(cons, {}, 'CON', 'UIP').count, 0);
  const a = actualSwing(cons, results, 'CON', 'UIP');
  assert.equal(a.count, 650);
  assert.ok(a.value > 5 && a.value < 12, `swing ${a.value}`);
});

console.log(`\n${n} checks passed.`);
console.log('Simulated sample seats:', JSON.stringify(full.seats), 'outcome', full.outcome.type);
