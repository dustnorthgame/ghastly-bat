# Usher Decides — General Election coverage platform

A complete election-night website for the fictional country of **Usher**: live results for all 650 constituencies, a 3D exit poll reveal, a 3D swingometer, a 3D constituency map, a House of Commons view, broadcast graphics for streaming, and a private control room.

Everything is plain HTML, CSS and JavaScript. It runs on **GitHub Pages** with no build step and no server.

---

## Quick start

**On your computer** (browsers block data files on `file://` pages, so use a tiny local server):

```bash
cd usher-election
python3 -m http.server 8000
```

Then open:

| Page | Address |
|---|---|
| Public site | http://localhost:8000/ |
| Control room | http://localhost:8000/admin.html |
| Programme output (follows cues) | http://localhost:8000/broadcast.html?follow=1 |

**On GitHub Pages**

1. Create a repository and upload every file in this folder to its root.
2. Go to **Settings → Pages**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Your site appears at `https://<username>.github.io/<repository>/` after a minute or so.

To try a full election night straight away: open the control room → **Simulation** → **Start election night** (or **Declare all instantly**), and watch the public site in another tab.

---

## Files

| File | Purpose |
|---|---|
| `index.html`, `app.js` | Public site: live home page, results centre, constituency directory and pages, map, swingometer, exit poll, graphics index |
| `admin.html`, `admin.js` | Control room (not linked from the public navigation) |
| `broadcast.html`, `broadcast.js` | Clean full-screen graphics for OBS / screen recording |
| `graphics3d.js` | All Three.js scenes: hexagon badges, exit poll stage, party panel wall, swingometer, seat columns, Commons chamber, 3D map, declaration, victory |
| `views.js` | Connects election data to the 3D scenes; used by all three pages |
| `calc.js` | Election maths (FPTP winners, majorities, gains/losses, vote share, Butler swing, uniform swing, exit poll validation). No DOM — testable in Node |
| `sim.js` | Sample result generator for simulation mode |
| `store.js` | Shared state, local storage, cross-tab sync, optional Supabase backend |
| `config.js` | Backend settings (empty = local demo mode) |
| `constituencies.json` | The 650 constituencies (editable fictional data) |
| `parties.json` | Starting parties |
| `supabase-schema.sql` | Database tables and Row Level Security for live mode |
| `test.mjs`, `package.json` | Automated checks — run `node test.mjs` |
| `style.css` | All styling |

---

## The electoral system

- First Past the Post, 650 single-member constituencies, **326** for an overall majority.
- The candidate with the most votes wins the seat. A tie for first cannot be declared until the admin resolves it.
- A seat counts nationally **only when its status is Declared**. Awaiting, Counting and Recount seats never add to totals.
- Hung parliaments are reported as "short by N"; a party that has not yet reached 326 while seats remain is shown as "needs N more".
- The House of Commons view puts the largest party on the government benches. Coalition or minority arrangements are a political judgement, so the platform reports the arithmetic rather than inventing a government.
- Independents are individual candidates (party `IND` plus their own ballot label). They are grouped as "Others" only in national totals.

---

## Local demo mode vs live mode

**Local demo mode (default)** — `config.js` is empty. All data lives in your browser's localStorage. Tabs in the same browser stay in sync, so the control room, the public site and broadcast windows work together on one machine. This is ideal for rehearsals, recording and livestreaming from one computer.

> **The control room is not private in this mode.** Anyone who opens `admin.html` gets their own separate copy in their own browser; they cannot change what *you* see, but the page itself is not protected. Hiding the link or adding a JavaScript password would not change that, so the site doesn't pretend to.

**Live mode (Supabase)** — every visitor sees the same results in real time, and only signed-in admins can change them. Security is enforced by the database (Row Level Security), not by the browser.

### Setting up Supabase

1. Create a free project at supabase.com.
2. Open **SQL Editor**, paste the whole of `supabase-schema.sql`, and run it.
3. **Authentication → Providers → Email**: keep email sign-in on. Under **Authentication → Sign In / Up**, turn **off** "Allow new users to sign up" so strangers can't create accounts.
4. **Authentication → Users → Add user**: create your admin account with a strong password.
5. Grant it admin rights in the SQL editor:
   ```sql
   insert into public.usher_admins (user_id)
   select id from auth.users where email = 'you@example.com';
   ```
6. **Project Settings → API**: copy the **Project URL** and the **anon public** key into `config.js`. The anon key is meant to be public — RLS is what protects your data. **Never** put the `service_role` key in any file on the site.
7. Commit and push. The control room now asks you to sign in, and every write is checked against `usher_admins` by the database.

The whole election state is stored as one JSON row. That keeps the site simple and fast for one control room. If several people will enter results at the same moment, the last save wins — coordinate who edits which seats.

---

## The control room (`admin.html`)

- **Overview** — declared, counting, recounts, to declare, turnout, standings, recent changes and seats currently in play.
- **Constituencies** — search all 650; edit name, region, electorate, previous result; add, edit or remove candidates (including independents); enter votes; set Awaiting / Counting / Recount; **Declare**; **Save correction** on a declared seat; clear a result; cue the declaration graphic.
- **Parties** — rename, change abbreviations and colours, add new parties (optionally with a candidate in every seat), delete unused parties. An optional leader image URL appears in the exit poll graphics — use your own artwork.
- **Exit poll** — enter projected seats; the total must be exactly 650 before you can publish. Projections are stored separately and never count as results. Cue the honeycomb reveal or the party wall on air.
- **Newsroom** — election status, banner (breaking / flash / result / projection), ticker lines, live-coverage announcements.
- **Broadcast** — one-click cues for every graphic, replay, and a programme monitor.
- **Simulation** — set the national movement for each party, a seed and a declaration rate, then run a full night with counting, occasional recounts and declarations. Pause and resume at any time. Simulated results are tagged **SIM** everywhere and a striped notice appears on the public site. They never overwrite manually entered results unless you tick the box and confirm. **Clear simulated results** removes only simulated data.
- **Elections & data** — create elections, switch the active one, delete old ones, export a full backup, export `constituencies.json` / `parties.json`, import a backup, load a GeoJSON map, and reset the demonstration data (you must type RESET).

