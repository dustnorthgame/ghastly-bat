// views.js — connects election data to the 3D graphics. Shared by the public site and broadcast mode.
import { store } from './store.js';
import {
  parliamentOutcome,
  outcomeHeadline,
  seatResult,
  swingTargets,
  uniformSwing,
  actualSwing,
  validateExitPoll,
  MAJORITY,
  TOTAL_SEATS,
  fmt,
  fmtPct,
  signed,
  STATUS_LABEL,
} from './calc.js';
import * as G from './graphics3d.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const P = (id) => store.partyById(id);

// ---------------------------------------------------------------- GeoJSON source
const GEO_KEY = 'usher-geojson-v1';
let geoCache;
export async function getGeoJSON() {
  if (geoCache !== undefined) return geoCache;
  try {
    const local = localStorage.getItem(GEO_KEY);
    if (local) return (geoCache = JSON.parse(local));
  } catch {}
  try {
    const r = await fetch('map.geojson', { cache: 'no-store' });
    if (r.ok) return (geoCache = await r.json());
  } catch {}
  return (geoCache = null);
}
export function setGeoJSON(obj) {
  geoCache = obj;
  try {
    if (obj) localStorage.setItem(GEO_KEY, JSON.stringify(obj));
    else localStorage.removeItem(GEO_KEY);
    return true;
  } catch {
    return false; // too large for localStorage: kept for this session only
  }
}

// ---------------------------------------------------------------- helpers
function placeholder(el, title, text) {
  el.innerHTML = `<div class="g-empty"><div><p class="eyebrow">${esc(title)}</p><p>${esc(text)}</p></div></div>`;
  return { dispose() { el.innerHTML = ''; } };
}

/** Remount a scene whenever its data signature changes. */
function reactive(el, signature, mount) {
  let sig = null;
  let ctl = null;
  let busy = false;
  async function run() {
    const s = signature();
    if (s === sig || busy) return;
    busy = true;
    sig = s;
    ctl?.dispose();
    el.innerHTML = '';
    ctl = await mount();
    busy = false;
    if (signature() !== sig) run();
  }
  const off = store.subscribe(run);
  run();
  return {
    replay: () => ctl?.replay?.(),
    dispose() {
      off();
      ctl?.dispose();
    },
  };
}

export function exitPollEntries(seats) {
  return store.parties
    .filter((p) => seats[p.id] !== undefined)
    .map((p) => ({ id: p.id, name: p.name, short: p.short, colour: p.colour, image: p.image || '', seats: Number(seats[p.id]) || 0 }));
}

// ---------------------------------------------------------------- exit poll
export function mountExitPoll(el, { preview = false, variant = 'stage' } = {}) {
  return reactive(
    el,
    () => JSON.stringify([store.election.exitPoll, preview, variant, store.parties]),
    async () => {
      const ep = store.election.exitPoll;
      if (!ep.published && !preview) return placeholder(el, 'Exit poll', 'The exit poll is published when polls close at 10pm.');
      const v = validateExitPoll(Object.fromEntries(Object.entries(ep.seats).map(([k, x]) => [k, Number(x)])));
      if (!v.ok) return placeholder(el, 'Exit poll', v.errors.join(' '));
      const entries = exitPollEntries(ep.seats);
      const seats = Object.fromEntries(entries.map((e) => [e.id, e.seats]));
      const outcome = outcomeHeadline(parliamentOutcome(seats, TOTAL_SEATS), (id) => P(id).short);
      if (variant === 'wall') {
        const prev = store.tally().prevSeats;
        return G.partyWallScene(
          el,
          entries.sort((a, b) => b.seats - a.seats).map((e) => ({ ...e, change: e.seats - (prev[e.id] || 0) })),
          { prevLabel: store.election.previousLabel }
        );
      }
      return G.exitPollScene(el, entries, { outcomeText: outcome, note: `Projection, not declared results · ${MAJORITY} for a majority · ${TOTAL_SEATS} seats` });
    }
  );
}

