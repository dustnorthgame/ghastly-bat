// store.js — shared election state for every page (public site, admin, broadcast).
// Local demo mode: localStorage + cross-tab sync. Live mode: Supabase row + realtime.
import config from './config.js';
import { tally, TOTAL_SEATS } from './calc.js';

const LS_KEY = 'usher-election-state-v1';
const CUE_KEY = 'usher-election-cue-v1';
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('usher-election') : null;

const listeners = new Set();
const cueListeners = new Set();
let state = null;
let base = null;
let supabase = null;
let remoteTimer = null;
let cachedTally = null;

export const remoteConfigured = !!(config.supabaseUrl && config.supabaseAnonKey);

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function newElection(id, name, year, previousLabel) {
  return {
    id,
    name,
    year,
    previousLabel,
    status: 'upcoming', // upcoming | polls-open | polls-closed | counting | complete
    results: {},
    exitPoll: { seats: {}, published: false, publishedAt: null },
    announcements: [],
    ticker: [],
    banner: { visible: false, text: '', style: 'breaking' },
    log: [],
    createdAt: Date.now(),
  };
}

function defaultState() {
  const e = newElection('ge2026', 'Usher General Election 2026', 2026, '2021');
  e.announcements = [
    { id: uid(), time: Date.now(), text: 'Polls open at 7am and close at 10pm. Counting begins immediately after.', priority: 'normal' },
  ];
  e.ticker = [
    'Polls close at 10pm — first declarations expected shortly before midnight',
    '650 constituencies · 326 seats needed for an overall majority',
    'Usher Independence Party, British Workers Party and Conservatives contest every seat',
  ];
  return {
    version: 1,
    parties: structuredClone(base.parties),
    constituencies: structuredClone(base.constituencies),
    elections: { [e.id]: e },
    activeElectionId: e.id,
    updatedAt: Date.now(),
  };
}

async function loadBase() {
  const [parties, cons] = await Promise.all([
    fetch('parties.json').then((r) => r.json()),
    fetch('constituencies.json').then((r) => r.json()),
  ]);
  base = { parties, constituencies: cons.constituencies, meta: cons.meta };
}

function readLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function writeLocal() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('Could not save to localStorage', err);
  }
}

async function initRemote() {
  const mod = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  supabase = mod.createClient(config.supabaseUrl, config.supabaseAnonKey);
  const { data, error } = await supabase.from('usher_state').select('data').eq('id', config.stateRowId).maybeSingle();
  if (error) console.error('Supabase read failed', error);
  state = data?.data || null;
  supabase
    .channel('usher-state')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'usher_state', filter: `id=eq.${config.stateRowId}` }, (payload) => {
      if (payload.new?.data) {
        const prevCue = state?.cue?.nonce;
        state = payload.new.data;
        emit(false);
        // Cues travel inside the RLS-protected row, so only admins can trigger graphics.
        if (state.cue && state.cue.nonce !== prevCue) cueListeners.forEach((fn) => fn(state.cue));
      }
    })
    .subscribe();
}

function queueRemoteWrite() {
  if (!supabase) return;
  clearTimeout(remoteTimer);
  remoteTimer = setTimeout(async () => {
    const { error } = await supabase.from('usher_state').upsert({ id: config.stateRowId, data: state, updated_at: new Date().toISOString() });
    if (error) {
      console.error('Supabase write refused', error);
      window.dispatchEvent(new CustomEvent('usher-write-error', { detail: error.message }));
    }
  }, 400);
}

function emit(persist = true) {
  cachedTally = null;
  if (persist) {
    state.updatedAt = Date.now();
    writeLocal();
    queueRemoteWrite();
    channel?.postMessage({ type: 'state' });
  }
  listeners.forEach((fn) => fn(state));
}