Destructive actions always ask for confirmation.

---

## Broadcast graphics

Every graphic opens as a clean full-screen page at `broadcast.html?g=<name>`:

| `g=` | Graphic |
|---|---|
| `exitpoll` | 3D honeycomb exit poll in front of a lit townhouse façade |
| `exitwall` | 3D curved wall of party panels with hexagon badges and "+N since" |
| `projection` | Exit poll as 3D seat columns with the majority line |
| `seats` | Declared seats as 3D columns with the 326 line |
| `share` | National vote share columns |
| `net` | Net gains and losses |
| `chamber` | 3D House of Commons composition |
| `swing` | 3D swingometer (add `&a=CON&b=BWP&mode=hypothetical&swing=4`) |
| `map` | 3D constituency map |
| `declaration` | Latest declaration, or `&id=USH123` |
| `victory` | Election outcome announcement |
| `breaking`, `ticker`, `gains` | HTML lower thirds — add `&bg=transparent` for OBS overlays |

Options: `&follow=1` (switch when the control room cues), `&ticker=1` / `&breaking=1` (overlay on any graphic), `&still=1` (skip animations — useful for thumbnails).

Keys: **F** full screen, **R** replay, **H** hide the help hint.

**OBS:** add a Browser Source, size 1920×1080, URL `…/broadcast.html?follow=1`. For overlays, add a second source with `?g=ticker&bg=transparent`.

The exit poll design follows your reference images: dimensional bevelled hexagons with a sunburst rim and a raised white face, the largest party large and centred, the others in honeycomb clusters either side, a white sign above, the façade washed in the leading party's colour, and a smallest-to-largest reveal with counting numbers. The façade is a procedurally drawn generic Georgian townhouse, and no broadcaster's logos or branding are used.

---

## Editing the data

**Constituencies** — edit in the control room, or replace `constituencies.json`. Each entry looks like:

```json
{
  "id": "USH001",
  "name": "Ashbridge West",
  "region": "Coastway",
  "electorate": 64210,
  "hex": { "col": 12, "row": 30 },
  "candidates": [
    { "id": "c001-uip", "name": "Amelia Reid", "party": "UIP" },
    { "id": "c001-ind1", "name": "Sam Doe", "party": "IND", "label": "Independent" }
  ],
  "previous": { "winner": "CON", "turnout": 0.66, "votes": { "UIP": 9000, "BWP": 12000, "CON": 15000, "IND": 800 } }
}
```

There must be exactly 650 entries with unique IDs. Results are kept separately, per election, so the same constituency file serves several elections.

Browsers keep their saved copy after the first visit. After replacing the JSON files, use **Elections & data → Reset demonstration data** (or clear site data) to load them.

**Parties** — `parties.json`, or the Parties tab.

---

## Your own map of Usher

The built-in map is a **placeholder hexagon cartogram**: one hexagon per constituency, arranged in an island shape. It is labelled as not showing official boundaries.

To use real geography, make a GeoJSON file of polygons where each feature has `properties.id` equal to a constituency ID (`USH001`…`USH650`) — or `properties.name` matching the constituency name. Then either:

- commit it to the repository as **`map.geojson`** (everyone sees it), or
- load it from the map page or the control room (this browser only).

The map extrudes each constituency in 3D, coloured by the winning party, with hover, search, region focus and full-screen mode exactly as with the hexagons. Longitude/latitude and projected coordinates both work.

---

## Swingometer: actual vs hypothetical

- **Actual** — the average Butler swing between the two chosen parties across constituencies that have **declared**. Seat figures show what that swing would mean if it were repeated everywhere.
- **Hypothetical** — drag the slider to apply a uniform national swing to the **previous election's** result in every seat. This is a scenario, not a result, and is labelled as one.

Each hexagon on the dial is a seat where the two parties were first and second last time, placed at the swing needed for it to change hands. Seats light up and flip colour as the pointer passes them.

---

## Testing

```bash
node test.mjs
```

This checks: exactly 650 constituencies with unique IDs and names; valid parties and candidates; one winner per seat; ties never declared; nothing counts before declaration; seat totals never exceed 650; gains equal losses; vote shares sum to 100% and match raw votes; FPTP seat outcomes differ from proportional shares; 326 for a majority; exit poll totals must be exactly 650 whole seats; the exit poll never touches results; uniform swing and swingometer targets behave correctly; actual swing uses declared seats only.

The site was also tested in a headless browser: every page and graphic loads without errors, and the control room's publish, declare, recount, correction, tie refusal, simulation, pause, clear-simulation, banner, cue and reset workflows were exercised end to end.

---

## Notes

- Three.js 0.160 and the fonts (Barlow, Barlow Condensed) load from public CDNs, so the site needs an internet connection.
- The 3D scenes respect the system "reduce motion" setting.
- Live-mode cues to broadcast windows travel inside the protected database row, so only admins can change what is on air.
- All names, candidates, regions and results are fictional and editable.