// ---------------------------------------------------------------- columns
export function barItems(kind) {
  const t = store.tally();
  const parties = store.parties;
  if (kind === 'projection') {
    const s = store.election.exitPoll.seats;
    return parties.filter((p) => s[p.id] !== undefined).map((p) => ({ id: p.id, label: p.short, colour: p.colour, value: Number(s[p.id]) || 0 }));
  }
  if (kind === 'share') return parties.map((p) => ({ id: p.id, label: p.short, colour: p.colour, value: Math.round((t.share[p.id] || 0) * 10) / 10 }));
  if (kind === 'net') return parties.map((p) => ({ id: p.id, label: p.short, colour: p.colour, value: t.net[p.id] || 0 }));
  return parties.map((p) => ({ id: p.id, label: p.short, colour: p.colour, value: t.seats[p.id] || 0 }));
}

export function mountBars(el, kind = 'seats', opts = {}) {
  const cfg = {
    seats: { line: { value: MAJORITY, label: `${MAJORITY} FOR MAJORITY` }, max: null },
    projection: { line: { value: MAJORITY, label: `${MAJORITY} FOR MAJORITY` }, max: null },
    share: { unit: '%', max: null },
    net: { max: null },
  }[kind];
  let ctl = null;
  let ready = null;
  const compute = () => {
    const items = barItems(kind);
    const top = Math.max(...items.map((i) => Math.abs(i.value)), 1);
    const max = kind === 'seats' || kind === 'projection' ? Math.max(MAJORITY * 1.12, top) : top * 1.1;
    return { items, max };
  };
  const { items, max } = compute();
  ready = G.barsScene(el, items, { ...cfg, ...opts, max }).then((c) => (ctl = c));
  let lastSig = JSON.stringify(items);
  const off = store.subscribe(() => {
    const next = compute();
    const sig = JSON.stringify(next.items);
    if (sig === lastSig || !ctl) return;
    lastSig = sig;
    ctl.update(next.items);
  });
  return {
    ready,
    dispose() {
      off();
      ready.then(() => ctl.dispose());
    },
  };
}

// ---------------------------------------------------------------- chamber
export function chamberGroups() {
  const t = store.tally();
  const parties = [...store.parties].sort((a, b) => (t.seats[b.id] || 0) - (t.seats[a.id] || 0));
  const groups = parties.filter((p) => t.seats[p.id] > 0).map((p) => ({ id: p.id, colour: p.colour, count: t.seats[p.id] }));
  if (t.toDeclare) groups.push({ id: '_none', colour: '#39404c', count: t.toDeclare });
  return groups;
}
export function mountChamber(el) {
  return reactive(
    el,
    () => JSON.stringify(chamberGroups()),
    async () => {
      const groups = chamberGroups();
      const ctl = await G.chamberScene(el, groups, { majority: MAJORITY });
      const t = store.tally();
      ctl.overlay.innerHTML = `<div class="ch-legend">${groups
        .map((g) => `<span><i style="background:${g.colour}"></i>${g.id === '_none' ? 'To declare' : esc(P(g.id).short)} <b>${g.count}</b></span>`)
        .join('')}</div><div class="ch-note">${groups[0] && groups[0].id !== '_none' ? `Largest party (${esc(P(groups[0].id).short)}) shown on the government benches` : 'No seats declared yet'} · ${t.declared}/${TOTAL_SEATS} declared</div>`;
      return ctl;
    }
  );
}

// ---------------------------------------------------------------- map
export function seatStyle(con) {
  const r = store.election.results[con.id];
  const status = r?.status || 'awaiting';
  const sr = seatResult(con, r);
  if (sr.declared) return { colour: P(sr.winnerParty).colour, height: sr.outcome === 'GAIN' ? 0.85 : 0.55 };
  if (status === 'recount') return { colour: '#5a4a1a', height: 0.22, pulse: '#e3b341' };
  if (status === 'counting') return { colour: '#353d4b', height: 0.16, pulse: '#5d6a80' };
  return { colour: '#262c37', height: 0.1 };
}
export async function mountMap(el, opts = {}) {
  const geo = await getGeoJSON();
  const ctl = await G.mapScene(el, store.constituencies, seatStyle, { geojson: geo, ...opts });
  const off = store.subscribe(() => ctl.refresh());
  return {
    ...ctl,
    geoLoaded: ctl.mode() === 'geo',
    dispose() {
      off();
      ctl.dispose();
    },
  };
}

