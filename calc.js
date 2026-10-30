// calc.js — pure election maths for Usher (First Past the Post).
// No DOM access: safe to import in the browser and in Node tests.

export const TOTAL_SEATS = 650;
export const MAJORITY = 326;
export const STATUSES = ['awaiting', 'counting', 'recount', 'declared'];
export const STATUS_LABEL = {
  awaiting: 'Awaiting declaration',
  counting: 'Counting',
  recount: 'Recount',
  declared: 'Declared',
};

const pct = (n, d) => (d > 0 ? (n / d) * 100 : 0);

/** Party id a candidate counts towards nationally. Independents roll into IND ("Others"). */
export function partyOfCandidate(cand) {
  return cand.party || 'IND';
}

/** Previous-election vote share (percent) per party for a constituency. */
export function previousShares(con) {
  const votes = con.previous?.votes || {};
  const total = Object.values(votes).reduce((a, b) => a + b, 0);
  const out = {};
  for (const [p, v] of Object.entries(votes)) out[p] = pct(v, total);
  return out;
}

/** Current vote share (percent) per party from a result. */
export function currentShares(con, result) {
  const byParty = {};
  let total = 0;
  for (const c of con.candidates) {
    const v = Number(result?.votes?.[c.id]) || 0;
    total += v;
    const p = partyOfCandidate(c);
    byParty[p] = (byParty[p] || 0) + v;
  }
  const out = {};
  for (const [p, v] of Object.entries(byParty)) out[p] = pct(v, total);
  return out;
}

/** Butler two-party swing from party A to party B in percentage points. */
export function butlerSwing(prev, now, a, b) {
  const da = (now[a] || 0) - (prev[a] || 0);
  const db = (now[b] || 0) - (prev[b] || 0);
  return (db - da) / 2;
}

/**
 * Full result for one constituency. A winner exists only if votes have been entered;
 * the seat only counts nationally when status === 'declared'.
 */
export function seatResult(con, result) {
  const status = result?.status || 'awaiting';
  const ranked = con.candidates
    .map((c) => ({ ...c, votes: Number(result?.votes?.[c.id]) || 0 }))
    .sort((x, y) => y.votes - x.votes);
  const total = ranked.reduce((a, c) => a + c.votes, 0);
  ranked.forEach((c) => (c.share = pct(c.votes, total)));

  const hasVotes = total > 0;
  const winner = hasVotes ? ranked[0] : null;
  const runnerUp = hasVotes && ranked.length > 1 ? ranked[1] : null;
  const tie = !!(winner && runnerUp && winner.votes === runnerUp.votes);
  const majority = winner ? winner.votes - (runnerUp?.votes || 0) : 0;
  const prevWinner = con.previous?.winner || null;
  const winnerParty = winner ? partyOfCandidate(winner) : null;

  let outcome = null;
  let swing = null;
  if (winner) {
    outcome = winnerParty === prevWinner ? 'HOLD' : 'GAIN';
    const prev = previousShares(con);
    const now = currentShares(con, result);
    // Swing measured from the previous winner to whoever is now strongest against them.
    let from = prevWinner;
    let to = winnerParty;
    if (outcome === 'HOLD') {
      const challenger = ranked.find((c) => partyOfCandidate(c) !== winnerParty);
      to = challenger ? partyOfCandidate(challenger) : null;
      from = winnerParty;
    }
    if (from && to && from !== to) {
      swing = { from, to, value: butlerSwing(prev, now, from, to) };
    }
  }

  return {
    id: con.id,
    status,
    declared: status === 'declared' && hasVotes && !tie,
    ranked,
    total,
    turnout: pct(total, con.electorate),
    winner,
    winnerParty,
    runnerUp,
    majority,
    tie,
    prevWinner,
    outcome,
    swing,
  };
}

