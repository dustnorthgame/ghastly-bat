// app.js — public election website (hash router).
import { store } from './store.js';
import {
  seatResult,
  previousShares,
  currentShares,
  outcomeHeadline,
  parliamentOutcome,
  MAJORITY,
  TOTAL_SEATS,
  STATUS_LABEL,
  fmt,
  fmtPct,
  signed,
} from './calc.js';
import * as V from './views.js';

const { esc } = V;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const main = $('#main');
const P = (id) => store.partyById(id);

let mounted = []; // controllers to dispose on navigation
let pageOff = null; // per-page store subscription
const keep = (c) => (mounted.push(c), c);

function cleanup() {
  mounted.forEach((c) => (c?.then ? c.then((x) => x?.dispose?.()) : c?.dispose?.()));
  mounted = [];
  pageOff?.();
  pageOff = null;
  $('#tip').hidden = true;
}

// ---------------------------------------------------------------- shared fragments
const STATUS_TEXT = { upcoming: 'Polls not yet open', 'polls-open': 'Polls open', 'polls-closed': 'Polls closed', counting: 'Counting under way', complete: 'All results declared' };

function partyChip(id, extra = '') {
  const p = P(id);
  return `<span class="pchip" style="--c:${p.colour}">${esc(p.short)}${extra}</span>`;
}
function statusTag(status) {
  return `<span class="stag stag-${status}">${esc(STATUS_LABEL[status] || status)}</span>`;
}

/** Horizontal stacked seat bar with a majority line. */
function seatBar(seats, { label = '' } = {}) {
  const parties = [...store.parties].sort((a, b) => (seats[b.id] || 0) - (seats[a.id] || 0));
  const others = parties.filter((p) => p.isOthers);
  const order = [...parties.filter((p) => !p.isOthers), ...others];
  const declared = order.reduce((a, p) => a + (seats[p.id] || 0), 0);
  const segs = order
    .filter((p) => seats[p.id])
    .map((p) => `<span class="sb-seg" style="--c:${p.colour};width:${(seats[p.id] / TOTAL_SEATS) * 100}%" title="${esc(p.name)}: ${seats[p.id]}"></span>`)
    .join('');
  return `<div class="seatbar" aria-label="${esc(label || 'Seat totals')}">
    <div class="sb-track">${segs}<span class="sb-rest" style="width:${((TOTAL_SEATS - declared) / TOTAL_SEATS) * 100}%"></span></div>
    <span class="sb-maj" style="left:${(MAJORITY / TOTAL_SEATS) * 100}%"><em>${MAJORITY}</em></span>
  </div>`;
}

function shareBars(share, prevShare) {
  const rows = [...store.parties].sort((a, b) => (share[b.id] || 0) - (share[a.id] || 0));
  const max = Math.max(5, ...rows.map((p) => share[p.id] || 0));
  return `<div class="hbars">${rows
    .map((p) => {
      const s = share[p.id] || 0;
      const d = s - (prevShare[p.id] || 0);
      return `<div class="hb" style="--c:${p.colour}"><span class="hb-l">${esc(p.short)}</span><span class="hb-t"><i style="width:${(s / max) * 100}%"></i></span><b>${fmtPct(s)}</b><em class="${d >= 0 ? 'up' : 'down'}">${signed(d, 1)}</em></div>`;
    })
    .join('')}</div>`;
}