// ---------------------------------------------------------------- swingometer
export function mountSwingometer(el, { compact = false, initial } = {}) {
  const parties = store.parties.filter((p) => !p.isOthers);
  const t = store.tally();
  const byPrev = [...parties].sort((a, b) => (t.prevSeats[b.id] || 0) - (t.prevSeats[a.id] || 0));
  const st = {
    a: initial?.a || byPrev[0]?.id,
    b: initial?.b || byPrev[1]?.id,
    mode: initial?.mode || (t.declared > 0 ? 'actual' : 'hypothetical'),
    swing: initial?.swing ?? 0,
  };
  let ctl = null;
  const ready = G.swingometerScene(el, {}).then((c) => {
    ctl = c;
    buildUI();
    apply(true);
  });

  function buildUI() {
    const opt = (sel) => parties.map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    ctl.overlay.innerHTML = `
      <div class="sw-top">
        <div class="sw-mode" role="tablist" aria-label="Swing type">
          <button role="tab" data-mode="actual">Actual swing</button>
          <button role="tab" data-mode="hypothetical">Hypothetical swing</button>
        </div>
        <p class="sw-modenote"></p>
      </div>
      <div class="sw-readout">
        <div class="sw-big"><span class="sw-val">0.0%</span><span class="sw-dir"></span></div>
        <div class="sw-seats"></div>
      </div>
      <div class="sw-controls ${compact ? 'compact' : ''}">
        <label>From <select data-k="a">${opt(st.a)}</select></label>
        <label>To <select data-k="b">${opt(st.b)}</select></label>
        <label class="sw-slider">Swing <input type="range" min="-15" max="15" step="0.1" value="${st.swing}" aria-label="Hypothetical swing in percentage points"></label>
      </div>`;
    const ov = ctl.overlay;
    ov.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { st.mode = b.dataset.mode; apply(true); }));
    ov.querySelectorAll('select').forEach((s) =>
      s.addEventListener('change', () => {
        st[s.dataset.k] = s.value;
        if (st.a === st.b) {
          const other = parties.find((p) => p.id !== st.a);
          st[s.dataset.k === 'a' ? 'b' : 'a'] = other.id;
          ov.querySelector(`select[data-k="${s.dataset.k === 'a' ? 'b' : 'a'}"]`).value = other.id;
        }
        apply(true);
      })
    );
    ov.querySelector('input[type=range]').addEventListener('input', (e) => {
      st.swing = Number(e.target.value);
      st.mode = 'hypothetical';
      apply(false);
    });
  }

  function apply(reTarget) {
    if (!ctl) return;
    const a = P(st.a), b = P(st.b);
    const ov = ctl.overlay;
    let swing = st.swing;
    let note;
    if (st.mode === 'actual') {
      const act = actualSwing(store.constituencies, store.election.results, st.a, st.b);
      swing = act.value;
      note = act.count
        ? `ACTUAL — average constituency swing across ${act.count} declared seat${act.count === 1 ? '' : 's'}. Seat figures show what this swing would mean if repeated everywhere.`
        : 'ACTUAL — no declared constituencies yet. Switch to hypothetical to explore scenarios.';
    } else {
      note = 'HYPOTHETICAL — a uniform national swing applied to last election’s result in every seat. Not a real result.';
    }
    const proj = uniformSwing(store.constituencies, store.parties, st.a, st.b, swing);
    const gainsB = proj.changes.filter((c) => c.to === st.b).length;
    const gainsA = proj.changes.filter((c) => c.to === st.a).length;
    ctl.set({ a: reTarget ? a : null, b: reTarget ? b : null, swing, targets: reTarget ? swingTargets(store.constituencies, st.a, st.b) : null });
    ov.querySelectorAll('[data-mode]').forEach((btn) => btn.setAttribute('aria-selected', btn.dataset.mode === st.mode));
    ov.querySelector('.sw-modenote').textContent = note;
    ov.querySelector('.sw-modenote').dataset.mode = st.mode;
    ov.querySelector('.sw-val').textContent = `${Math.abs(swing).toFixed(1)}%`;
    const towards = swing >= 0 ? b : a;
    const away = swing >= 0 ? a : b;
    ov.querySelector('.sw-dir').innerHTML = `swing from <b style="color:${away.colour}">${esc(away.short)}</b> to <b style="color:${towards.colour}">${esc(towards.short)}</b>`;
    const range = ov.querySelector('input[type=range]');
    if (document.activeElement !== range) range.value = swing.toFixed(1);
    const prev = store.tally().prevSeats;
    const row = (p) => {
      const n = proj.seats[p.id] || 0;
      const d = n - (prev[p.id] || 0);
      return `<div class="sw-row" style="--c:${p.colour}"><span>${esc(p.short)}</span><b>${n}</b><em>${signed(d)}</em></div>`;
    };
    ov.querySelector('.sw-seats').innerHTML = `${row(a)}${row(b)}<div class="sw-gains">${esc(b.short)} gains ${gainsB} · ${esc(a.short)} gains ${gainsA}</div>`;
  }

  const off = store.subscribe(() => st.mode === 'actual' && apply(false));
  return {
    ready,
    setSwing(v) {
      st.mode = 'hypothetical';
      st.swing = v;
      apply(false);
    },
    dispose() {
      off();
      ready.then(() => ctl.dispose());
    },
  };
}