/** National standings from declared constituencies only. */
export function tally(constituencies, results, parties) {
  const seats = {};
  const gains = {};
  const losses = {};
  const held = {};
  const votes = {};
  const prevVotes = {};
  const prevSeatsAll = {};
  for (const p of parties) {
    seats[p.id] = gains[p.id] = losses[p.id] = held[p.id] = votes[p.id] = prevVotes[p.id] = prevSeatsAll[p.id] = 0;
  }
  const bump = (obj, k, n = 1) => (obj[k] = (obj[k] || 0) + n);

  let declared = 0;
  let counting = 0;
  let recount = 0;
  let totalVotes = 0;
  let prevTotal = 0;
  let electorate = 0;
  const latest = [];

  for (const con of constituencies) {
    bump(prevSeatsAll, con.previous?.winner);
    const r = results[con.id];
    if (r?.status === 'counting') counting++;
    if (r?.status === 'recount') recount++;
    const sr = seatResult(con, r);
    if (!sr.declared) continue;
    declared++;
    bump(seats, sr.winnerParty);
    if (sr.outcome === 'GAIN') {
      bump(gains, sr.winnerParty);
      if (sr.prevWinner) bump(losses, sr.prevWinner);
    } else bump(held, sr.winnerParty);

    for (const c of sr.ranked) {
      bump(votes, partyOfCandidate(c), c.votes);
      totalVotes += c.votes;
    }
    for (const [p, v] of Object.entries(con.previous?.votes || {})) {
      bump(prevVotes, p, v);
      prevTotal += v;
    }
    electorate += con.electorate;
    latest.push({ con, sr, at: r.declaredAt || r.updatedAt || 0, source: r.source || 'manual' });
  }

  const share = {};
  const prevShare = {};
  for (const p of Object.keys(votes)) {
    share[p] = pct(votes[p], totalVotes);
    prevShare[p] = pct(prevVotes[p] || 0, prevTotal);
  }

  // National swing between the two parties with the most votes so far.
  const top = Object.keys(share).sort((a, b) => share[b] - share[a]).slice(0, 2);
  let nationalSwing = null;
  if (declared > 0 && top.length === 2) {
    // Express as swing from the party that was ahead previously to the other.
    const [x, y] = (prevShare[top[0]] || 0) >= (prevShare[top[1]] || 0) ? top : [top[1], top[0]];
    nationalSwing = { from: x, to: y, value: butlerSwing(prevShare, share, x, y) };
  }

  latest.sort((a, b) => b.at - a.at);

  return {
    seats,
    gains,
    losses,
    held,
    net: Object.fromEntries(Object.keys(seats).map((p) => [p, (gains[p] || 0) - (losses[p] || 0)])),
    votes,
    totalVotes,
    share,
    prevShare,
    prevSeats: prevSeatsAll,
    turnout: pct(totalVotes, electorate),
    declared,
    counting,
    recount,
    toDeclare: constituencies.length - declared,
    nationalSwing,
    latest,
    outcome: parliamentOutcome(seats, declared),
  };
}

/**
 * Describe the parliamentary position given seat totals.
 * `complete` should be true when all 650 are decided (or for a full projection).
 */
export function parliamentOutcome(seats, decided = TOTAL_SEATS) {
  const order = Object.entries(seats).filter(([p]) => p !== 'IND').sort((a, b) => b[1] - a[1]);
  if (!order.length || order[0][1] === 0) return { type: 'none' };
  const [leader, n] = order[0];
  const tiedLead = order[1] && order[1][1] === n;
  if (n >= MAJORITY) {
    return { type: 'majority', leader, seats: n, majority: 2 * n - TOTAL_SEATS, decided };
  }
  const remaining = TOTAL_SEATS - decided;
  if (decided < TOTAL_SEATS && n + remaining >= MAJORITY) {
    return { type: 'in-play', leader: tiedLead ? null : leader, seats: n, needed: MAJORITY - n, decided };
  }
  return { type: 'hung', leader: tiedLead ? null : leader, seats: n, short: MAJORITY - n, decided };
}

