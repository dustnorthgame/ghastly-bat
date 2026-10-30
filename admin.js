// admin.js — election night control room.
import { store, remoteConfigured, newElection } from './store.js';
import { seatResult, validateExitPoll, outcomeHeadline, parliamentOutcome, TOTAL_SEATS, MAJORITY, STATUS_LABEL, fmt, fmtPct, signed } from './calc.js';
import { generateVotes, mulberry32 } from './sim.js';
import { GRAPHICS, esc, mountExitPoll, setGeoJSON } from './views.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const main = $('#crMain');
const P = (id) => store.partyById(id);
let tab = 'overview';
let tabOff = null;
let disposers = [];

function toast(msg, kind = 'ok') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast show ${kind}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.className = 'toast'), 2600);
}
const confirmIt = (msg) => window.confirm(msg);
function download(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------- tabs
const tabs = {};

tabs.overview = () => {
  main.innerHTML = `
    <header class="cr-head"><h1>Overview</h1><p id="ovHead"></p></header>
    <div class="cr-tiles" id="ovTiles"></div>
    <div class="cr-cols">
      <section class="cr-card"><h2>Standings (declared only)</h2><div id="ovTable"></div></section>
      <section class="cr-card"><h2>Recent changes</h2><ol class="cr-log" id="ovLog"></ol></section>
    </div>
    <section class="cr-card"><h2>Seats in play</h2><div id="ovPlay" class="cr-chips"></div></section>`;
  const draw = () => {
    const t = store.tally();
    const e = store.election;
    $('#ovHead').textContent = `${e.name} · ${t.declared ? outcomeHeadline(t.outcome, (id) => P(id).name) : 'No declarations yet'}`;
    $('#ovTiles').innerHTML = [
      ['Declared', t.declared],
      ['Counting', t.counting],
      ['Recounts', t.recount],
      ['To declare', t.toDeclare],
      ['Turnout', t.declared ? fmtPct(t.turnout) : '—'],
      ['Exit poll', e.exitPoll.published ? 'Published' : 'Not published'],
    ]
      .map(([k, v]) => `<div class="tile"><span>${k}</span><b>${v}</b></div>`)
      .join('');
    $('#ovTable').innerHTML = `<table class="tbl tbl-compact"><thead><tr><th>Party</th><th class="num">Seats</th><th class="num">Gain</th><th class="num">Loss</th><th class="num">Share</th></tr></thead><tbody>${store.parties
      .map((p) => `<tr><th><span class="sw" style="--c:${p.colour}"></span>${esc(p.short)}</th><td class="num big">${t.seats[p.id] || 0}</td><td class="num">${t.gains[p.id] || 0}</td><td class="num">${t.losses[p.id] || 0}</td><td class="num">${fmtPct(t.share[p.id] || 0)}</td></tr>`)
      .join('')}</tbody></table>`;
    $('#ovLog').innerHTML = e.log.slice(0, 40).map((l) => `<li><time>${new Date(l.time).toLocaleTimeString('en-GB')}</time>${esc(l.text)}</li>`).join('') || '<li class="muted">No changes yet.</li>';
    const live = store.constituencies.filter((c) => ['counting', 'recount'].includes(e.results[c.id]?.status));
    $('#ovPlay').innerHTML = live.length ? live.map((c) => `<button class="chip" data-open="${c.id}">${esc(c.name)} <small>${esc(STATUS_LABEL[e.results[c.id].status])}</small></button>`).join('') : '<p class="muted">No counts in progress.</p>';
  };
  draw();
  tabOff = store.subscribe(draw);
  main.addEventListener('click', openSeatFromChip);
  disposers.push(() => main.removeEventListener('click', openSeatFromChip));
};
function openSeatFromChip(e) {
  const b = e.target.closest('[data-open]');
  if (!b) return;
  selectedSeat = b.dataset.open;
  switchTab('seats');
}

// ---------------------------------------------------------------- constituencies
let selectedSeat = null;
tabs.seats = () => {
  const regions = [...new Set(store.constituencies.map((c) => c.region))].sort();
  main.innerHTML = `
    <header class="cr-head"><h1>Constituencies</h1><p>Enter votes, change status, declare and correct results. A seat counts nationally only once declared.</p></header>
    <div class="cr-split">
      <section class="cr-card cr-list">
        <div class="cr-filter"><input id="sq" type="search" placeholder="Search ${TOTAL_SEATS} constituencies" aria-label="Search constituencies">
        <select id="sr" aria-label="Region"><option value="">All regions</option>${regions.map((r) => `<option>${esc(r)}</option>`).join('')}</select>
        <select id="ss" aria-label="Status"><option value="">Any status</option>${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <p class="count" id="scount"></p>
        <ul id="slist" class="cr-seatlist"></ul>
      </section>
      <section class="cr-card" id="seatEditor"><p class="muted">Choose a constituency.</p></section>
    </div>`;
  const drawList = () => {
    const term = $('#sq').value.trim().toLowerCase();
    const r = $('#sr').value;
    const s = $('#ss').value;
    const res = store.election.results;
    const list = store.constituencies.filter(
      (c) => (!r || c.region === r) && (!s || (res[c.id]?.status || 'awaiting') === s) && (!term || c.name.toLowerCase().includes(term) || c.id.toLowerCase().includes(term))
    );
    $('#scount').textContent = `${list.length} shown`;
    $('#slist').innerHTML = list
      .map((c) => {
        const sr = seatResult(c, res[c.id]);
        const colour = sr.declared ? P(sr.winnerParty).colour : 'transparent';
        return `<li><button data-id="${c.id}" class="${c.id === selectedSeat ? 'on' : ''}" style="--c:${colour}"><span>${esc(c.name)}</span><small class="stag stag-${sr.status}">${esc(STATUS_LABEL[sr.status])}</small></button></li>`;
      })
      .join('');
  };
  $$('#sq, #sr, #ss').forEach((i) => i.addEventListener('input', drawList));
  $('#slist').addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    selectedSeat = b.dataset.id;
    drawList();
    drawEditor();
  });
  drawList();
  if (selectedSeat) drawEditor();
  tabOff = store.subscribe(drawList);
};