// ---------------------------------------------------------------- declaration
export function latestDeclared() {
  return store.tally().latest[0] || null;
}
export function mountDeclaration(el, id) {
  return reactive(
    el,
    () => {
      const target = id || latestDeclared()?.con.id;
      const r = target ? store.election.results[target] : null;
      return JSON.stringify([target, r]);
    },
    async () => {
      const target = id || latestDeclared()?.con.id;
      const con = target && store.conById(target);
      if (!con) return placeholder(el, 'Declaration', 'No constituency has declared yet.');
      const sr = seatResult(con, store.election.results[con.id]);
      if (!sr.declared) return placeholder(el, con.name, `${STATUS_LABEL[sr.status]} — this seat has not declared.`);
      const ctl = await G.declarationScene(el, sr, P);
      const w = P(sr.winnerParty);
      const sw = sr.swing ? `${fmtPct(Math.abs(sr.swing.value))} swing ${sr.swing.value >= 0 ? `${P(sr.swing.from).short} to ${P(sr.swing.to).short}` : `${P(sr.swing.to).short} to ${P(sr.swing.from).short}`}` : '';
      ctl.overlay.innerHTML = `
        <div class="dec-head" style="--c:${w.colour}">
          <p class="eyebrow">${esc(con.region)} · Declaration</p>
          <h2>${esc(con.name)}</h2>
          <p>${sr.outcome === 'GAIN' ? `<b>${esc(w.short)} gain from ${esc(P(sr.prevWinner).short)}</b>` : `<b>${esc(w.short)} hold</b>`} · Majority ${fmt(sr.majority)} · Turnout ${fmtPct(sr.turnout)}${sw ? ` · ${sw}` : ''}</p>
        </div>`;
      return ctl;
    }
  );
}

// ---------------------------------------------------------------- victory
export function mountVictory(el, { projection = false } = {}) {
  return reactive(
    el,
    () => JSON.stringify([projection ? store.election.exitPoll : store.tally().seats]),
    async () => {
      const seats = projection ? Object.fromEntries(Object.entries(store.election.exitPoll.seats).map(([k, v]) => [k, Number(v)])) : store.tally().seats;
      const decided = projection ? TOTAL_SEATS : store.tally().declared;
      const o = parliamentOutcome(seats, decided);
      if (o.type === 'none' || !o.leader) return placeholder(el, 'Result', 'No outcome to announce yet.');
      const p = P(o.leader);
      const ctl = await G.victoryScene(el, p, o.seats);
      let head, sub;
      if (o.type === 'majority') {
        head = `${p.name} wins`;
        sub = `Overall majority of ${o.majority} · ${o.seats} seats`;
      } else if (o.type === 'hung') {
        head = 'Hung parliament';
        sub = `${p.name} largest party · ${o.short} short of a majority`;
      } else {
        head = `${p.name} lead`;
        sub = `${o.seats} seats · ${o.needed} more needed for a majority · ${decided}/${TOTAL_SEATS} declared`;
      }
      ctl.overlay.innerHTML = `<div class="vic-head" style="--c:${p.colour}"><p class="eyebrow">${projection ? 'Exit poll projection' : 'Usher decides'}</p><h2>${esc(head)}</h2><p>${esc(sub)}</p></div>`;
      return ctl;
    }
  );
}