export function outcomeHeadline(outcome, partyName) {
  const name = (id) => (id ? partyName(id) : 'No party');
  switch (outcome.type) {
    case 'majority':
      return `${name(outcome.leader)} majority of ${outcome.majority}`;
    case 'hung':
      return outcome.leader
        ? `Hung parliament — ${name(outcome.leader)} short by ${outcome.short}`
        : 'Hung parliament — parties tied';
    case 'in-play':
      return outcome.leader
        ? `${name(outcome.leader)} need ${outcome.needed} more for a majority`
        : 'Leading parties tied';
    default:
      return 'No seats declared';
  }
}

/** Exit poll validation: whole numbers, none negative, total exactly 650. */
export function validateExitPoll(seats) {
  const errors = [];
  let total = 0;
  for (const [p, v] of Object.entries(seats)) {
    if (!Number.isInteger(v) || v < 0) errors.push(`${p}: seat projection must be a whole number of 0 or more.`);
    total += Number(v) || 0;
  }
  if (total !== TOTAL_SEATS) errors.push(`Projections total ${total}; they must total exactly ${TOTAL_SEATS}.`);
  return { ok: errors.length === 0, total, errors };
}

/**
 * Hypothetical uniform national swing applied to the PREVIOUS election.
 * `swing` is percentage points moving from party a to party b (negative = b to a).
 * Returns projected seats per party and the seats that change hands.
 */
export function uniformSwing(constituencies, parties, a, b, swing) {
  const seats = Object.fromEntries(parties.map((p) => [p.id, 0]));
  const changes = [];
  for (const con of constituencies) {
    const sh = { ...previousShares(con) };
    sh[a] = (sh[a] || 0) - swing;
    sh[b] = (sh[b] || 0) + swing;
    const winner = Object.keys(sh).sort((x, y) => sh[y] - sh[x])[0];
    seats[winner] = (seats[winner] || 0) + 1;
    if (winner !== con.previous.winner) changes.push({ con, from: con.previous.winner, to: winner });
  }
  return { seats, changes };
}

/**
 * Target seats for a two-party swingometer: for every seat where a and b are
 * the top two last time, the swing needed for the second to overtake the first.
 * Positive `need` = swing from a to b needed for b to gain; negative = for a to gain.
 */
export function swingTargets(constituencies, a, b) {
  const out = [];
  for (const con of constituencies) {
    const sh = previousShares(con);
    const top = Object.keys(sh).sort((x, y) => sh[y] - sh[x]);
    if (!((top[0] === a && top[1] === b) || (top[0] === b && top[1] === a))) continue;
    const need = ((sh[a] || 0) - (sh[b] || 0)) / 2; // >0: a held it, b needs +need
    out.push({ con, need, holder: top[0] });
  }
  return out.sort((x, y) => Math.abs(x.need) - Math.abs(y.need));
}

/** Actual average constituency swing from a to b, using declared seats only. */
export function actualSwing(constituencies, results, a, b) {
  let sum = 0;
  let n = 0;
  for (const con of constituencies) {
    const r = results[con.id];
    const sr = seatResult(con, r);
    if (!sr.declared) continue;
    const prev = previousShares(con);
    const now = currentShares(con, r);
    if (!(a in prev) || !(b in prev)) continue;
    sum += butlerSwing(prev, now, a, b);
    n++;
  }
  return { value: n ? sum / n : 0, count: n };
}

export function fmt(n) {
  return Math.round(n).toLocaleString('en-GB');
}
export function fmtPct(n, dp = 1) {
  return `${(Math.round(n * 10 ** dp) / 10 ** dp).toFixed(dp)}%`;
}
export function signed(n, dp = 0) {
  const v = dp ? n.toFixed(dp) : String(Math.round(n));
  return n > 0 ? `+${v}` : v;
}
