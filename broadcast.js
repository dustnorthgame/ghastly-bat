// broadcast.js — clean full-screen graphics output for streaming / recording.
// broadcast.html?g=exitpoll            one graphic
// broadcast.html?follow=1              switches when the control room cues a graphic
// &bg=transparent                      transparent page (for HTML lower thirds in OBS)
// &ticker=1 / &breaking=1              overlay the ticker / breaking lower third on any graphic
import { store } from './store.js';
import { GRAPHICS, mountTicker, mountBreaking, esc } from './views.js';

const q = new URLSearchParams(location.search);
const program = document.getElementById('program');
const lower = document.getElementById('lower');
const help = document.getElementById('bcHelp');
let current = null;
let currentKey = null;

if (q.get('bg') === 'transparent') document.body.classList.add('transparent');

function slate() {
  program.innerHTML = `<div class="slate"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 1 29 8.5v15L16 31 3 23.5v-15Z"/></svg><b>USHER</b> DECIDES<small>${esc(store.election.name)}</small></div>`;
}

async function show(key, params = q) {
  const g = GRAPHICS[key];
  program.classList.add('fade');
  await new Promise((r) => setTimeout(r, current ? 350 : 0));
  await Promise.resolve(current)?.then?.((c) => c?.dispose?.());
  current = null;
  program.innerHTML = '';
  currentKey = key;
  if (!g) slate();
  else {
    const holder = document.createElement('div');
    holder.className = `bc-graphic ${g.html ? 'bc-html' : ''}`;
    program.appendChild(holder);
    current = g.mount(holder, Object.fromEntries(params));
  }
  requestAnimationFrame(() => program.classList.remove('fade'));
}

async function boot() {
  await store.init();
  document.title = `${GRAPHICS[q.get('g')]?.title || 'Programme'} — Usher Decides`;
  if (q.get('ticker') === '1') mountTicker(lower.appendChild(document.createElement('div')));
  if (q.get('breaking') === '1') mountBreaking(lower.appendChild(document.createElement('div')));

  if (q.get('follow') === '1') {
    const last = store.lastCue();
    await show(last?.graphic || q.get('g') || null, new URLSearchParams(last?.params || {}));
    store.onCue((cue) => {
      if (cue.graphic === '_replay') return Promise.resolve(current).then((c) => c?.replay?.());
      show(cue.graphic, new URLSearchParams(cue.params || {}));
    });
  } else {
    await show(q.get('g') || 'exitpoll');
  }

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea')) return;
    const k = e.key.toLowerCase();
    if (k === 'f') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    if (k === 'r') Promise.resolve(current).then((c) => (c?.replay ? c.replay() : show(currentKey)));
    if (k === 'h') help.hidden = !help.hidden;
  });
  setTimeout(() => help.classList.add('dim'), 4000);
}
boot();