// ---------------------------------------------------------------- HTML lower thirds (transparent-friendly)
export function mountBreaking(el) {
  const draw = () => {
    const b = store.election.banner;
    const last = store.election.announcements[0];
    const text = b.visible && b.text ? b.text : last?.text;
    el.innerHTML = text
      ? `<div class="lt lt-breaking ${b.visible ? 'on' : ''}"><span class="lt-tag">${b.visible ? esc((b.style || 'breaking').toUpperCase()) : 'LATEST'}</span><span class="lt-text">${esc(text)}</span></div>`
      : '';
  };
  draw();
  const off = store.subscribe(draw);
  return { dispose: () => { off(); el.innerHTML = ''; } };
}

export function tickerHTML() {
  const e = store.election;
  const t = store.tally();
  const items = [...e.ticker];
  t.latest.slice(0, 6).forEach(({ con, sr }) => {
    items.push(`${con.name}: ${P(sr.winnerParty).short} ${sr.outcome === 'GAIN' ? `GAIN from ${P(sr.prevWinner).short}` : 'HOLD'} · majority ${fmt(sr.majority)}`);
  });
  const seats = store.parties.map((p) => `${p.short} ${t.seats[p.id] || 0}`).join(' · ');
  items.push(`Seats: ${seats} · ${t.declared} of ${TOTAL_SEATS} declared`);
  return items.map((s) => `<span>${esc(s)}</span>`).join('<i aria-hidden="true">◆</i>');
}
export function mountTicker(el) {
  let last = '';
  const draw = () => {
    const html = tickerHTML();
    if (html === last) return;
    last = html;
    el.innerHTML = `<div class="ticker" role="marquee" aria-label="Election news ticker"><span class="ticker-tag">ELECTION</span><div class="ticker-track"><div class="ticker-run">${html}<i aria-hidden="true">◆</i>${html}</div></div></div>`;
    const run = el.querySelector('.ticker-run');
    run.style.animationDuration = `${Math.max(30, run.textContent.length / 7)}s`;
  };
  draw();
  const off = store.subscribe(draw);
  return { dispose: () => { off(); el.innerHTML = ''; } };
}

export function mountGainsList(el) {
  const draw = () => {
    const t = store.tally();
    const gains = t.latest.filter((l) => l.sr.outcome === 'GAIN').slice(0, 8);
    el.innerHTML = `<div class="gl"><p class="eyebrow">Latest gains</p>${
      gains.length
        ? gains.map(({ con, sr }) => `<div class="gl-row" style="--c:${P(sr.winnerParty).colour};--p:${P(sr.prevWinner).colour}"><b>${esc(P(sr.winnerParty).short)} gain</b><span>${esc(con.name)}</span><em>from ${esc(P(sr.prevWinner).short)}</em></div>`).join('')
        : '<p class="muted">No seats have changed hands yet.</p>'
    }</div>`;
  };
  draw();
  const off = store.subscribe(draw);
  return { dispose: () => { off(); el.innerHTML = ''; } };
}

/** Registry used by broadcast.html and the graphics page. */
export const GRAPHICS = {
  exitpoll: { title: 'Exit poll — honeycomb reveal', mount: (el, p) => mountExitPoll(el, { preview: p.preview === '1' }) },
  exitwall: { title: 'Exit poll — party panel wall', mount: (el, p) => mountExitPoll(el, { preview: p.preview === '1', variant: 'wall' }) },
  projection: { title: 'Exit poll — projected seat columns', mount: (el) => mountBars(el, 'projection') },
  seats: { title: 'Seat standings with majority line', mount: (el) => mountBars(el, 'seats') },
  share: { title: 'National vote share', mount: (el) => mountBars(el, 'share') },
  net: { title: 'Net gains and losses', mount: (el) => mountBars(el, 'net') },
  chamber: { title: 'House of Commons composition', mount: (el) => mountChamber(el) },
  swing: { title: 'Swingometer', mount: (el, p) => mountSwingometer(el, { compact: true, initial: { a: p.a, b: p.b, mode: p.mode, swing: p.swing ? Number(p.swing) : undefined } }) },
  map: { title: 'Constituency map', mount: (el) => mountMap(el) },
  declaration: { title: 'Constituency declaration', mount: (el, p) => mountDeclaration(el, p.id) },
  victory: { title: 'Election outcome announcement', mount: (el) => mountVictory(el) },
  breaking: { title: 'Breaking news lower third (transparent)', mount: (el) => mountBreaking(el), html: true },
  ticker: { title: 'News ticker (transparent)', mount: (el) => mountTicker(el), html: true },
  gains: { title: 'Latest gains list', mount: (el) => mountGainsList(el), html: true },
};