function drawEditor() {
  const con = store.conById(selectedSeat);
  const ed = $('#seatEditor');
  if (!con) return (ed.innerHTML = '<p class="muted">Choose a constituency.</p>');
  const r = store.election.results[con.id] || { status: 'awaiting', votes: {} };
  const sr = seatResult(con, r);
  const partyOpts = (sel) => store.parties.map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.short)} — ${esc(p.name)}</option>`).join('');
  ed.innerHTML = `
    <div class="ed-head">
      <div><p class="eyebrow">${esc(con.id)} · ${esc(con.region)}</p><h2>${esc(con.name)}</h2>
      <p>${`<span class="stag stag-${sr.status}">${esc(STATUS_LABEL[sr.status])}</span>`} ${r.source === 'sim' ? '<span class="simtag">SIMULATED</span>' : ''} ${sr.declared ? `${esc(P(sr.winnerParty).short)} ${sr.outcome} · majority ${fmt(sr.majority)}` : ''}</p></div>
      <a class="btn btn-ghost" href="index.html#/seat/${con.id}" target="_blank" rel="noopener">Public page</a>
    </div>
    <details class="ed-details"><summary>Constituency details</summary>
      <div class="form-grid">
        <label>Name<input id="eName" value="${esc(con.name)}"></label>
        <label>Region<input id="eRegion" value="${esc(con.region)}"></label>
        <label>Electorate<input id="eElect" type="number" min="1" value="${con.electorate}"></label>
        <label>Previous winner<select id="ePrev">${partyOpts(con.previous.winner)}</select></label>
      </div>
      <p class="hint">Previous election votes by party (used for gains, losses and swing):</p>
      <div class="form-grid">${store.parties.map((p) => `<label>${esc(p.short)}<input type="number" min="0" data-prev="${p.id}" value="${con.previous.votes[p.id] || 0}"></label>`).join('')}</div>
      <button class="btn" id="eSaveDetails">Save details</button>
    </details>
    <h3>Candidates and votes</h3>
    <table class="tbl tbl-edit"><thead><tr><th>Candidate</th><th>Party</th><th>Label</th><th class="num">Votes</th><th></th></tr></thead>
    <tbody>${con.candidates
      .map(
        (c) => `<tr data-cid="${c.id}"><td><input data-f="name" value="${esc(c.name)}" aria-label="Candidate name"></td><td><select data-f="party" aria-label="Party">${partyOpts(c.party)}</select></td><td><input data-f="label" value="${esc(c.label || '')}" placeholder="${c.party === 'IND' ? 'Independent' : ''}" aria-label="Ballot label"></td><td><input data-f="votes" type="number" min="0" value="${r.votes?.[c.id] ?? ''}" aria-label="Votes"></td><td><button class="btn btn-icon" data-remove title="Remove candidate" aria-label="Remove candidate">×</button></td></tr>`
      )
      .join('')}</tbody></table>
    <div class="ed-row"><button class="btn btn-ghost" id="eAdd">Add candidate</button><button class="btn btn-ghost" id="eAddInd">Add independent</button><span class="ed-total" id="eTotal"></span></div>
    <div class="ed-actions">
      <button class="btn" data-status="awaiting">Awaiting</button>
      <button class="btn" data-status="counting">Counting</button>
      <button class="btn btn-warn" data-status="recount">Recount</button>
      <button class="btn" id="eSaveVotes">Save votes</button>
      <button class="btn btn-go" id="eDeclare">${sr.declared ? 'Save correction' : 'Declare result'}</button>
      <button class="btn btn-danger" id="eClear">Clear result</button>
      <button class="btn btn-ghost" id="eCue" ${sr.declared ? '' : 'disabled'}>Cue declaration graphic</button>
    </div>
    <p class="hint" id="eMsg"></p>`;

  const readCands = () =>
    $$('tbody tr[data-cid]', ed).map((tr) => ({
      id: tr.dataset.cid,
      name: $('[data-f=name]', tr).value.trim() || 'Unnamed candidate',
      party: $('[data-f=party]', tr).value,
      label: $('[data-f=label]', tr).value.trim() || undefined,
      votes: $('[data-f=votes]', tr).value === '' ? null : Math.max(0, Math.round(Number($('[data-f=votes]', tr).value))),
    }));
  const totals = () => {
    const cs = readCands();
    const total = cs.reduce((a, c) => a + (c.votes || 0), 0);
    const sorted = [...cs].sort((a, b) => (b.votes || 0) - (a.votes || 0));
    const tie = sorted[1] && sorted[0].votes && sorted[0].votes === sorted[1].votes;
    $('#eTotal').innerHTML = `Total ${fmt(total)} · turnout ${fmtPct((total / con.electorate) * 100)}${total > con.electorate ? ' <b class="bad">exceeds electorate</b>' : ''}${tie ? ' <b class="bad">tie for first</b>' : ''}`;
    return { cs, total, tie };
  };
  ed.addEventListener('input', totals);
  totals();

  const saveCands = (status, verb) => {
    const { cs, total, tie } = totals();
    if (status === 'declared') {
      if (!total) return toast('Enter votes before declaring.', 'bad');
      if (tie) return toast('Tied result: resolve the tie (e.g. drawing of lots) before declaring.', 'bad');
      if (total > con.electorate && !confirmIt('Total votes exceed the electorate. Declare anyway?')) return;
      if (cs.some((c) => c.votes === null)) return toast('Every candidate needs a vote total before declaring.', 'bad');
    }
    const wasDeclared = sr.declared;
    if (wasDeclared && status === 'declared' && !confirmIt(`Correct the declared result in ${con.name}?`)) return;
    if (r.source === 'sim' && !confirmIt('This seat holds a simulated result. Replace it with a manual result?')) return;
    store.update((s, e) => {
      const c = s.constituencies.find((x) => x.id === con.id);
      c.candidates = cs.map(({ votes, ...k }) => (k.label ? k : (delete k.label, k)));
      const prevR = e.results[con.id] || {};
      e.results[con.id] = {
        ...prevR,
        status,
        votes: Object.fromEntries(cs.filter((k) => k.votes !== null).map((k) => [k.id, k.votes])),
        source: 'manual',
        updatedAt: Date.now(),
        declaredAt: status === 'declared' ? (wasDeclared ? prevR.declaredAt || Date.now() : Date.now()) : null,
        recounts: (prevR.recounts || 0) + (status === 'recount' && prevR.status !== 'recount' ? 1 : 0),
        corrected: wasDeclared && status === 'declared' ? (prevR.corrected || 0) + 1 : prevR.corrected,
      };
    }, `${con.name}: ${verb}`);
    toast(`${con.name}: ${verb}`);
    drawEditor();
  };

  $('#eSaveVotes').addEventListener('click', () => saveCands(r.status === 'declared' ? 'counting' : r.status === 'awaiting' ? 'counting' : r.status, 'votes saved'));
  $('#eDeclare').addEventListener('click', () => {
    const { cs } = totals();
    const w = [...cs].sort((a, b) => (b.votes || 0) - (a.votes || 0))[0];
    saveCands('declared', sr.declared ? 'result corrected' : `declared — ${w ? `${w.name} (${P(w.party).short})` : ''}`);
  });
  $$('[data-status]', ed).forEach((b) => b.addEventListener('click', () => {
    if (sr.declared && !confirmIt(`${con.name} is declared. Change its status to ${STATUS_LABEL[b.dataset.status]}? It will stop counting nationally.`)) return;
    saveCands(b.dataset.status, `status set to ${STATUS_LABEL[b.dataset.status]}`);
  }));
  $('#eClear').addEventListener('click', () => {
    if (!confirmIt(`Clear all votes and status for ${con.name}?`)) return;
    store.update((s, e) => delete e.results[con.id], `${con.name}: result cleared`);
    drawEditor();
  });
  $('#eCue').addEventListener('click', () => {
    store.cue('declaration', { id: con.id });
    toast('Declaration graphic cued to programme output');
  });
  ed.querySelector('tbody').addEventListener('click', (e) => {
    if (!e.target.closest('[data-remove]')) return;
    const tr = e.target.closest('tr');
    if (!confirmIt(`Remove ${$('[data-f=name]', tr).value} from the ballot?`)) return;
    tr.remove();
    totals();
  });
  const addRow = (party, label) => {
    const id = `${con.id.toLowerCase()}-${store.uid()}`;
    const tr = document.createElement('tr');
    tr.dataset.cid = id;
    tr.innerHTML = `<td><input data-f="name" placeholder="Candidate name" aria-label="Candidate name"></td><td><select data-f="party" aria-label="Party">${partyOpts(party)}</select></td><td><input data-f="label" value="${esc(label || '')}" aria-label="Ballot label"></td><td><input data-f="votes" type="number" min="0" aria-label="Votes"></td><td><button class="btn btn-icon" data-remove aria-label="Remove candidate">×</button></td>`;
    ed.querySelector('tbody').appendChild(tr);
    $('input', tr).focus();
  };
  $('#eAdd').addEventListener('click', () => addRow(store.parties[0].id));
  $('#eAddInd').addEventListener('click', () => addRow('IND', 'Independent'));
  $('#eSaveDetails').addEventListener('click', () => {
    const name = $('#eName').value.trim();
    if (!name) return toast('Name is required.', 'bad');
    if (store.constituencies.some((c) => c.id !== con.id && c.name.toLowerCase() === name.toLowerCase())) return toast('Another constituency already has that name.', 'bad');
    store.update((s) => {
      const c = s.constituencies.find((x) => x.id === con.id);
      c.name = name;
      c.region = $('#eRegion').value.trim() || c.region;
      c.electorate = Math.max(1, Math.round(Number($('#eElect').value)) || c.electorate);
      c.previous.winner = $('#ePrev').value;
      $$('[data-prev]', ed).forEach((i) => (c.previous.votes[i.dataset.prev] = Math.max(0, Math.round(Number(i.value) || 0))));
    }, `${name}: details updated`);
    toast('Details saved');
    drawEditor();
  });
}

// ---------------------------------------------------------------- parties
tabs.parties = () => {
  const draw = () => {
    main.innerHTML = `
      <header class="cr-head"><h1>Parties</h1><p>Edit names, abbreviations and colours. Independent candidates are entered per constituency with party “${esc(P('IND').short)}” and their own ballot label; they are grouped as Others only in national totals.</p></header>
      <section class="cr-card"><table class="tbl tbl-edit"><thead><tr><th>ID</th><th>Name</th><th>Short</th><th>Colour</th><th>Leader image URL (optional)</th><th>Candidates</th><th></th></tr></thead><tbody>${store.parties
        .map((p) => {
          const n = store.constituencies.reduce((a, c) => a + c.candidates.filter((k) => k.party === p.id).length, 0);
          return `<tr data-pid="${p.id}"><td><code>${esc(p.id)}</code></td><td><input data-f="name" value="${esc(p.name)}"></td><td><input data-f="short" value="${esc(p.short)}" maxlength="10"></td><td><input data-f="colour" type="color" value="${p.colour}"></td><td><input data-f="image" value="${esc(p.image || '')}" placeholder="https://… (own artwork)"></td><td class="num">${n}</td><td>${p.id === 'IND' ? '' : `<button class="btn btn-danger" data-del>Delete</button>`}</td></tr>`;
        })
        .join('')}</tbody></table>
      <div class="ed-row"><button class="btn" id="pSave">Save parties</button></div></section>
      <section class="cr-card"><h2>Add a party</h2><div class="form-grid">
        <label>ID (2–6 letters)<input id="nId" maxlength="6" placeholder="GRN"></label><label>Name<input id="nName" placeholder="Green Party"></label>
        <label>Short<input id="nShort" maxlength="10" placeholder="Green"></label><label>Colour<input id="nColour" type="color" value="#1f9d55"></label>
        <label class="check"><input type="checkbox" id="nAll"> Add a candidate in every constituency</label></div>
        <button class="btn" id="pAdd">Add party</button></section>`;
    $('#pSave').addEventListener('click', () => {
      store.update((s) => {
        $$('tr[data-pid]').forEach((tr) => {
          const p = s.parties.find((x) => x.id === tr.dataset.pid);
          p.name = $('[data-f=name]', tr).value.trim() || p.name;
          p.short = $('[data-f=short]', tr).value.trim() || p.short;
          p.colour = $('[data-f=colour]', tr).value;
          p.image = $('[data-f=image]', tr).value.trim();
        });
      }, 'Party details updated');
      toast('Parties saved');
    });
    main.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.closest('tr').dataset.pid;
        const used = store.constituencies.some((c) => c.candidates.some((k) => k.party === id) || c.previous.winner === id);
        if (used) return toast('Reassign or remove this party’s candidates and previous wins first.', 'bad');
        if (!confirmIt(`Delete ${P(id).name}?`)) return;
        store.update((s, e) => {
          s.parties = s.parties.filter((p) => p.id !== id);
          delete e.exitPoll.seats[id];
        }, `Party ${id} deleted`);
        draw();
      })
    );
    $('#pAdd').addEventListener('click', () => {
      const id = $('#nId').value.trim().toUpperCase();
      if (!/^[A-Z]{2,6}$/.test(id)) return toast('ID must be 2–6 letters.', 'bad');
      if (store.parties.some((p) => p.id === id)) return toast('That ID is already used.', 'bad');
      const name = $('#nName').value.trim();
      if (!name) return toast('Name is required.', 'bad');
      const all = $('#nAll').checked;
      store.update((s) => {
        const others = s.parties.findIndex((p) => p.isOthers);
        const party = { id, name, short: $('#nShort').value.trim() || id, colour: $('#nColour').value, text: '#FFFFFF' };
        s.parties.splice(others < 0 ? s.parties.length : others, 0, party);
        if (all) s.constituencies.forEach((c) => c.candidates.push({ id: `${c.id.toLowerCase()}-${id.toLowerCase()}`, name: `${name} candidate`, party: id }));
      }, `Party ${name} added${all ? ' with candidates in every seat' : ''}`);
      draw();
    });
  };
  draw();
};

// ---------------------------------------------------------------- exit poll
tabs.exitpoll = () => {
  const ep = store.election.exitPoll;
  main.innerHTML = `
    <header class="cr-head"><h1>Exit poll</h1><p>Enter projected seats for each party. Projections are stored separately from constituency results and never count as declared seats.</p></header>
    <div class="cr-cols">
      <section class="cr-card"><div class="form-grid" id="epForm">${store.parties
        .map((p) => `<label><span class="sw" style="--c:${p.colour}"></span>${esc(p.name)}<input type="number" min="0" max="${TOTAL_SEATS}" step="1" data-p="${p.id}" value="${ep.seats[p.id] ?? ''}"></label>`)
        .join('')}</div>
        <p class="ep-total" id="epTotal"></p>
        <div class="ed-actions"><button class="btn" id="epSave">Save draft</button><button class="btn btn-go" id="epPub">${ep.published ? 'Update published poll' : 'Publish exit poll'}</button>${ep.published ? '<button class="btn btn-danger" id="epUnpub">Withdraw</button>' : ''}<button class="btn btn-ghost" id="epCue">Cue reveal on air</button><button class="btn btn-ghost" id="epCueWall">Cue party wall</button></div>
        <p class="hint">Publishing makes the exit poll visible on the public site. Cueing plays the animated reveal in every broadcast window opened with <code>?follow=1</code>.</p>
      </section>
      <section class="cr-card"><h2>Preview</h2><div class="stage stage-preview" id="epPrev"></div><button class="btn btn-ghost" id="epReplay">Replay preview</button></section>
    </div>`;
  const read = () => Object.fromEntries($$('#epForm input').map((i) => [i.dataset.p, i.value === '' ? 0 : Number(i.value)]));
  const check = () => {
    const v = validateExitPoll(read());
    $('#epTotal').innerHTML = `Total <b>${v.total}</b> / ${TOTAL_SEATS} — ${v.ok ? `<span class="good">${esc(outcomeHeadline(parliamentOutcome(read()), (id) => P(id).short))}</span>` : `<span class="bad">${esc(v.errors.join(' '))}</span>`}`;
    return v;
  };
  $('#epForm').addEventListener('input', check);
  check();
  const save = (publish) => {
    const v = check();
    if (publish && !v.ok) return toast('Projections must total exactly 650 before publishing.', 'bad');
    store.update((s, e) => {
      e.exitPoll.seats = read();
      if (publish) {
        e.exitPoll.published = true;
        e.exitPoll.publishedAt = Date.now();
      }
    }, publish ? 'Exit poll published' : 'Exit poll draft saved');
    toast(publish ? 'Exit poll published' : 'Draft saved');
    if (publish) switchTab('exitpoll');
  };
  $('#epSave').addEventListener('click', () => save(false));
  $('#epPub').addEventListener('click', () => {
    if (!check().ok) return toast('Projections must total exactly 650.', 'bad');
    if (confirmIt('Publish the exit poll to the public site?')) save(true);
  });
  $('#epUnpub')?.addEventListener('click', () => {
    if (!confirmIt('Withdraw the published exit poll?')) return;
    store.update((s, e) => (e.exitPoll.published = false), 'Exit poll withdrawn');
    switchTab('exitpoll');
  });
  $('#epCue').addEventListener('click', () => (store.cue('exitpoll'), toast('Exit poll reveal cued')));
  $('#epCueWall').addEventListener('click', () => (store.cue('exitwall'), toast('Party wall cued')));
  const prev = mountExitPoll($('#epPrev'), { preview: true });
  disposers.push(() => prev.dispose());
  $('#epReplay').addEventListener('click', () => prev.replay());
};

// ---------------------------------------------------------------- newsroom
tabs.news = () => {
  const e = store.election;
  main.innerHTML = `
    <header class="cr-head"><h1>Newsroom</h1><p>Announcements, banner and ticker appear on the public site and in broadcast graphics.</p></header>
    <div class="cr-cols">
      <section class="cr-card"><h2>Election status</h2>
        <select id="nStatus">${['upcoming', 'polls-open', 'polls-closed', 'counting', 'complete'].map((s) => `<option value="${s}" ${e.status === s ? 'selected' : ''}>${s.replace('-', ' ')}</option>`).join('')}</select>
        <h2>Banner</h2>
        <div class="form-grid"><label class="grow">Text<input id="bText" value="${esc(e.banner.text)}"></label>
        <label>Style<select id="bStyle">${['breaking', 'flash', 'result', 'projection'].map((s) => `<option ${e.banner.style === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label></div>
        <div class="ed-actions"><button class="btn btn-go" id="bShow">Show banner</button><button class="btn" id="bHide">Hide banner</button><button class="btn btn-ghost" id="bCue">Cue breaking lower third</button></div>
        <h2>Ticker</h2><p class="hint">One item per line. Latest declarations and seat totals are added automatically.</p>
        <textarea id="tLines" rows="6">${esc(e.ticker.join('\n'))}</textarea><button class="btn" id="tSave">Update ticker</button>
      </section>
      <section class="cr-card"><h2>Announcements</h2>
        <textarea id="aText" rows="3" placeholder="Write an announcement for the live coverage feed"></textarea>
        <div class="ed-actions"><label class="check"><input type="checkbox" id="aKey"> Key moment</label><button class="btn btn-go" id="aPost">Publish announcement</button></div>
        <ul class="cr-ann" id="aList"></ul>
      </section>
    </div>`;
  const drawAnn = () =>
    ($('#aList').innerHTML = store.election.announcements
      .map((a) => `<li class="${a.priority}"><time>${new Date(a.time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</time><p>${esc(a.text)}</p><button class="btn btn-icon" data-del="${a.id}" aria-label="Delete announcement">×</button></li>`)
      .join(''));
  drawAnn();
  tabOff = store.subscribe(drawAnn);
  $('#nStatus').addEventListener('change', (ev) => store.update((s, el) => (el.status = ev.target.value), `Election status: ${ev.target.value}`));
  const setBanner = (visible) => store.update((s, el) => (el.banner = { text: $('#bText').value.trim(), style: $('#bStyle').value, visible: visible && !!$('#bText').value.trim() }), visible ? 'Banner shown' : 'Banner hidden');
  $('#bShow').addEventListener('click', () => (setBanner(true), toast('Banner live')));
  $('#bHide').addEventListener('click', () => (setBanner(false), toast('Banner hidden')));
  $('#bCue').addEventListener('click', () => (setBanner(true), store.cue('breaking'), toast('Breaking lower third cued')));
  $('#tSave').addEventListener('click', () => {
    store.update((s, el) => (el.ticker = $('#tLines').value.split('\n').map((l) => l.trim()).filter(Boolean)), 'Ticker updated');
    toast('Ticker updated');
  });
  $('#aPost').addEventListener('click', () => {
    const text = $('#aText').value.trim();
    if (!text) return;
    store.update((s, el) => el.announcements.unshift({ id: store.uid(), time: Date.now(), text, priority: $('#aKey').checked ? 'key' : 'normal' }), 'Announcement published');
    $('#aText').value = '';
    toast('Announcement published');
  });
  $('#aList').addEventListener('click', (ev) => {
    const id = ev.target.closest('[data-del]')?.dataset.del;
    if (id && confirmIt('Delete this announcement?')) store.update((s, el) => (el.announcements = el.announcements.filter((a) => a.id !== id)), 'Announcement deleted');
  });
};

// ---------------------------------------------------------------- broadcast
tabs.broadcast = () => {
  main.innerHTML = `
    <header class="cr-head"><h1>Broadcast</h1><p>Cue a graphic to every programme window (<code>broadcast.html?follow=1</code>). Open individual graphics for separate OBS sources.</p></header>
    <div class="cr-cols">
      <section class="cr-card"><h2>Cue to programme</h2><div class="cue-grid">${Object.entries(GRAPHICS)
        .map(([k, g]) => `<button class="cue" data-cue="${k}"><b>${esc(g.title)}</b><small>${k}</small></button>`)
        .join('')}<button class="cue" data-cue="_slate"><b>Standby slate</b><small>slate</small></button></div>
        <div class="ed-actions"><button class="btn" id="cReplay">Replay current graphic</button>
        <label>Declaration for<select id="cDecl"><option value="">Latest declared</option>${store.constituencies.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label></div>
        <p class="hint" id="cLast"></p>
      </section>
      <section class="cr-card"><h2>Programme monitor</h2><div class="monitor"><iframe src="broadcast.html?follow=1" title="Programme output" loading="lazy"></iframe></div>
        <p><a class="btn btn-ghost" href="broadcast.html?follow=1" target="_blank" rel="noopener">Open programme output</a></p></section>
    </div>`;
  const showLast = () => {
    const c = store.lastCue();
    $('#cLast').textContent = c ? `On air: ${GRAPHICS[c.graphic]?.title || c.graphic} (cued ${new Date(c.at).toLocaleTimeString('en-GB')})` : 'Nothing cued yet.';
  };
  showLast();
  $$('[data-cue]').forEach((b) =>
    b.addEventListener('click', () => {
      const k = b.dataset.cue;
      store.cue(k, k === 'declaration' && $('#cDecl').value ? { id: $('#cDecl').value } : {});
      showLast();
      toast(`Cued: ${GRAPHICS[k]?.title || 'Standby slate'}`);
    })
  );
  $('#cReplay').addEventListener('click', () => store.cue('_replay'));
};

// ---------------------------------------------------------------- simulation
const sim = { timer: null, queue: [], pending: new Map(), running: false, rng: null, shift: {}, overwrite: false };
tabs.sim = () => {
  const ps = store.parties;
  main.innerHTML = `
    <header class="cr-head"><h1>Simulation</h1><p>Generate sample results for rehearsals. Simulated results are tagged <span class="simtag">SIM</span> everywhere and never replace manual results unless you allow it.</p></header>
    <div class="cr-cols">
      <section class="cr-card"><h2>National movement since ${esc(store.election.previousLabel)}</h2>
        <div class="form-grid">${ps.map((p) => `<label><span class="sw" style="--c:${p.colour}"></span>${esc(p.short)} share change (pts)<input type="number" step="0.5" data-shift="${p.id}" value="${sim.shift[p.id] ?? { UIP: 8, BWP: 2, CON: -9, IND: -1 }[p.id] ?? 0}"></label>`).join('')}</div>
        <div class="form-grid"><label>Random seed<input id="simSeed" type="number" value="2026"></label><label>Declarations per minute<input id="simRate" type="range" min="6" max="600" value="60"><output id="simRateOut">60</output></label></div>
        <label class="check"><input type="checkbox" id="simOver"> Allow simulation to overwrite manually entered results</label>
        <div class="ed-actions">
          <button class="btn btn-go" id="simStart">Start election night</button>
          <button class="btn" id="simPause">Pause</button>
          <button class="btn" id="simAll">Declare all instantly</button>
          <button class="btn btn-danger" id="simClear">Clear simulated results</button>
        </div>
        <p class="hint" id="simState"></p>
      </section>
      <section class="cr-card"><h2>Night so far</h2><div id="simBoard"></div></section>
    </div>`;
  const rate = $('#simRate');
  rate.addEventListener('input', () => ($('#simRateOut').textContent = rate.value));
  const readShift = () => Object.fromEntries($$('[data-shift]').map((i) => [i.dataset.shift, Number(i.value) || 0]));
  const board = () => {
    const t = store.tally();
    const simN = Object.values(store.election.results).filter((r) => r.source === 'sim').length;
    $('#simBoard').innerHTML = `<p><b>${t.declared}</b> declared · ${simN} simulated · ${t.counting} counting · ${t.recount} recounts</p>
      <table class="tbl tbl-compact"><tbody>${store.parties.map((p) => `<tr><th><span class="sw" style="--c:${p.colour}"></span>${esc(p.short)}</th><td class="num big">${t.seats[p.id] || 0}</td><td class="num">${signed(t.net[p.id] || 0)}</td></tr>`).join('')}</tbody></table>
      <p>${esc(t.declared ? outcomeHeadline(t.outcome, (id) => P(id).short) : '')}</p>`;
    $('#simState').textContent = sim.running ? `Running — ${sim.queue.length} constituencies still to report.` : sim.queue.length ? `Paused — ${sim.queue.length} still to report.` : 'Idle.';
    $('#simPause').textContent = sim.running ? 'Pause' : 'Resume';
  };
  board();
  tabOff = store.subscribe(board);

  const eligible = (overwrite) => {
    const res = store.election.results;
    return store.constituencies.filter((c) => {
      const r = res[c.id];
      if (!r || r.source === 'sim') return true;
      return overwrite;
    });
  };
  const confirmOverwrite = () => {
    sim.overwrite = $('#simOver').checked;
    if (sim.overwrite) {
      const manual = Object.values(store.election.results).filter((r) => r.source !== 'sim').length;
      if (manual && !confirmIt(`This will overwrite ${manual} manually entered result(s) with simulated data. Continue?`)) return false;
    }
    return true;
  };

  $('#simAll').addEventListener('click', () => {
    if (!confirmOverwrite()) return;
    stopSim();
    const rng = mulberry32(Number($('#simSeed').value) || 1);
    const shift = readShift();
    const list = eligible(sim.overwrite);
    const now = Date.now();
    store.update((s, e) => {
      list.forEach((c, i) => (e.results[c.id] = { status: 'declared', votes: generateVotes(c, shift, rng), source: 'sim', updatedAt: now + i, declaredAt: now + i }));
    }, `Simulation: ${list.length} results declared instantly`);
    toast(`${list.length} simulated results declared`);
  });

  $('#simStart').addEventListener('click', () => {
    if (!confirmOverwrite()) return;
    stopSim();
    sim.rng = mulberry32(Number($('#simSeed').value) || 1);
    sim.shift = readShift();
    const list = eligible(sim.overwrite).filter((c) => store.election.results[c.id]?.status !== 'declared' || store.election.results[c.id]?.source === 'sim' || sim.overwrite);
    // shuffle; small urban seats tend to declare first
    sim.queue = list.map((c) => ({ c, k: sim.rng() + c.electorate / 400000 })).sort((a, b) => a.k - b.k).map((x) => x.c);
    store.update((s, e) => {
      e.status = 'counting';
      sim.queue.forEach((c) => {
        if (e.results[c.id]?.source === 'sim' || !e.results[c.id]) delete e.results[c.id];
      });
    }, `Simulation started: ${sim.queue.length} constituencies`);
    sim.running = true;
    tickLoop();
    board();
  });
  $('#simPause').addEventListener('click', () => {
    if (sim.running) {
      sim.running = false;
      clearTimeout(sim.timer);
    } else if (sim.queue.length || sim.pending.size) {
      sim.running = true;
      tickLoop();
    }
    board();
  });
  $('#simClear').addEventListener('click', () => {
    if (!confirmIt('Remove all simulated results? Manual results are kept.')) return;
    stopSim();
    store.update((s, e) => {
      for (const [id, r] of Object.entries(e.results)) if (r.source === 'sim') delete e.results[id];
    }, 'Simulated results cleared');
    toast('Simulated results cleared');
  });

  function tickLoop() {
    clearTimeout(sim.timer);
    if (!sim.running) return;
    const perMin = Number($('#simRate')?.value || 60);
    const interval = 60000 / perMin;
    const now = Date.now();
    store.update((s, e) => {
      // move one more seat into counting
      const next = sim.queue.shift();
      if (next) {
        e.results[next.id] = { status: 'counting', votes: {}, source: 'sim', updatedAt: now };
        sim.pending.set(next.id, now + interval * (3 + sim.rng() * 4));
      }
      // declare those whose count has finished
      for (const [id, due] of sim.pending) {
        if (due > now) continue;
        const con = s.constituencies.find((c) => c.id === id);
        const cur = e.results[id];
        if (!cur || cur.source !== 'sim') {
          sim.pending.delete(id);
          continue;
        }
        if (cur.status === 'counting' && sim.rng() < 0.03) {
          e.results[id] = { ...cur, status: 'recount', updatedAt: now };
          sim.pending.set(id, now + interval * 6);
          continue;
        }
        e.results[id] = { status: 'declared', votes: generateVotes(con, sim.shift, sim.rng), source: 'sim', updatedAt: now, declaredAt: now };
        sim.pending.delete(id);
      }
      if (!sim.queue.length && !sim.pending.size) {
        sim.running = false;
        e.status = 'complete';
      }
    });
    if (sim.running) sim.timer = setTimeout(tickLoop, interval);
  }
};
function stopSim() {
  clearTimeout(sim.timer);
  sim.running = false;
  sim.queue = [];
  sim.pending.clear();
}

// ---------------------------------------------------------------- elections & data
tabs.data = async () => {
  const user = await store.user();
  const draw = () => {
    const els = Object.values(store.state.elections).sort((a, b) => b.createdAt - a.createdAt);
    main.innerHTML = `
      <header class="cr-head"><h1>Elections &amp; data</h1></header>
      <div class="cr-cols">
        <section class="cr-card"><h2>Elections</h2>
          <table class="tbl tbl-compact"><thead><tr><th>Election</th><th>Status</th><th class="num">Declared</th><th></th></tr></thead><tbody>${els
            .map((e) => {
              const d = Object.values(e.results).filter((r) => r.status === 'declared').length;
              const active = e.id === store.state.activeElectionId;
              return `<tr><th>${esc(e.name)}${active ? ' <span class="pchip" style="--c:#2e7d32">Active</span>' : ''}</th><td>${esc(e.status)}</td><td class="num">${d}</td><td>${active ? '' : `<button class="btn" data-act="${e.id}">Make active</button> <button class="btn btn-danger" data-delel="${e.id}">Delete</button>`}</td></tr>`;
            })
            .join('')}</tbody></table>
          <h3>New election</h3>
          <div class="form-grid"><label>Name<input id="neName" placeholder="Usher General Election 2031"></label><label>Year<input id="neYear" type="number" value="${new Date().getFullYear() + 5}"></label><label>Previous election label<input id="nePrev" value="${store.election.year}"></label></div>
          <p class="hint">A new election starts with empty results. Constituencies, candidates and previous results are shared; update “previous” votes for the new baseline if needed.</p>
          <button class="btn" id="neCreate">Create election</button>
        </section>
        <section class="cr-card"><h2>Import and export</h2>
          <div class="ed-actions"><button class="btn" id="dExport">Export full backup (JSON)</button><button class="btn" id="dCons">Export constituencies.json</button><button class="btn" id="dParties">Export parties.json</button></div>
          <label>Import backup<input type="file" id="dImport" accept=".json,application/json"></label>
          <h3>Geography</h3><p class="hint">Load a GeoJSON map for this browser (features need <code>properties.id</code> = USH001… or a matching <code>properties.name</code>). For everyone, commit it as <code>map.geojson</code>.</p>
          <input type="file" id="dGeo" accept=".geojson,.json"><button class="btn btn-ghost" id="dGeoClear">Remove loaded geography</button>
          <h3>Reset</h3><p class="hint">Restores the original 650 demonstration constituencies, parties and an empty election.</p>
          <button class="btn btn-danger" id="dReset">Reset demonstration data</button>
        </section>
        <section class="cr-card"><h2>Backend</h2>${
          store.mode === 'live'
            ? `<p>Live mode: connected to Supabase. Signed in as <b>${esc(user?.email || 'unknown')}</b>. Writes are accepted only if this account is listed in <code>usher_admins</code>.</p><button class="btn" id="dOut">Sign out</button>`
            : `<p><b>Local demonstration mode.</b> Data lives in this browser’s storage and the control room is not protected — anyone who opens <code>admin.html</code> on their own device gets their own separate copy. To publish shared live results with a real login, configure Supabase (see README).</p>`
        }</section>
      </div>`;
    main.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      store.update((s) => (s.activeElectionId = b.dataset.act), `Active election changed to ${store.state.elections[b.dataset.act].name}`);
      draw();
    }));
    main.querySelectorAll('[data-delel]').forEach((b) => b.addEventListener('click', () => {
      const e = store.state.elections[b.dataset.delel];
      if (!confirmIt(`Permanently delete “${e.name}” and all of its results?`)) return;
      store.update((s) => delete s.elections[e.id], `Election deleted: ${e.name}`);
      draw();
    }));
    $('#neCreate').addEventListener('click', () => {
      const name = $('#neName').value.trim();
      const year = Number($('#neYear').value);
      if (!name || !year) return toast('Name and year are required.', 'bad');
      const id = `ge${year}-${store.uid().slice(0, 4)}`;
      if (!confirmIt(`Create “${name}” and make it the active election?`)) return;
      store.update((s) => {
        s.elections[id] = newElection(id, name, year, $('#nePrev').value.trim() || String(year - 5));
        s.activeElectionId = id;
      }, `Election created: ${name}`);
      draw();
    });
    $('#dExport').addEventListener('click', () => download(`usher-election-backup-${new Date().toISOString().slice(0, 10)}.json`, store.exportJSON()));
    $('#dCons').addEventListener('click', () => download('constituencies.json', JSON.stringify({ meta: store.base.meta, constituencies: store.constituencies })));
    $('#dParties').addEventListener('click', () => download('parties.json', JSON.stringify(store.parties, null, 2)));
    $('#dImport').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const obj = JSON.parse(await f.text());
        if (!confirmIt('Importing replaces ALL current data (every election). Continue?')) return;
        store.importJSON(obj);
        toast('Backup imported');
        draw();
      } catch (err) {
        toast(`Import failed: ${err.message}`, 'bad');
      }
    });
    $('#dGeo').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const ok = setGeoJSON(JSON.parse(await f.text()));
        toast(ok ? 'Geography saved in this browser' : 'Too large for browser storage — commit it as map.geojson instead', ok ? 'ok' : 'bad');
      } catch (err) {
        toast(`Could not read GeoJSON: ${err.message}`, 'bad');
      }
    });
    $('#dGeoClear').addEventListener('click', () => (setGeoJSON(null), toast('Loaded geography removed')));
    $('#dReset').addEventListener('click', () => {
      const typed = window.prompt('This erases every election and edit. Type RESET to confirm.');
      if (typed !== 'RESET') return;
      stopSim();
      store.resetDemo();
      toast('Demonstration data restored');
      draw();
    });
    $('#dOut')?.addEventListener('click', async () => {
      await store.signOut();
      location.reload();
    });
  };
  draw();
};