function timeAgo(t) {
  if (!t) return '';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function declarationRow({ con, sr, source }) {
  const w = P(sr.winnerParty);
  return `<a class="decl" href="#/seat/${con.id}" style="--c:${w.colour}">
    <span class="decl-flag">${sr.outcome === 'GAIN' ? 'GAIN' : 'HOLD'}</span>
    <span class="decl-main"><b>${esc(con.name)}</b><small>${esc(w.short)}${sr.outcome === 'GAIN' ? ` gain from ${esc(P(sr.prevWinner).short)}` : ' hold'} · majority ${fmt(sr.majority)}${source === 'sim' ? ' · <span class="simtag">SIM</span>' : ''}</small></span>
  </a>`;
}

// ---------------------------------------------------------------- chrome
function renderChrome() {
  const e = store.election;
  const t = store.tally();
  $('#statusPill').innerHTML = `<span class="dot dot-${e.status}"></span>${esc(STATUS_TEXT[e.status] || e.status)} · <b>${t.declared}</b>/${TOTAL_SEATS}`;
  const b = e.banner;
  const banner = $('#banner');
  banner.hidden = !(b.visible && b.text);
  banner.className = `banner banner-${b.style || 'breaking'}`;
  banner.innerHTML = `<span>${esc((b.style || 'breaking').toUpperCase())}</span>${esc(b.text)}`;
  $('#simNotice').hidden = !store.hasSimulated();
  $('#modeNote').textContent =
    store.mode === 'live' ? 'Live results service' : 'Local demonstration mode — data is stored in this browser only';
  document.title = `${e.name} — Usher Decides`;
}

// ---------------------------------------------------------------- pages
const pages = {};

pages.home = () => {
  const draw = () => {
    const e = store.election;
    const t = store.tally();
    const ep = e.exitPoll;
    const showProjection = t.declared === 0 && ep.published;
    const seats = showProjection ? Object.fromEntries(Object.entries(ep.seats).map(([k, v]) => [k, Number(v)])) : t.seats;
    const head = t.declared
      ? outcomeHeadline(t.outcome, (id) => P(id).name)
      : ep.published
        ? `Exit poll: ${outcomeHeadline(parliamentOutcome(seats), (id) => P(id).name)}`
        : e.status === 'upcoming' || e.status === 'polls-open'
          ? 'Polls close at 10pm'
          : 'Awaiting the first declaration';
    $('#homeHead').innerHTML = `
      <p class="eyebrow">${esc(e.name)} · ${esc(STATUS_TEXT[e.status])}</p>
      <h1>${esc(head)}</h1>
      <div class="hero-parties">${store.parties
        .map((p) => `<div class="hp" style="--c:${p.colour}"><span>${esc(p.short)}</span><b>${seats[p.id] || 0}</b>${showProjection ? '<em>projected</em>' : `<em>${signed(t.net[p.id] || 0)}</em>`}</div>`)
        .join('')}</div>
      ${seatBar(seats, { label: showProjection ? 'Exit poll projection' : 'Declared seats' })}
      <p class="hero-meta">${showProjection ? '<span class="proj-chip">Projection</span> Exit poll figures, not declared results. ' : ''}${t.declared} of ${TOTAL_SEATS} declared · ${t.toDeclare} to declare · ${MAJORITY} for a majority</p>`;
    $('#homeHeroLabel').textContent = showProjection ? 'Exit poll projection' : 'Declared seats';

    $('#homeFeed').innerHTML = e.announcements.length
      ? e.announcements.slice(0, 12).map((a) => `<li class="feed-${a.priority}"><time>${esc(timeAgo(a.time))}</time><p>${esc(a.text)}</p></li>`).join('')
      : '<li class="muted">No announcements yet.</li>';
    $('#homeDecl').innerHTML = t.latest.length ? t.latest.slice(0, 10).map(declarationRow).join('') : '<p class="muted">No constituencies have declared yet.</p>';
    $('#homeShare').innerHTML = t.declared ? shareBars(t.share, t.prevShare) : '<p class="muted">Vote share appears once constituencies declare.</p>';
    $('#homeProgress').innerHTML = progressBlock(t);
  };

  main.innerHTML = `
    <section class="hero">
      <div class="hero-text" id="homeHead"></div>
      <div class="hero-stage"><div class="stage" id="homeStage"></div><span class="stage-label" id="homeHeroLabel"></span></div>
    </section>
    <section class="grid-3">
      <article class="panel"><h2 class="ph">Live coverage</h2><ul class="feed" id="homeFeed"></ul></article>
      <article class="panel"><h2 class="ph">Latest declarations</h2><div id="homeDecl" class="decl-list"></div><a class="more" href="#/constituencies">All 650 constituencies</a></article>
      <article class="panel"><h2 class="ph">Results progress</h2><div id="homeProgress"></div><h2 class="ph ph-gap">National vote share</h2><div id="homeShare"></div></article>
    </section>
    <section class="cta-row">
      <a class="cta" href="#/exit-poll"><b>Exit poll</b><span>3D projection reveal</span></a>
      <a class="cta" href="#/map"><b>Constituency map</b><span>All 650 seats in 3D</span></a>
      <a class="cta" href="#/swingometer"><b>Swingometer</b><span>Actual and hypothetical swing</span></a>
      <a class="cta" href="#/results"><b>Results centre</b><span>Gains, losses and the Commons</span></a>
    </section>`;
  let heroKind = null;
  let hero = null;
  const syncHero = () => {
    const t = store.tally();
    const kind = t.declared === 0 && store.election.exitPoll.published ? 'projection' : 'seats';
    if (kind === heroKind) return;
    heroKind = kind;
    hero?.dispose();
    $('#homeStage').innerHTML = '';
    hero = V.mountBars($('#homeStage'), kind);
  };
  draw();
  syncHero();
  pageOff = store.subscribe(() => {
    draw();
    syncHero();
  });
  keep({ dispose: () => hero?.dispose() });
};

function progressBlock(t) {
  const pctD = (t.declared / TOTAL_SEATS) * 100;
  return `<div class="progress"><div class="pg-track"><i style="width:${pctD}%"></i></div>
    <dl class="stats">
      <div><dt>Declared</dt><dd>${t.declared}</dd></div>
      <div><dt>Counting</dt><dd>${t.counting}</dd></div>
      <div><dt>Recounts</dt><dd>${t.recount}</dd></div>
      <div><dt>To declare</dt><dd>${t.toDeclare}</dd></div>
      <div><dt>Turnout</dt><dd>${t.declared ? fmtPct(t.turnout) : '—'}</dd></div>
      <div><dt>National swing</dt><dd>${t.nationalSwing ? `${fmtPct(Math.abs(t.nationalSwing.value))} <small>${esc(P(t.nationalSwing.value >= 0 ? t.nationalSwing.from : t.nationalSwing.to).short)}→${esc(P(t.nationalSwing.value >= 0 ? t.nationalSwing.to : t.nationalSwing.from).short)}</small>` : '—'}</dd></div>
    </dl></div>`;
}

pages.results = () => {
  main.innerHTML = `
    <header class="page-head"><p class="eyebrow">Results centre</p><h1 id="resHead"></h1><p id="resSub" class="lede"></p></header>
    <section class="panel"><div id="resBar"></div><div id="resTable" class="table-wrap"></div></section>
    <section class="grid-2">
      <article class="panel"><h2 class="ph">House of Commons</h2><div class="stage stage-tall" id="chamberStage"></div></article>
      <article class="panel"><h2 class="ph">Progress</h2><div id="resProg"></div><h2 class="ph ph-gap">Vote share and change</h2><div id="resShare"></div></article>
    </section>`;
  const draw = () => {
    const t = store.tally();
    $('#resHead').textContent = t.declared ? outcomeHeadline(t.outcome, (id) => P(id).name) : 'No seats declared yet';
    $('#resSub').textContent = `${t.declared} of ${TOTAL_SEATS} constituencies declared. Only officially declared seats are counted. ${MAJORITY} seats are needed for an overall majority.`;
    $('#resBar').innerHTML = seatBar(t.seats);
    const rows = [...store.parties].sort((a, b) => (t.seats[b.id] || 0) - (t.seats[a.id] || 0));
    $('#resTable').innerHTML = `<table class="tbl">
      <thead><tr><th scope="col">Party</th><th scope="col">Seats</th><th scope="col">Gains</th><th scope="col">Losses</th><th scope="col">Held</th><th scope="col">Net</th><th scope="col">Votes</th><th scope="col">Share</th><th scope="col">Change</th></tr></thead>
      <tbody>${rows
        .map(
          (p) => `<tr><th scope="row"><span class="sw" style="--c:${p.colour}"></span>${esc(p.name)}</th><td class="num big">${t.seats[p.id] || 0}</td><td class="num">${t.gains[p.id] || 0}</td><td class="num">${t.losses[p.id] || 0}</td><td class="num">${t.held[p.id] || 0}</td><td class="num">${signed(t.net[p.id] || 0)}</td><td class="num">${fmt(t.votes[p.id] || 0)}</td><td class="num">${fmtPct(t.share[p.id] || 0)}</td><td class="num">${t.declared ? signed((t.share[p.id] || 0) - (t.prevShare[p.id] || 0), 1) : '—'}</td></tr>`
        )
        .join('')}</tbody>
      <tfoot><tr><th scope="row">Total</th><td class="num big">${t.declared}</td><td colspan="4"></td><td class="num">${fmt(t.totalVotes)}</td><td colspan="2"></td></tr></tfoot></table>`;
    $('#resProg').innerHTML = progressBlock(t);
    $('#resShare').innerHTML = t.declared ? shareBars(t.share, t.prevShare) : '<p class="muted">Awaiting declarations.</p>';
  };
  draw();
  pageOff = store.subscribe(draw);
  keep(V.mountChamber($('#chamberStage')));
};

pages.constituencies = (q) => {
  const regions = [...new Set(store.constituencies.map((c) => c.region))].sort();
  main.innerHTML = `
    <header class="page-head"><p class="eyebrow">Constituencies</p><h1>All ${TOTAL_SEATS} constituencies</h1></header>
    <section class="panel">
      <form class="filters" role="search" onsubmit="return false">
        <label class="grow">Search<input id="fq" type="search" placeholder="Constituency or candidate name" value="${esc(q.get('q') || '')}"></label>
        <label>Region<select id="fr"><option value="">All regions</option>${regions.map((r) => `<option ${q.get('region') === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label>
        <label>Party<select id="fp"><option value="">Any party</option>${store.parties.map((p) => `<option value="${p.id}" ${q.get('party') === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
        <label>Party is<select id="fpm"><option value="winner">Winner</option><option value="previous">Previous winner</option><option value="standing">Standing</option></select></label>
        <label>Status<select id="fs"><option value="">Any status</option>${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
      </form>
      <p class="count" id="fcount" aria-live="polite"></p>
      <div class="table-wrap"><table class="tbl tbl-cons"><thead><tr><th scope="col">Constituency</th><th scope="col">Region</th><th scope="col">Status</th><th scope="col">Result</th><th scope="col">Previous</th><th scope="col" class="num">Majority</th></tr></thead><tbody id="ftable"></tbody></table></div>
    </section>`;
  const draw = () => {
    const term = $('#fq').value.trim().toLowerCase();
    const region = $('#fr').value;
    const party = $('#fp').value;
    const pm = $('#fpm').value;
    const status = $('#fs').value;
    const res = store.election.results;
    const list = store.constituencies.filter((c) => {
      if (region && c.region !== region) return false;
      const r = res[c.id];
      if (status && (r?.status || 'awaiting') !== status) return false;
      if (term && !c.name.toLowerCase().includes(term) && !c.candidates.some((k) => k.name.toLowerCase().includes(term)) && c.id.toLowerCase() !== term) return false;
      if (party) {
        if (pm === 'previous' && c.previous.winner !== party) return false;
        if (pm === 'standing' && !c.candidates.some((k) => k.party === party)) return false;
        if (pm === 'winner') {
          const sr = seatResult(c, r);
          if (!sr.declared || sr.winnerParty !== party) return false;
        }
      }
      return true;
    });
    $('#fcount').textContent = `${list.length} of ${TOTAL_SEATS} constituencies`;
    $('#ftable').innerHTML = list
      .map((c) => {
        const sr = seatResult(c, res[c.id]);
        return `<tr><th scope="row"><a href="#/seat/${c.id}">${esc(c.name)}</a></th><td>${esc(c.region)}</td><td>${statusTag(sr.status)}</td><td>${sr.declared ? `${partyChip(sr.winnerParty)} <small>${sr.outcome}</small>` : '—'}</td><td>${partyChip(c.previous.winner)}</td><td class="num">${sr.declared ? fmt(sr.majority) : '—'}</td></tr>`;
      })
      .join('');
  };
  $$('.filters input, .filters select').forEach((i) => i.addEventListener('input', draw));
  draw();
  pageOff = store.subscribe(draw);
};

pages.seat = (q, id) => {
  const draw = () => {
    const con = store.conById(id);
    if (!con) {
      main.innerHTML = `<section class="panel"><h1>Constituency not found</h1><p><a href="#/constituencies">Back to all constituencies</a></p></section>`;
      return;
    }
    const r = store.election.results[con.id];
    const sr = seatResult(con, r);
    const prev = previousShares(con);
    const now = currentShares(con, r);
    const max = Math.max(1, ...sr.ranked.map((c) => c.share));
    const prevW = P(con.previous.winner);
    const w = sr.winnerParty ? P(sr.winnerParty) : null;
    const parties = [...new Set([...Object.keys(prev), ...Object.keys(now)])];
    main.innerHTML = `
      <header class="page-head seat-head" style="--c:${(sr.declared && w ? w : prevW).colour}">
        <p class="eyebrow"><a href="#/constituencies">Constituencies</a> · ${esc(con.region)} · ${esc(con.id)}</p>
        <h1>${esc(con.name)}</h1>
        <p class="lede">${statusTag(sr.status)} ${sr.declared ? `<b>${esc(w.name)} ${sr.outcome === 'GAIN' ? `gain from ${esc(prevW.name)}` : 'hold'}</b>` : `Previously held by ${esc(prevW.name)}`}${r?.source === 'sim' ? ' <span class="simtag">SIMULATED</span>' : ''}</p>
      </header>
      <section class="grid-2">
        <article class="panel">
          <h2 class="ph">Candidates</h2>
          ${sr.total ? '' : '<p class="muted">No votes have been published for this constituency.</p>'}
          <div class="cands">${sr.ranked
            .map((c, i) => {
              const p = P(c.party);
              return `<div class="cand ${i === 0 && sr.declared ? 'won' : ''}" style="--c:${p.colour}">
                <div class="cand-top"><b>${esc(c.name)}</b><span>${esc(c.party === 'IND' ? c.label || 'Independent' : p.name)}</span>${i === 0 && sr.declared ? '<em>Elected</em>' : ''}</div>
                <div class="cand-bar"><i style="width:${sr.total ? (c.share / max) * 100 : 0}%"></i></div>
                <div class="cand-num"><b>${sr.total ? fmt(c.votes) : '—'}</b><span>${sr.total ? fmtPct(c.share) : ''}</span></div></div>`;
            })
            .join('')}</div>
          ${sr.tie ? '<p class="warn">The top two candidates are tied. A result cannot be declared until the tie is resolved.</p>' : ''}
        </article>
        <article class="panel">
          <h2 class="ph">Result summary</h2>
          <dl class="kv">
            <div><dt>Status</dt><dd>${esc(STATUS_LABEL[sr.status])}</dd></div>
            <div><dt>Winner</dt><dd>${sr.declared ? `${esc(sr.winner.name)} (${esc(w.short)})` : '—'}</dd></div>
            <div><dt>Majority</dt><dd>${sr.declared ? `${fmt(sr.majority)} <small>(${fmtPct((sr.majority / sr.total) * 100)})</small>` : '—'}</dd></div>
            <div><dt>Total votes</dt><dd>${sr.total ? fmt(sr.total) : '—'}</dd></div>
            <div><dt>Electorate</dt><dd>${fmt(con.electorate)}</dd></div>
            <div><dt>Turnout</dt><dd>${sr.total ? fmtPct(sr.turnout) : '—'} <small>(previous ${fmtPct(con.previous.turnout * 100)})</small></dd></div>
            <div><dt>Previous winner</dt><dd>${esc(prevW.name)}</dd></div>
            <div><dt>Swing</dt><dd>${sr.swing ? `${fmtPct(Math.abs(sr.swing.value))} ${esc(P(sr.swing.value >= 0 ? sr.swing.from : sr.swing.to).short)} to ${esc(P(sr.swing.value >= 0 ? sr.swing.to : sr.swing.from).short)}` : '—'}</dd></div>
          </dl>
          <h2 class="ph ph-gap">Share change since ${esc(store.election.previousLabel)}</h2>
          <div class="hbars">${parties
            .map((pid) => {
              const p = P(pid);
              const d = (now[pid] || 0) - (prev[pid] || 0);
              return `<div class="hb" style="--c:${p.colour}"><span class="hb-l">${esc(p.short)}</span><span class="hb-t"><i style="width:${Math.min(100, Math.max(0, sr.total ? now[pid] || 0 : prev[pid] || 0))}%"></i></span><b>${fmtPct(sr.total ? now[pid] || 0 : prev[pid] || 0)}</b><em class="${d >= 0 ? 'up' : 'down'}">${sr.total ? signed(d, 1) : 'prev'}</em></div>`;
            })
            .join('')}</div>
          <p class="links"><a href="#/map?focus=${con.id}">Show on map</a> · <a href="broadcast.html?g=declaration&id=${con.id}" target="_blank" rel="noopener">Open declaration graphic</a></p>
        </article>
      </section>`;
  };
  draw();
  pageOff = store.subscribe(draw);
};

pages.map = async (q) => {
  const regions = [...new Set(store.constituencies.map((c) => c.region))].sort();
  main.innerHTML = `
    <section class="map-page">
      <div class="map-wrap" id="mapWrap">
        <div class="stage stage-fill" id="mapStage"></div>
        <div class="map-tools">
          <button class="btn" id="mapReset">Reset view</button>
          <button class="btn" id="mapFull">Full screen</button>
        </div>
        <p class="map-note" id="mapNote"></p>
      </div>
      <aside class="map-side panel">
        <h1 class="ph">Constituency map</h1>
        <label>Find a constituency<input id="mapQ" type="search" list="mapList" placeholder="Start typing a name"></label>
        <datalist id="mapList">${store.constituencies.map((c) => `<option value="${esc(c.name)}">`).join('')}</datalist>
        <div class="chips" id="mapRegions"><button class="chip on" data-r="">All regions</button>${regions.map((r) => `<button class="chip" data-r="${esc(r)}">${esc(r)}</button>`).join('')}</div>
        <div id="mapInfo" class="map-info"><p class="muted">Hover over or select a constituency.</p></div>
        <div class="legend" id="mapLegend"></div>
        <details class="geo"><summary>Use your own Usher geography</summary>
          <p>Load a GeoJSON file whose features have <code>properties.id</code> matching constituency IDs (USH001–USH650) or <code>properties.name</code> matching names. To publish it for everyone, add it to the repository as <code>map.geojson</code>.</p>
          <input type="file" id="geoFile" accept=".geojson,.json,application/geo+json,application/json">
          <button class="btn btn-ghost" id="geoClear">Remove loaded geography</button>
        </details>
      </aside>
    </section>`;
  const info = $('#mapInfo');
  const tip = $('#tip');
  const showInfo = (con) => {
    const sr = seatResult(con, store.election.results[con.id]);
    info.innerHTML = `<p class="eyebrow">${esc(con.region)}</p><h2>${esc(con.name)}</h2><p>${statusTag(sr.status)}</p>
      ${sr.declared ? `<p><b style="color:${P(sr.winnerParty).colour}">${esc(P(sr.winnerParty).name)}</b> ${sr.outcome === 'GAIN' ? `gain from ${esc(P(sr.prevWinner).short)}` : 'hold'}<br>${esc(sr.winner.name)} · majority ${fmt(sr.majority)}</p>` : `<p>Previously ${esc(P(con.previous.winner).name)}</p>`}
      <a class="btn" href="#/seat/${con.id}">Full result</a>`;
  };
  const legend = () =>
    ($('#mapLegend').innerHTML =
      store.parties.map((p) => `<span><i style="background:${p.colour}"></i>${esc(p.short)}</span>`).join('') +
      '<span><i style="background:#262c37"></i>Awaiting</span><span><i style="background:#5d6a80"></i>Counting</span><span><i style="background:#e3b341"></i>Recount</span>');
  legend();

  let ctl = null;
  const mount = async () => {
    ctl?.dispose();
    $('#mapStage').innerHTML = '';
    ctl = await V.mountMap($('#mapStage'), {
      onHover(con, at) {
        if (!con) return (tip.hidden = true);
        const sr = seatResult(con, store.election.results[con.id]);
        tip.hidden = false;
        tip.innerHTML = `<b>${esc(con.name)}</b><span>${sr.declared ? `${esc(P(sr.winnerParty).short)} ${sr.outcome}` : esc(STATUS_LABEL[sr.status])}</span>`;
        if (at) {
          tip.style.left = `${at.x + 14}px`;
          tip.style.top = `${at.y + 14}px`;
        }
      },
      onClick(con) {
        showInfo(con);
        ctl.focus(con.id);
      },
    });
    $('#mapNote').textContent = ctl.geoLoaded
      ? 'Showing loaded Usher geography.'
      : 'Placeholder hex layout — one hexagon per constituency. These are not official Usher boundaries.';
    const f = q.get('focus');
    if (f && store.conById(f)) {
      showInfo(store.conById(f));
      ctl.focus(f);
    }
  };
  await mount();
  mounted.push({ dispose: () => ctl?.dispose() });

  $('#mapQ').addEventListener('change', (e) => {
    const con = store.constituencies.find((c) => c.name.toLowerCase() === e.target.value.trim().toLowerCase());
    if (con) {
      showInfo(con);
      ctl.focus(con.id);
    }
  });
  $('#mapRegions').addEventListener('click', (e) => {
    const b = e.target.closest('[data-r]');
    if (!b) return;
    $$('#mapRegions .chip').forEach((c) => c.classList.toggle('on', c === b));
    ctl.highlight(b.dataset.r ? store.constituencies.filter((c) => c.region === b.dataset.r).map((c) => c.id) : null);
  });
  $('#mapReset').addEventListener('click', () => ctl.resetView());
  $('#mapFull').addEventListener('click', () => $('#mapWrap').requestFullscreen?.());
  $('#geoFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const gj = JSON.parse(await file.text());
      const persisted = V.setGeoJSON(gj);
      await mount();
      if (!ctl.geoLoaded) alert('No features matched a constituency ID or name, so the placeholder hex layout is still shown.');
      else if (!persisted) alert('Geography loaded for this visit only (the file is too large to keep in browser storage). Add it to the repository as map.geojson to keep it.');
    } catch (err) {
      alert(`Could not read that file: ${err.message}`);
    }
  });
  $('#geoClear').addEventListener('click', async () => {
    V.setGeoJSON(null);
    await mount();
  });
};

pages.swingometer = () => {
  main.innerHTML = `
    <header class="page-head"><p class="eyebrow">Swingometer</p><h1>Which seats fall at each swing?</h1>
    <p class="lede">Each hexagon on the dial is a constituency where the two chosen parties finished first and second last time. As the pointer passes it, the seat changes hands. <b>Actual</b> uses declared results; <b>Hypothetical</b> lets you test a uniform national swing.</p></header>
    <section class="panel panel-flush"><div class="stage stage-swing" id="swingStage"></div></section>`;
  keep(V.mountSwingometer($('#swingStage')));
};

pages['exit-poll'] = (q) => {
  const variant = q.get('v') === 'wall' ? 'wall' : 'stage';
  main.innerHTML = `
    <header class="page-head"><p class="eyebrow">Exit poll</p><h1>The exit poll</h1>
    <p class="lede"><span class="proj-chip">Projection</span> The exit poll is a projection from voters interviewed after voting. It is not a declared result and is kept separate from constituency results.</p></header>
    <section class="panel panel-flush">
      <div class="stage stage-ep" id="epStage"></div>
      <div class="stage-bar">
        <div class="seg"><a class="${variant === 'stage' ? 'on' : ''}" href="#/exit-poll">Honeycomb</a><a class="${variant === 'wall' ? 'on' : ''}" href="#/exit-poll?v=wall">Party wall</a></div>
        <button class="btn" id="epReplay">Replay</button>
        <button class="btn" id="epFull">Full screen</button>
        <a class="btn btn-ghost" href="broadcast.html?g=${variant === 'wall' ? 'exitwall' : 'exitpoll'}" target="_blank" rel="noopener">Broadcast view</a>
      </div>
    </section>
    <section class="panel" id="epTable"></section>`;
  const ctl = keep(V.mountExitPoll($('#epStage'), { variant }));
  $('#epReplay').addEventListener('click', () => ctl.replay());
  $('#epFull').addEventListener('click', () => $('#epStage').requestFullscreen?.());
  const draw = () => {
    const ep = store.election.exitPoll;
    if (!ep.published) return ($('#epTable').innerHTML = '<p class="muted">Not yet published.</p>');
    const entries = V.exitPollEntries(ep.seats).sort((a, b) => b.seats - a.seats);
    const total = entries.reduce((a, e) => a + e.seats, 0);
    $('#epTable').innerHTML = `<h2 class="ph">Projected seats</h2>${seatBar(Object.fromEntries(entries.map((e) => [e.id, e.seats])), { label: 'Projected seats' })}
      <table class="tbl"><thead><tr><th scope="col">Party</th><th scope="col" class="num">Projected seats</th><th scope="col" class="num">Change on ${esc(store.election.previousLabel)}</th></tr></thead><tbody>${entries
        .map((e) => `<tr><th scope="row"><span class="sw" style="--c:${e.colour}"></span>${esc(e.name)}</th><td class="num big">${e.seats}</td><td class="num">${signed(e.seats - (store.tally().prevSeats[e.id] || 0))}</td></tr>`)
        .join('')}</tbody><tfoot><tr><th scope="row">Total</th><td class="num big">${total}</td><td></td></tr></tfoot></table>
      <p class="lede">${esc(outcomeHeadline(parliamentOutcome(Object.fromEntries(entries.map((e) => [e.id, e.seats]))), (id) => P(id).name))}. Published ${ep.publishedAt ? new Date(ep.publishedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}.</p>`;
  };
  draw();
  pageOff = store.subscribe(draw);
};

pages.graphics = () => {
  main.innerHTML = `
    <header class="page-head"><p class="eyebrow">Broadcast graphics</p><h1>Graphics for streaming and recording</h1>
    <p class="lede">Each graphic opens in a clean full-screen window with no site navigation. Add it to OBS as a browser source (1920×1080). Add <code>&follow=1</code> and the window switches automatically when the control room cues a graphic. Press <kbd>F</kbd> for full screen and <kbd>R</kbd> to replay.</p></header>
    <section class="gfx-grid">${Object.entries(V.GRAPHICS)
      .map(([k, g]) => `<a class="gfx" href="broadcast.html?g=${k}" target="_blank" rel="noopener"><b>${esc(g.title)}</b><code>broadcast.html?g=${k}</code></a>`)
      .join('')}
      <a class="gfx gfx-follow" href="broadcast.html?follow=1" target="_blank" rel="noopener"><b>Programme output (follows control room cues)</b><code>broadcast.html?follow=1</code></a>
    </section>`;
};

// ---------------------------------------------------------------- router
function route() {
  cleanup();
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  const q = new URLSearchParams(query || '');
  const [name, arg] = (path || 'home').split('/');
  const fn = pages[name] || pages.home;
  $$('.nav a').forEach((a) => a.toggleAttribute('aria-current', a.getAttribute('href') === `#/${name === 'home' ? '' : name}` || (name === 'seat' && a.getAttribute('href') === '#/constituencies')));
  $('.nav').classList.remove('open');
  $('.nav-toggle').setAttribute('aria-expanded', 'false');
  fn(q, arg && decodeURIComponent(arg));
  window.scrollTo(0, 0);
  main.focus({ preventScroll: true });
}

async function boot() {
  main.innerHTML = '<p class="loading">Loading election data…</p>';
  try {
    await store.init();
  } catch (err) {
    main.innerHTML = `<section class="panel"><h1>Could not load election data</h1><p>${esc(err.message)}</p><p>If you opened <code>index.html</code> directly from your computer, run a local web server instead (see README) — browsers block data files on <code>file://</code> pages.</p></section>`;
    return;
  }
  renderChrome();
  store.subscribe(renderChrome);
  V.mountTicker($('#ticker'));
  $('.nav-toggle').addEventListener('click', (e) => {
    const open = $('.nav').classList.toggle('open');
    e.currentTarget.setAttribute('aria-expanded', open);
  });
  window.addEventListener('hashchange', route);
  route();
  setInterval(() => store.subscribe && renderChrome(), 30000);
}
boot();
