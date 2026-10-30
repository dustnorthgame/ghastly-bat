// sim.js — sample result generator for simulation mode. Pure functions, no DOM.
import { previousShares, partyOfCandidate } from './calc.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng) {
  const u = Math.max(rng(), 1e-9);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Generate votes for one constituency.
 * shift: { partyId: percentage-point change in national share } e.g. { UIP: +6, CON: -5 }
 * regionShift: { region: { partyId: pp } } optional extra local movement.
 */
export function generateVotes(con, shift, rng, regionShift = {}) {
  const prev = previousShares(con);
  const local = regionShift[con.region] || {};
  const parties = [...new Set(con.candidates.map(partyOfCandidate))];

  const share = {};
  for (const p of parties) {
    const base = prev[p] ?? 2;
    share[p] = Math.max(0.5, base + (shift[p] || 0) + (local[p] || 0) + gauss(rng) * 3.2);
  }
  const sum = Object.values(share).reduce((a, b) => a + b, 0);

  const prevTurnout = con.previous?.turnout || 0.65;
  const turnout = Math.min(0.85, Math.max(0.45, prevTurnout + gauss(rng) * 0.03));
  const total = Math.round(con.electorate * turnout);

  const votes = {};
  for (const p of parties) {
    const cands = con.candidates.filter((c) => partyOfCandidate(c) === p);
    const partyVotes = (share[p] / sum) * total;
    // Several independents split the "others" share unevenly.
    const weights = cands.map(() => 0.5 + rng());
    const wsum = weights.reduce((a, b) => a + b, 0);
    cands.forEach((c, i) => (votes[c.id] = Math.max(1, Math.round((partyVotes * weights[i]) / wsum))));
  }
  return votes;
}

/** Convenience: generate a full set of results objects for every constituency. */
export function generateAll(constituencies, shift, seed = Date.now()) {
  const rng = mulberry32(seed);
  const out = {};
  for (const con of constituencies) {
    out[con.id] = { status: 'declared', votes: generateVotes(con, shift, rng), source: 'sim', updatedAt: 0, declaredAt: 0 };
  }
  return out;
}