// ---------------------------------------------------------------- shell
function switchTab(name) {
  tabOff?.();
  tabOff = null;
  disposers.forEach((d) => d());
  disposers = [];
  tab = name;
  $$('.cr-nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  tabs[name]();
  main.focus({ preventScroll: true });
}

function modeBar() {
  $('#modeBar').innerHTML =
    store.mode === 'live'
      ? `<span class="live-dot"></span>LIVE — changes publish to every visitor`
      : `LOCAL DEMO — stored in this browser only. This page is not private; configure Supabase for a secured control room.`;
  $('#modeBar').className = `mode-bar ${store.mode}`;
}

function loginScreen() {
  main.innerHTML = `<section class="cr-card login"><h1>Control room sign-in</h1><p>Sign in with an account listed in the <code>usher_admins</code> table.</p>
    <form id="login"><label>Email<input type="email" id="lEmail" required autocomplete="username"></label><label>Password<input type="password" id="lPass" required autocomplete="current-password"></label><button class="btn btn-go">Sign in</button><p class="hint" id="lMsg"></p></form></section>`;
  $('.cr-nav').hidden = true;
  $('#login').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await store.signIn($('#lEmail').value, $('#lPass').value);
      location.reload();
    } catch (err) {
      $('#lMsg').textContent = err.message;
    }
  });
}

async function boot() {
  main.innerHTML = '<p class="loading">Loading…</p>';
  await store.init();
  modeBar();
  setInterval(() => ($('#crClock').textContent = new Date().toLocaleTimeString('en-GB')), 1000);
  window.addEventListener('usher-write-error', (e) => toast(`Not saved to server: ${e.detail}`, 'bad'));
  if (remoteConfigured && store.mode === 'live' && !(await store.user())) return loginScreen();
  $('.cr-nav').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) switchTab(b.dataset.tab);
  });
  switchTab('overview');
}
boot();