export const store = {
  get mode() {
    return supabase ? 'live' : 'local';
  },
  get supabase() {
    return supabase;
  },
  get state() {
    return state;
  },
  get base() {
    return base;
  },
  get parties() {
    return state.parties;
  },
  get constituencies() {
    return state.constituencies;
  },
  get election() {
    return state.elections[state.activeElectionId];
  },
  partyById(id) {
    return state.parties.find((p) => p.id === id) || { id, name: id || 'Unknown', short: id || '?', colour: '#7a808a', text: '#fff' };
  },
  partyName(id) {
    return store.partyById(id).name;
  },
  conById(id) {
    return state.constituencies.find((c) => c.id === id);
  },
  /** Cached national tally for the active election. */
  tally() {
    if (!cachedTally) cachedTally = tally(state.constituencies, store.election.results, state.parties);
    return cachedTally;
  },
  hasSimulated() {
    return Object.values(store.election.results).some((r) => r.source === 'sim');
  },

  async init() {
    await loadBase();
    if (remoteConfigured) {
      try {
        await initRemote();
      } catch (err) {
        console.error('Supabase unavailable, falling back to local demo', err);
      }
    }
    if (!state) state = readLocal();
    if (!state || state.version !== 1 || state.constituencies?.length !== TOTAL_SEATS) {
      state = defaultState();
      writeLocal();
    }

    window.addEventListener('storage', (e) => {
      if (e.key === LS_KEY && e.newValue && !supabase) {
        state = JSON.parse(e.newValue);
        emit(false);
      }
      if (e.key === CUE_KEY && e.newValue) cueListeners.forEach((fn) => fn(JSON.parse(e.newValue)));
    });
    channel?.addEventListener('message', (e) => {
      if (e.data?.type === 'cue') cueListeners.forEach((fn) => fn(e.data.cue));
    });
    return state;
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** Mutate state. `fn` receives (state, election). Optional log line for the control-room feed. */
  update(fn, logText) {
    fn(state, store.election);
    if (logText) {
      const log = store.election.log;
      log.unshift({ id: uid(), time: Date.now(), text: logText });
      log.length = Math.min(log.length, 300);
    }
    emit(true);
  },

  /** Ask broadcast windows to show a graphic. */
  cue(graphic, params = {}) {
    const cue = { graphic, params, at: Date.now(), nonce: uid() };
    try {
      localStorage.setItem(CUE_KEY, JSON.stringify(cue));
    } catch {}
    channel?.postMessage({ type: 'cue', cue });
    if (supabase) {
      state.cue = cue;
      emit(true);
    }
    cueListeners.forEach((fn) => fn(cue));
    return cue;
  },
  lastCue() {
    if (supabase && state.cue) return state.cue;
    try {
      return JSON.parse(localStorage.getItem(CUE_KEY));
    } catch {
      return null;
    }
  },
  onCue(fn) {
    cueListeners.add(fn);
    return () => cueListeners.delete(fn);
  },

  resetDemo() {
    state = defaultState();
    emit(true);
  },
  exportJSON() {
    return JSON.stringify(state, null, 2);
  },
  importJSON(obj) {
    if (!obj || obj.version !== 1 || !Array.isArray(obj.constituencies) || !obj.elections) throw new Error('Not an Usher election export (version 1).');
    if (obj.constituencies.length !== TOTAL_SEATS) throw new Error(`Export has ${obj.constituencies.length} constituencies; exactly ${TOTAL_SEATS} are required.`);
    const ids = new Set(obj.constituencies.map((c) => c.id));
    if (ids.size !== TOTAL_SEATS) throw new Error('Constituency IDs must be unique.');
    state = obj;
    emit(true);
  },

  uid,

  // ---- auth (live mode only)
  async user() {
    if (!supabase) return null;
    const { data } = await supabase.auth.getUser();
    return data.user;
  },
  async signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  },
  async signOut() {
    await supabase?.auth.signOut();
  },
};

export function partyColour(id) {
  return store.partyById(id).colour;
}
