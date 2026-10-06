// Real SocialDads — weekly 5/6/7/8-a-side organiser.
// Plain ES modules, no build step. Data + GitHub login via Supabase.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY, APP_NAME, ENABLE_GITHUB } from './config.js';
import { drawTeams, validateRules } from './draw.js';

// Team names and colours are just for fun: they are stored on each game and never used for stats
// (stats only know team 'A' / team 'B'). No name or colour chosen = the original Blue v Orange.
const PALETTE = {
  red: { label: 'Red', emoji: '🔴' }, orange: { label: 'Orange', emoji: '🟠' }, yellow: { label: 'Yellow', emoji: '🟡' },
  green: { label: 'Green', emoji: '🟢' }, blue: { label: 'Blue', emoji: '🔵' }, purple: { label: 'Purple', emoji: '🟣' },
  black: { label: 'Black', emoji: '⚫' }, white: { label: 'White', emoji: '⚪' },
};
const pal = (k) => PALETTE[k] || PALETTE.blue;
const freshStyle = () => ({ A: { name: '', colour: 'blue' }, B: { name: '', colour: 'orange' } });
const matchStyle = (m) => ({
  A: { name: m.team_a_name || '', colour: PALETTE[m.team_a_colour] ? m.team_a_colour : 'blue' },
  B: { name: m.team_b_name || '', colour: PALETTE[m.team_b_colour] ? m.team_b_colour : 'orange' },
});
const tName = (st, t) => (st[t].name || '').trim() || pal(st[t].colour).label;
const $app = document.getElementById('app');
document.title = APP_NAME;

// Tidy whatever was pasted into config.js: stray quotes/spaces, and any path on the end of the
// URL (Supabase's dashboard shows ".../rest/v1/" in places, which breaks sign-in).
const stripQuotes = (v) => String(v ?? '').trim().replace(/^['"`\u2018\u2019\u201C\u201D]+|['"`\u2018\u2019\u201C\u201D]+$/g, '').trim();
function cleanUrl(v) {
  const s = stripQuotes(v);
  try { return new URL(s).origin; } catch { return s; }
}
const SB_URL = cleanUrl(SUPABASE_URL);
const SB_KEY = stripQuotes(SUPABASE_ANON_KEY);
const configured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SB_URL) && !SB_KEY.includes('YOUR-ANON') && SB_KEY.length > 20;
const sb = configured
  ? createClient(SB_URL, SB_KEY, { auth: { flowType: 'implicit', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } })
  : null;

const state = {
  session: null, profile: null, enteredFor: null, ready: false,
  players: [], matches: [], mp: [], ballots: new Set(), motm: [], stats: [], profiles: [],
};
const ui = {
  draft: { date: today(), format: 6, selected: new Set(), teams: null, animate: false, rules: { together: [], apart: [] }, ruleType: 'together', rulePick: new Set() },
  sort: { key: 'wins', dir: -1 },
  year: new Date().getFullYear(),
  merge: null,
  style: { draft: freshStyle() },
  choice: {},
};
let routeToken = 0;
const linkError = /error_description=|error_code=/.test(location.hash);
// An invite link looks like  https://your-site/?invite=TOKEN . Remember it (it survives the email sign-in) and tidy the address bar.
try {
  const qs = new URLSearchParams(location.search);
  const tok = qs.get('invite');
  if (tok) {
    localStorage.setItem('rsd_invite', tok.replace(/[^a-zA-Z0-9]/g, ''));
    qs.delete('invite');
    history.replaceState(null, '', location.pathname + (qs.toString() ? `?${qs}` : '') + location.hash);
  }
} catch { /* storage blocked: the invite just won't be auto-applied */ }
const pendingInvite = () => { try { return localStorage.getItem('rsd_invite'); } catch { return null; } };
const clearInvite = () => { try { localStorage.removeItem('rsd_invite'); } catch { /* ignore */ } };

/* ------------------------------------------------------------------ helpers */
function today() {
  return new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dateObj = (d) => new Date(d + 'T12:00:00');
const fmtLong = (d) => dateObj(d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const isAdmin = () => !!(state.profile?.is_admin && state.profile?.is_approved);
const isOrganiser = () => !!(state.profile?.is_approved && (state.profile?.is_admin || state.profile?.can_organise));
const pname = (id) => player(id)?.name || 'a player';
const player = (id) => state.players.find((p) => p.id === id);
const myPlayer = () => state.players.find((p) => p.profile_id === state.session?.user?.id);
const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '?';

function disc(p) {
  const name = p?.name || p?.display_name || p?.github_username || '?';
  const img = p?.avatar_url ? `<img src="${esc(p.avatar_url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : esc(initials(name));
  return `<span class="disc">${img}</span>`;
}

let toastTimer;
function toast(msg, isErr = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), isErr ? 5000 : 2400);
}
const errMsg = (e) => e?.message || String(e);

async function busy(el, fn) {
  if (el) el.disabled = true;
  try { await fn(); } catch (e) { console.error(e); toast(errMsg(e), true); }
  finally { if (el && el.isConnected) el.disabled = false; }
}

/* --------------------------------------------------------------- data layer */
async function loadAll() {
  const q = [
    sb.from('players').select('*').order('name'),
    sb.from('matches').select('*').order('played_on', { ascending: false }).order('created_at', { ascending: false }),
    sb.from('match_players').select('*'),
    sb.from('motm_ballots').select('match_id'),
    sb.from('motm_results').select('*'),
    sb.from('player_stats').select('*'),
    sb.from('profiles').select('*').order('created_at'),
  ];
  const res = await Promise.all(q);
  const bad = res.find((r) => r.error);
  if (bad) throw bad.error;
  const [pl, ma, mp, bal, mr, st, pr] = res.map((r) => r.data);
  Object.assign(state, {
    players: pl, matches: ma, mp, ballots: new Set(bal.map((b) => b.match_id)), motm: mr, stats: st, profiles: pr,
  });
}
async function refresh(keepScroll = true) {
  await loadAll();
  await route(keepScroll);
}

/* -------------------------------------------------------------------- boot */
async function boot() {
  if (!configured) { $app.innerHTML = setupScreen(); return; }
  sb.auth.onAuthStateChange((evt, session) => {
    state.session = session;
    if (evt === 'SIGNED_OUT') { state.enteredFor = null; state.ready = false; ui.loginEmail = null; showLogin(); return; }
    if (evt === 'INITIAL_SESSION' || evt === 'SIGNED_IN') setTimeout(() => enter(session), 0);
  });
}

async function enter(session) {
  const uid = session?.user?.id;
  if (!uid) return showLogin();
  if (state.enteredFor === uid) return;
  state.enteredFor = uid;
  $app.innerHTML = '<p class="boot">Loading…</p>';
  try {
    const inviteTok = pendingInvite();
    let welcome = null;
    if (inviteTok) {
      const { data: gName, error: invErr } = await sb.rpc('claim_invite', { p_token: inviteTok });
      clearInvite();
      if (invErr) setTimeout(() => toast(errMsg(invErr), true), 400);
      else welcome = gName;
    }
    const { data: profile, error } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
    if (error) throw error;
    if (!profile) return showNoProfile();
    if (welcome) setTimeout(() => toast(`Welcome, ${welcome}! Your games and stats are linked to you.`), 600);
    state.profile = profile;
    if (!profile.name_confirmed) return showNamePrompt();
    if (!profile.is_approved) return showPending();
    await loadAll();
    state.ready = true;
    renderShell();
    await route();
  } catch (e) {
    console.error(e);
    state.enteredFor = null;
    $app.innerHTML = `<div class="hero"><div class="hero-in"><h1>Couldn't load</h1><p>${esc(errMsg(e))}</p>
      <p class="small-text">If this mentions a missing table or view, run supabase/schema.sql in the Supabase SQL editor.</p>
      <button class="btn block" data-act="reload">Try again</button>
      <p style="margin-top:12px"><button class="btn ghost block" data-act="signout-now">Sign out</button></p></div></div>`;
  }
}

/* ---------------------------------------------------------------- screens */
function setupScreen() {
  return `<div class="hero"><div class="hero-in"><h1>Almost there</h1>
    <p>Open <b>config.js</b> and add your Supabase Project URL (like <b>https://abcd.supabase.co</b>) and your publishable key, then reload.</p>
    <p class="small-text">The README walks through every step.</p></div></div>`;
}
const GH_ICON = '<svg width="22" height="22" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>';

function showLogin() {
  if (ui.loginEmail) return showCheckEmail(ui.loginEmail);
  $app.innerHTML = `<div class="hero"><div class="hero-in">
    <div class="mini-pitch" aria-hidden="true"></div>
    <h1>${esc(APP_NAME)}</h1>
    <p>Fair teams, final scores and proper stats for the weekly game.</p>
    ${pendingInvite() ? '<p class="notice" role="status">You\'ve been invited! Enter your email below to join. Your games and stats will be linked to you.</p>' : ''}
    ${linkError && !ui.linkErrorShown ? '<p class="notice" role="alert">That sign-in link has expired or was already used. Enter your email to get a new one.</p>' : ''}
    <form data-form="send-link" class="login-form">
      <label class="field"><span>Your email</span>
        <input type="email" id="login-email" inputmode="email" autocomplete="email" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="you@example.com" required></label>
      <button class="btn block" type="submit">Email me a sign-in link</button>
    </form>
    <p class="small-text muted" style="margin-top:12px">No password needed. You'll stay signed in on this device.</p>
    ${ENABLE_GITHUB ? `<p class="or">or</p><button class="btn ghost block" data-act="login-github">${GH_ICON} Continue with GitHub</button>` : ''}
  </div></div>`;
  ui.linkErrorShown = true;
}
function showCheckEmail(email) {
  $app.innerHTML = `<div class="hero"><div class="hero-in">
    <h1>Check your email</h1>
    <p>We sent a sign-in link to <b>${esc(email)}</b>. Tap it to get in.</p>
    <form data-form="verify" class="login-form">
      <label class="field"><span>Or type the code from the email</span>
        <input type="text" id="login-code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="123456" style="text-align:center;font:700 26px var(--display);letter-spacing:.2em"></label>
      <button class="btn block" type="submit">Sign in with code</button>
    </form>
    <p class="small-text muted" style="margin-top:12px">On an iPhone home-screen app, use the code: the link opens in Safari instead. Nothing there? Check your spam folder.</p>
    <p style="margin-top:14px"><button class="btn ghost block" data-act="other-email">Use a different email</button></p>
  </div></div>`;
}
function showNamePrompt() {
  const p = state.profile;
  $app.innerHTML = `<div class="hero"><div class="hero-in">
    <h1>What should we call you?</h1>
    <p>This is the name your friends see on the pitch and in the stats.</p>
    <form data-form="name" class="login-form">
      <label class="field"><span>Your name</span>
        <input type="text" id="my-name" maxlength="40" autocomplete="name" placeholder="e.g. Sam Carter" value="" required></label>
      <button class="btn block" type="submit">Continue</button>
    </form>
    <p class="small-text muted" style="margin-top:12px">Signed in as ${esc(p.email || '@' + p.github_username)}</p>
  </div></div>`;
}
function showPending() {
  const p = state.profile;
  $app.innerHTML = `<div class="hero"><div class="hero-in">
    <div style="display:flex;justify-content:center;margin-bottom:14px">${disc(p).replace('class="disc"', 'class="disc" style="width:72px;height:72px;font-size:28px"')}</div>
    <h1>Waiting for approval</h1>
    <p>You're signed in as <b>${esc(p.display_name)}</b> (${esc(p.email || '@' + p.github_username)}). An organiser needs to approve you before you can see the games. Let them know you've signed up.</p>
    <p><button class="btn block" data-act="reload">Check again</button></p>
    <p><button class="btn ghost block" data-act="signout-now">Sign out</button></p>
  </div></div>`;
}
function showNoProfile() {
  $app.innerHTML = `<div class="hero"><div class="hero-in"><h1>No profile found</h1>
    <p>This GitHub account signed in before the database was set up. In Supabase go to <b>Authentication → Users</b>, delete this user, then sign in again.</p>
    <p><button class="btn ghost block" data-act="signout-now">Sign out</button></p></div></div>`;
}

const ICONS = {
  matches: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14"/><circle cx="12" cy="12" r="2.5"/></svg>',
  new: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
  stats: '<svg viewBox="0 0 24 24"><path d="M5 20V11M12 20V4M19 20v-6"/></svg>',
  admin: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M17 8h4M19 6v4"/></svg>',
};

function renderShell() {
  const me = state.profile;
  const tabs = [['', 'Matches', ICONS.matches]];
  if (isOrganiser()) tabs.push(['new', 'New game', ICONS.new]);
  tabs.push(['stats', 'Stats', ICONS.stats]);
  if (isAdmin()) tabs.push(['admin', 'Admin', ICONS.admin]);
  $app.innerHTML = `<div class="shell">
    <header class="top"><div class="brand"><i></i>${esc(APP_NAME)}</div>
      <a class="me" href="#/me" aria-label="Your profile: ${esc(me.display_name)}">${disc({ name: me.display_name, avatar_url: me.avatar_url })}</a></header>
    <main id="view"></main>
    <nav class="tabs" aria-label="Main"><div class="tabs-inner">
      ${tabs.map(([k, l, i]) => `<a href="#/${k}" data-tab="${k}">${i}<span>${l}</span></a>`).join('')}
    </div></nav></div>`;
}

/* ------------------------------------------------------------------ router */
async function route(keepScroll = false) {
  if (!state.ready) return;
  const view = document.getElementById('view');
  if (!view) return;
  const [seg = '', arg] = location.hash.replace(/^#\/?/, '').split('/');
  const token = ++routeToken;
  const y = window.scrollY;
  if (seg === 'match' && !keepScroll) delete ui.style[arg]; // forget unsaved name/colour edits when (re)opening a game
  let html;
  try {
    if ((seg === 'new' && !isOrganiser()) || (seg === 'admin' && !isAdmin())) { location.hash = '#/'; return; }
    if (seg === 'match') html = await viewMatch(arg);
    else if (seg === 'new') html = viewNew();
    else if (seg === 'stats') html = viewStats();
    else if (seg === 'admin') html = viewAdmin();
    else if (seg === 'me') html = viewMe();
    else html = viewMatches();
  } catch (e) { console.error(e); html = `<div class="card empty"><h2>Something went wrong</h2><p>${esc(errMsg(e))}</p></div>`; }
  if (token !== routeToken) return;
  view.innerHTML = html;
  document.querySelectorAll('.tabs a').forEach((a) => {
    const on = a.dataset.tab === (seg === 'match' ? '' : seg);
    a.classList.toggle('on', on);
    on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
  });
  window.scrollTo(0, keepScroll ? y : 0);
}
window.addEventListener('hashchange', () => route());

/* ------------------------------------------------------------ seasons (calendar years) */
const curYear = () => new Date().getFullYear();
const matchYear = (m) => parseInt(m.played_on.slice(0, 4), 10);
function yearsAvailable() {
  const ys = new Set(state.matches.map(matchYear));
  ys.add(curYear());
  return [...ys].sort((a, b) => b - a);
}
function yearPicker() {
  if (!yearsAvailable().includes(ui.year)) ui.year = curYear();
  const note = ui.year < curYear()
    ? `${ui.year} is an archived season. Everything starts fresh each 1 January.`
    : `Games and stats run for the calendar year and start fresh each 1 January. Past seasons stay available here.`;
  return `<div class="years" role="group" aria-label="Season">${yearsAvailable().map((y) =>
    `<button class="${y === ui.year ? 'on' : ''}" data-act="year" data-y="${y}" aria-pressed="${y === ui.year}">${y}</button>`).join('')}</div>
    <p class="muted small-text" style="margin:-4px 0 14px">${note}</p>`;
}

/* ------------------------------------------------------------ view: matches */
// Line-up in the order it was drawn (slot), so the pitch always looks exactly as it did when saved.
function rosterOf(id) {
  return state.mp.filter((r) => r.match_id === id)
    .sort((a, b) => (a.slot ?? 999) - (b.slot ?? 999) || (player(a.player_id)?.name || '').localeCompare(player(b.player_id)?.name || ''));
}

function viewMatches() {
  if (!state.matches.length) {
    return `<h1>Matches</h1><div class="card empty"><h2>No games yet</h2>
      <p>${isOrganiser() ? 'Pick who is playing and draw the first teams.' : 'Once an organiser draws the teams, the game will show up here.'}</p>
      ${isOrganiser() ? '<a class="btn" href="#/new">Draw teams</a>' : ''}</div>`;
  }
  const picker = yearPicker();
  const list = state.matches.filter((m) => matchYear(m) === ui.year);
  if (!list.length) {
    return `<h1>Matches</h1>${picker}<div class="card empty"><h2>No games in ${ui.year} yet</h2>
      <p>${isOrganiser() && ui.year === curYear() ? 'A fresh season. Draw the first teams of the year.' : 'Nothing was played this year.'}</p>
      ${isOrganiser() && ui.year === curYear() ? '<a class="btn" href="#/new">Draw teams</a>' : ''}</div>`;
  }
  return `<h1>Matches</h1>${picker}${list.map(matchCard).join('')}`;
}

function matchCard(m) {
  const d = dateObj(m.played_on);
  const roster = rosterOf(m.id);
  const mine = myPlayer() && roster.find((r) => r.player_id === myPlayer().id);
  const done = m.status === 'completed';
  const badges = [];
  if (!done) badges.push(isOrganiser() ? '<span class="badge todo">Enter final score</span>' : '<span class="badge">Teams drawn</span>');
  if (done && mine && !mine.goals_recorded) badges.push('<span class="badge todo">Add your goals</span>');
  if (done && mine && !m.motm_closed && !state.ballots.has(m.id)) badges.push('<span class="badge todo">Vote man of the match</span>');
  if (done && m.motm_closed) {
    const w = state.motm.filter((r) => r.match_id === m.id && r.is_winner).map((r) => player(r.player_id)?.name).filter(Boolean);
    if (w.length) badges.push(`<span class="badge win">MOTM: ${esc(w.join(', '))}</span>`);
  }
  const mineTeam = mine?.team;
  const result = done ? (m.score_a === m.score_b ? 'Draw' : (m.score_a > m.score_b) === (mineTeam === 'A') ? (mineTeam ? 'You won' : '') : (mineTeam ? 'You lost' : '')) : '';
  return `<a class="card match" href="#/match/${m.id}">
    <div class="match-row">
      <div class="date-blk"><b>${d.getDate()}</b><span>${d.toLocaleDateString('en-GB', { month: 'short' })}</span></div>
      <div class="match-mid"><div class="fmt">${m.format}-a-side</div>
        <div class="sub">${d.toLocaleDateString('en-GB', { weekday: 'long' })}${result ? ' · ' + result : ''}</div></div>
      ${done ? (() => { const st = matchStyle(m); return `<div class="scoreline" aria-label="${esc(tName(st, 'A'))} ${m.score_a}, ${esc(tName(st, 'B'))} ${m.score_b}"><span class="chip-score tc-${st.A.colour}">${m.score_a}</span><span class="dash">–</span><span class="chip-score tc-${st.B.colour}">${m.score_b}</span></div>`; })() : ''}
    </div>
    ${badges.length ? `<div class="badges">${badges.join('')}</div>` : ''}
  </a>`;
}

/* ------------------------------------------------------------- the pitch */
// Formations, goalkeeper first (the single player at the back), then defence -> attack.
const FORMATIONS = { 5: [1, 2, 2], 6: [1, 3, 2], 7: [1, 3, 3], 8: [1, 3, 3, 1] };
function rowsFor(n) { return FORMATIONS[n] || (n > 1 ? [1, n - 1] : [1]); }

// First names for the pitch. If two players share a first name, add a last initial to both.
function shortNames(ids) {
  const first = ids.map((id) => firstName(player(id)?.name));
  const seen = {};
  first.forEach((n) => { const k = n.toLowerCase(); seen[k] = (seen[k] || 0) + 1; });
  const out = {};
  ids.forEach((id, i) => {
    const parts = String(player(id)?.name || '').trim().split(/\s+/);
    out[id] = seen[first[i].toLowerCase()] > 1 && parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : first[i];
  });
  return out;
}

// One football per goal; 1 or 2 goals show that many balls, 3+ show a single ball with "×n".
function ballsHTML(n) {
  if (!n || n < 1) return '';
  const inner = n <= 2 ? '⚽'.repeat(n) : `⚽<b>×${n}</b>`;
  return `<span class="gl" aria-label="${plural(n, 'goal')}">${inner}</span>`;
}

function pitchHTML(teamA, teamB, { animate = false, score = null, style = freshStyle(), goals = null } = {}) {
  const me = myPlayer()?.id;
  const label = shortNames([...teamA, ...teamB]);
  const half = (team, ids) => {
    // Fill the formation back-to-front (first player drawn = back row), then draw it facing the right way:
    // The first team defends the top goal, the second team the bottom goal.
    let k = 0;
    const lines = rowsFor(ids.length).map((count) => ids.slice(k, (k += count)));
    const shown = team === 'B' ? [...lines].reverse() : lines;
    const html = shown.map((line) => `<div class="row">${line.map((id) => {
      const p = player(id);
      const i = ids.indexOf(id) * 2 + (team === 'B' ? 1 : 0);
      return `<div class="tok ${team}${id === me ? ' me' : ''}" style="--i:${i}">${disc(p)}${goals ? ballsHTML(goals[id]) : ''}<span class="nm">${esc(label[id])}</span></div>`;
    }).join('')}</div>`).join('');
    return `<div class="half ${team} tc-${style[team].colour}"><span class="team-tag">${esc(tName(style, team))}</span>${html}</div>`;
  };
  return `<div class="pitch-wrap"><div class="pitch${animate ? ' animate' : ''}" role="img" aria-label="Teams: ${esc(teamA.map((i) => player(i)?.name).join(', '))} versus ${esc(teamB.map((i) => player(i)?.name).join(', '))}">
    <div class="lines"></div><div class="box top"></div><div class="box bot"></div>
    ${half('A', teamA)}${half('B', teamB)}
    ${score ? `<div class="mid-score"><span class="chip-score tc-${style.A.colour}">${score[0]}</span><span class="dash">–</span><span class="chip-score tc-${style.B.colour}">${score[1]}</span></div>` : ''}
  </div></div>`;
}

/* --------------------------------------------------------------- view: match */
async function viewMatch(id) {
  const m = state.matches.find((x) => x.id === id);
  if (!m) return `<a class="back" href="#/">← Matches</a><div class="card empty"><h2>Game not found</h2></div>`;
  const roster = rosterOf(id);
  const A = roster.filter((r) => r.team === 'A');
  const B = roster.filter((r) => r.team === 'B');
  const done = m.status === 'completed';
  const me = myPlayer();
  const mine = me && roster.find((r) => r.player_id === me.id);
  const org = isOrganiser();
  const admin = isAdmin();

  let progress = null;
  if (done && !m.motm_closed) {
    const { data } = await sb.rpc('motm_progress', { p_match: id });
    progress = data?.[0] || null;
  }

  const head = `<a class="back" href="#/">← Matches</a>
    <h1>${m.format}-a-side</h1><p class="muted" style="margin:-8px 0 4px">${esc(fmtLong(m.played_on))}</p>
    ${drawnBy(m) ? `<p class="muted small-text">Teams drawn by ${esc(drawnBy(m))}</p>` : ''}`;

  const st = matchStyle(m);
  const pitch = pitchHTML(A.map((r) => r.player_id), B.map((r) => r.player_id), {
    score: done ? [m.score_a, m.score_b] : null, style: st,
    goals: done ? Object.fromEntries(roster.filter((r) => r.goals_recorded && r.goals > 0).map((r) => [r.player_id, r.goals])) : null,
  });

  let scoreCard = '';
  if (org) {
    scoreCard = `<section class="card"><h2>${done ? 'Final score' : 'Enter the final score'}</h2>
      <div class="score-entry">
        <label class="tc-${st.A.colour}"><span class="lbl-name"><i class="tdot"></i>${esc(tName(st, 'A'))}</span><input class="num" id="sa" type="number" inputmode="numeric" min="0" max="99" value="${done ? m.score_a : ''}" placeholder="0"></label>
        <span class="dash">–</span>
        <label class="tc-${st.B.colour}"><span class="lbl-name"><i class="tdot"></i>${esc(tName(st, 'B'))}</span><input class="num" id="sb" type="number" inputmode="numeric" min="0" max="99" value="${done ? m.score_b : ''}" placeholder="0"></label>
      </div>
      <button class="btn block" data-act="save-score" data-m="${id}">${done ? 'Update score' : 'Save final score'}</button></section>`;
  } else if (!done) {
    scoreCard = `<section class="card"><p class="muted" style="margin:0">Teams are set. The organiser will add the final score after the game.</p></section>`;
  }

  let goalsCard = '';
  if (done) {
    const team = (t, rows, score) => {
      const logged = rows.filter((r) => r.goals_recorded).reduce((s, r) => s + r.goals, 0);
      return `<div class="sub-h tc-${st[t].colour}"><i class="tdot"></i>${esc(tName(st, t))}<small>${logged} of ${score} goals accounted for</small></div>
        <ul class="plist">${rows.map((r) => goalRow(r, m)).join('')}</ul>`;
    };
    goalsCard = `<section class="card"><h2>Goals</h2>
      <p class="muted small-text">${mine ? 'Add the goals you scored. Admins can fill in for anyone.' : 'Each player records their own goals.'}</p>
      ${team('A', A, m.score_a)}${team('B', B, m.score_b)}</section>`;
  }

  let motmCard = '';
  if (done) motmCard = motmSection(m, roster, mine, progress);
  const rulesCard = rulesSummary(m);
  let styleCard = '';
  if (org) { ui.style[m.id] ||= matchStyle(m); styleCard = teamStyleCard(m.id, ui.style[m.id], m.id); }
  const shareCard = shareSection(m);

  const del = admin ? `<p style="margin-top:20px"><button class="btn danger block" data-act="delete-match" data-m="${id}">Delete this game</button></p>` : '';
  return head + pitch + shareCard + rulesCard + scoreCard + goalsCard + motmCard + styleCard + del;
}

function drawnBy(m) {
  return state.profiles.find((p) => p.id === m.created_by)?.display_name || '';
}
const ruleText = (type, ids) => type === 'together' ? `${ids.map(pname).join(', ')} play together` : `${pname(ids[0])} and ${pname(ids[1])} play apart`;
function rulesSummary(m) {
  const r = m.draw_rules;
  if (!r || (!r.together?.length && !r.apart?.length)) return '';
  const items = [...(r.together || []).map((g) => ruleText('together', g)), ...(r.apart || []).map((g) => ruleText('apart', g))];
  return `<section class="card"><h2>Draw rules</h2><p class="muted small-text">These conditions were set before the random draw.</p>
    <ul class="rules">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>`;
}
function lineupUrl(m) { return location.origin + location.pathname + '#/match/' + m.id; }
function shareText(m) {
  const roster = rosterOf(m.id);
  const list = (t) => roster.filter((r) => r.team === t).map((r) => '• ' + pname(r.player_id)).join('\n');
  const day = dateObj(m.played_on).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  let t = `⚽ *${APP_NAME}* – ${day}\n${m.format}-a-side\n\n`;
  const st = matchStyle(m);
  if (m.status === 'completed') t += `Final score: ${tName(st, 'A')} ${m.score_a} – ${m.score_b} ${tName(st, 'B')}\n\n`;
  t += `${pal(st.A.colour).emoji} *${tName(st, 'A')}*\n${list('A')}\n\n${pal(st.B.colour).emoji} *${tName(st, 'B')}*\n${list('B')}\n\n${lineupUrl(m)}`;
  return t;
}

/* ------------------------------------------------- line-up picture (for WhatsApp) */
const IMG_COLOURS = {
  red: ['#c62828', '#ffffff'], orange: ['#c2410c', '#ffffff'], yellow: ['#f2c200', '#1a1a1a'], green: ['#1b8a3a', '#ffffff'],
  blue: ['#1f5fd6', '#ffffff'], purple: ['#7b3fc4', '#ffffff'], black: ['#1a1a1a', '#ffffff'], white: ['#f4f4f4', '#1a1a1a'],
};
const loadImg = (url) => new Promise((ok) => {
  const i = new Image();
  const t = setTimeout(() => ok(null), 4000);
  i.crossOrigin = 'anonymous';
  i.onload = () => { clearTimeout(t); ok(i); };
  i.onerror = () => { clearTimeout(t); ok(null); };
  i.src = url;
});

// Draws the line-up picture. `data` = { title, line2, line3, score:[a,b]|null, teams:[{name, colour, rows:[[{label, initials, photo(Image|null), goals}]]}, {…}] }
// Rows are listed back-to-front for each team (the first team defends the top goal).
function drawLineupImage(data) {
  const maxRows = Math.max(...data.teams.map((t) => t.rows.length));
  const W = 1080, HEAD = 250, PH = 2 * (365 + 205 * (maxRows - 1)) - 10, H = HEAD + PH + 70;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const FONT = '"Barlow Condensed", "Arial Narrow", system-ui, sans-serif';
  const BODY = 'Barlow, system-ui, -apple-system, "Segoe UI", sans-serif';
  const fit = (txt, max, size, weight, fam) => { // shrink text to fit a width
    let sz = size; x.font = `${weight} ${sz}px ${fam}`;
    while (x.measureText(txt).width > max && sz > 18) { sz -= 2; x.font = `${weight} ${sz}px ${fam}`; }
    return sz;
  };
  const pill = (cx, cy, txt, bg, fg, size) => {
    x.font = `700 ${size}px ${FONT}`; const w = x.measureText(txt).width + 44, h = size + 22;
    x.fillStyle = 'rgba(255,255,255,.9)'; x.beginPath(); x.roundRect(cx - w / 2 - 4, cy - h / 2 - 4, w + 8, h + 8, h); x.fill();
    x.fillStyle = bg; x.beginPath(); x.roundRect(cx - w / 2, cy - h / 2, w, h, h); x.fill();
    x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(txt, cx, cy + 2);
    return w;
  };

  // page + header
  x.fillStyle = '#edf1f4'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#2f7d4e'; x.fillRect(0, 0, W, HEAD);
  x.fillStyle = '#ffffff'; x.textAlign = 'center'; x.textBaseline = 'alphabetic';
  fit(data.title, W - 100, 92, 700, FONT); x.fillText(data.title, W / 2, 112);
  fit(data.line2, W - 100, 46, 600, BODY); x.fillText(data.line2, W / 2, 175);
  x.globalAlpha = .85; fit(data.line3 || '', W - 100, 38, 500, BODY); x.fillText(data.line3 || '', W / 2, 226); x.globalAlpha = 1;

  x.fillStyle = '#245f3b'; x.fillRect(0, HEAD - 6, W, 6);
  // pitch
  const py = HEAD, pm = 30;
  x.fillStyle = '#2f7d4e'; x.fillRect(0, py, W, PH + 70);
  for (let i = 0; i * 88 < PH + 70; i++) { x.fillStyle = i % 2 ? '#388a5a' : '#2f7d4e'; x.fillRect(0, py + i * 88, W, 88); }
  x.strokeStyle = 'rgba(255,255,255,.85)'; x.lineWidth = 5;
  const top = py + pm, bot = py + PH + 70 - pm, mid = (top + bot) / 2;
  x.strokeRect(pm, top, W - 2 * pm, bot - top);
  x.beginPath(); x.moveTo(pm, mid); x.lineTo(W - pm, mid); x.stroke();
  x.beginPath(); x.arc(W / 2, mid, 110, 0, Math.PI * 2); x.stroke();
  x.strokeRect(W / 2 - 200, top, 400, 120); x.strokeRect(W / 2 - 200, bot - 120, 400, 120);

  const halfH = (bot - top) / 2;
  data.teams.forEach((tm, ti) => {
    const [bg, fg] = IMG_COLOURS[tm.colour] || IMG_COLOURS.blue;
    const rows = ti === 1 ? [...tm.rows].reverse() : tm.rows;
    // keep rows clear of the goal end, the tag, and the halfway circle/score
    const first = ti === 0 ? top + 165 : mid + 205, last = ti === 0 ? mid - 205 : bot - 165;
    rows.forEach((row, ri) => {
      const cy = rows.length === 1 ? (first + last) / 2 : first + ((last - first) * ri) / (rows.length - 1);
      row.forEach((p, pi) => {
        const cx = (W * (pi + 0.5)) / row.length, r = 52;
        x.save(); x.shadowColor = 'rgba(0,0,0,.4)'; x.shadowBlur = 12; x.shadowOffsetY = 4;
        x.fillStyle = '#fff'; x.beginPath(); x.arc(cx, cy, r + 8, 0, Math.PI * 2); x.fill(); x.restore();
        x.fillStyle = bg; x.beginPath(); x.arc(cx, cy, r + 6, 0, Math.PI * 2); x.fill();
        x.save(); x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.clip();
        x.fillStyle = '#fff'; x.fillRect(cx - r, cy - r, 2 * r, 2 * r);
        if (p.photo) {
          const sd = Math.min(p.photo.width, p.photo.height);
          x.drawImage(p.photo, (p.photo.width - sd) / 2, (p.photo.height - sd) / 2, sd, sd, cx - r, cy - r, 2 * r, 2 * r);
        } else {
          x.fillStyle = '#14213d'; x.font = `700 44px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle';
          x.fillText(p.initials, cx, cy + 3);
        }
        x.restore();
        // name
        x.textAlign = 'center'; x.textBaseline = 'alphabetic';
        const sz = fit(p.label, Math.min(300, W / row.length - 20), 34, 600, BODY);
        x.save(); x.shadowColor = 'rgba(0,0,0,.75)'; x.shadowBlur = 6; x.shadowOffsetY = 2;
        x.fillStyle = '#fff'; x.font = `600 ${sz}px ${BODY}`; x.fillText(p.label, cx, cy + r + 42); x.restore();
        // goals: one ball each up to 2, then ball ×n
        if (p.goals > 0) {
          const txt = p.goals <= 2 ? '⚽'.repeat(p.goals) : `⚽ ×${p.goals}`;
          x.font = `34px ${BODY}`; const w = x.measureText(txt).width + 22;
          const bx = cx + r - 8, by = cy - r - 12;
          x.fillStyle = 'rgba(255,255,255,.96)'; x.beginPath(); x.roundRect(bx, by - 22, w, 44, 22); x.fill();
          x.fillStyle = '#14213d'; x.textAlign = 'left'; x.textBaseline = 'middle'; x.fillText(txt, bx + 11, by + 2);
        }
      });
    });
    // team tag
    const tagY = ti === 0 ? top + 52 : bot - 52;
    x.font = `700 40px ${FONT}`; const tw = Math.min(x.measureText(tm.name).width + 44, W - 140);
    x.fillStyle = 'rgba(255,255,255,.9)'; x.beginPath(); x.roundRect(60 - 4, tagY - 30 - 4, tw + 8, 68, 34); x.fill();
    x.fillStyle = bg; x.beginPath(); x.roundRect(60, tagY - 30, tw, 60, 30); x.fill();
    x.fillStyle = fg; x.textAlign = 'left'; x.textBaseline = 'middle';
    fit(tm.name, tw - 36, 40, 700, FONT); x.fillText(tm.name, 60 + 22, tagY + 2);
  });

  // score in the middle
  if (data.score) {
    const ca = IMG_COLOURS[data.teams[0].colour] || IMG_COLOURS.blue, cb = IMG_COLOURS[data.teams[1].colour] || IMG_COLOURS.blue;
    pill(W / 2 - 100, mid, String(data.score[0]), ca[0], ca[1], 64);
    pill(W / 2 + 100, mid, String(data.score[1]), cb[0], cb[1], 64);
    x.fillStyle = '#fff'; x.font = `700 60px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('–', W / 2, mid + 2);
  }
  return c;
}

async function buildLineupImage(m) {
  const roster = rosterOf(m.id);
  const st = matchStyle(m);
  const ids = roster.map((r) => r.player_id);
  const label = shortNames(ids);
  const done = m.status === 'completed';
  try { await document.fonts?.load(`700 40px "Barlow Condensed"`); await document.fonts?.load(`600 30px Barlow`); } catch { /* fall back to system fonts */ }
  const photos = {};
  await Promise.all(ids.map(async (id) => { const u = player(id)?.avatar_url; if (u) photos[id] = await loadImg(u); }));
  const make = (usePhotos) => {
    const team = (t) => {
      const mine = roster.filter((r) => r.team === t);
      let k = 0;
      const rows = rowsFor(mine.length).map((n) => mine.slice(k, (k += n)).map((r) => ({
        label: label[r.player_id], initials: initials(player(r.player_id)?.name),
        photo: usePhotos ? photos[r.player_id] || null : null,
        goals: done && r.goals_recorded ? r.goals : 0,
      })));
      return { name: tName(st, t), colour: st[t].colour, rows };
    };
    return drawLineupImage({
      title: APP_NAME,
      line2: dateObj(m.played_on).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
      line3: `${m.format}-a-side`,
      score: done ? [m.score_a, m.score_b] : null,
      teams: [team('A'), team('B')],
    });
  };
  const toBlob = (c) => new Promise((ok) => c.toBlob(ok, 'image/png'));
  let blob;
  try { blob = await toBlob(make(true)); } catch { blob = null; }   // a photo that blocks export: retry without photos
  if (!blob) blob = await toBlob(make(false));
  return blob;
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function shareCaption(m) {
  const day = dateObj(m.played_on).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const st = matchStyle(m);
  let t = `⚽ *${APP_NAME}* – ${day}\n${m.format}-a-side`;
  if (m.status === 'completed') t += `\nFinal score: ${tName(st, 'A')} ${m.score_a} – ${m.score_b} ${tName(st, 'B')}`;
  return `${t}\n\n${lineupUrl(m)}`;
}

function shareSection(m) {
  const done = m.status === 'completed';
  const mode = ui.shareMode === 'image' ? 'image' : 'text';
  return `<section class="card"><h2>${done ? 'Share the result' : 'Share the line-up'}</h2>
    <div class="seg two" style="margin:4px 0 12px">
      <button class="${mode === 'text' ? 'on' : ''}" data-act="share-mode" data-v="text" aria-pressed="${mode === 'text'}">Text list<small>names as a message</small></button>
      <button class="${mode === 'image' ? 'on' : ''}" data-act="share-mode" data-v="image" aria-pressed="${mode === 'image'}">Picture<small>the pitch with players</small></button>
    </div>
    ${mode === 'text' ? `<p class="muted small-text">Opens WhatsApp with the teams ready to send. You choose the chat.</p>
    <div class="btn-row">
      <a class="btn wa" href="https://wa.me/?text=${encodeURIComponent(shareText(m))}" target="_blank" rel="noopener">Share to WhatsApp</a>
      <button class="btn ghost" data-act="copy-lineup" data-m="${m.id}">Copy text</button>
    </div>` : `<p class="muted small-text">Makes a picture of the pitch. Choose WhatsApp (and the chat) from the share menu. The message starts with ${esc(APP_NAME)}, the date and the format.</p>
    <div class="btn-row">
      <button class="btn wa" data-act="share-image" data-m="${m.id}">Share picture</button>
      <button class="btn ghost" data-act="save-image" data-m="${m.id}">Save picture</button>
    </div>`}</section>`;
}

function teamGoalsRecorded(matchId, team, excludePlayerId = null) {
  return rosterOf(matchId)
    .filter((r) => r.team === team && r.player_id !== excludePlayerId && r.goals_recorded)
    .reduce((sum, r) => sum + (Number(r.goals) || 0), 0);
}

function goalRow(r, m) {
  const p = player(r.player_id);
  const me = myPlayer();
  const isMe = me && me.id === r.player_id;
  const canEdit = isOrganiser() || isMe;
  const teamScore = Number(r.team === 'A' ? m.score_a : m.score_b) || 0;
  const otherGoals = teamGoalsRecorded(m.id, r.team, r.player_id);
  const max = Math.max(0, teamScore - otherGoals);
  const right = canEdit
    ? `<input class="num" type="number" inputmode="numeric" min="0" max="${max}" value="${r.goals_recorded ? r.goals : ''}" placeholder="0" data-goals="${r.player_id}" aria-label="Goals scored by ${esc(p?.name)}">
       <button class="btn small" data-act="save-goals" data-m="${m.id}" data-pid="${r.player_id}">Save</button>`
    : `<span class="goalsval">${r.goals_recorded ? r.goals : '–'}</span>`;
  return `<li>${disc(p)}<div class="who">${esc(p?.name)}${isMe ? '<small>You</small>' : (!p?.profile_id ? '<small>Guest</small>' : '')}</div>${right}</li>`;
}

function motmSection(m, roster, mine, progress) {
  const admin = isOrganiser();
  let body = '';
  if (m.motm_closed) {
    const res = state.motm.filter((r) => r.match_id === m.id).sort((a, b) => b.votes - a.votes);
    const top = res[0]?.votes || 1;
    body = res.length
      ? `<ul class="plist">${res.map((r) => {
          const p = player(r.player_id);
          return `<li>${disc(p)}<div class="who">${esc(p?.name)}${r.is_winner ? '<small>Man of the match</small>' : ''}
            <div class="result-bar"><i style="width:${Math.round((r.votes / top) * 100)}%"></i></div></div>
            <span class="goalsval">${r.votes}</span></li>`;
        }).join('')}</ul>`
      : '<p class="muted">Voting closed with no votes.</p>';
    body = `<p class="muted small-text">Voting is closed. Votes are anonymous.</p>` + body;
    if (admin) body += `<button class="btn ghost block" style="margin-top:12px" data-act="toggle-vote" data-m="${m.id}" data-closed="0">Reopen voting</button>`;
  } else {
    const prog = progress ? `<p class="muted small-text">${progress.voted} of ${progress.eligible} players have voted. Results appear when everyone has voted or an organiser closes voting.</p>` : '';
    if (mine && state.ballots.has(m.id)) {
      body = `<p>Your vote is in. Nobody can see who you picked.</p>${prog}`;
    } else if (mine) {
      const others = roster.filter((r) => r.player_id !== mine.player_id);
      const pick = ui.choice[m.id];
      body = `<p class="muted small-text">Pick one player. Your vote is anonymous and can't be changed.</p>
        <div class="vote-list">${others.map((r) => {
          const p = player(r.player_id);
          return `<button data-act="pick" data-m="${m.id}" data-pid="${r.player_id}" aria-pressed="${pick === r.player_id}">${disc(p)}<span>${esc(p?.name)}</span></button>`;
        }).join('')}</div>
        <button class="btn block" data-act="cast-vote" data-m="${m.id}" ${pick ? '' : 'disabled'}>Cast vote</button>${prog}`;
    } else {
      body = `<p class="muted">Only players who took part can vote.</p>${prog}`;
    }
    if (admin) body += `<button class="btn ghost block" style="margin-top:12px" data-act="toggle-vote" data-m="${m.id}" data-closed="1">Close voting and reveal</button>`;
  }
  return `<section class="card"><h2>Man of the match</h2>${body}</section>`;
}

/* ------------------------------------------------------------ view: new game */
// Name + colour pickers for the two teams. ctx = 'draft' (new game) or a match id (editing a saved game).
function teamStyleCard(ctx, st, matchId = null) {
  const row = (t, title) => `<div class="team-style tc-${st[t].colour}">
      <div class="ts-head"><i class="tdot"></i><label for="tn-${ctx}-${t}">${title}</label></div>
      <input type="text" id="tn-${ctx}-${t}" maxlength="24" autocomplete="off" placeholder="${esc(pal(st[t].colour).label)}" value="${esc(st[t].name)}" data-teamname="${t}" data-ctx="${ctx}">
      <div class="swatches" role="group" aria-label="Colour for ${title}">${Object.entries(PALETTE).map(([k, p]) =>
        `<button type="button" class="sw tc-${k}" data-act="team-colour" data-ctx="${ctx}" data-team="${t}" data-c="${k}" aria-label="${p.label}" aria-pressed="${st[t].colour === k}"><span aria-hidden="true">✓</span></button>`).join('')}</div>
    </div>`;
  return `<section class="card"><h2>Team names &amp; colours</h2>
    <p class="muted small-text">Just for fun. Leave a name blank to use the colour. Names and colours never affect scores or stats.</p>
    ${row('A', 'Team 1 (top of the pitch)')}${row('B', 'Team 2 (bottom)')}
    ${matchId ? `<button class="btn block" style="margin-top:12px" data-act="save-team-style" data-m="${matchId}">Save names &amp; colours</button>` : ''}
  </section>`;
}

function viewNew() {
  const d = ui.draft;
  const need = d.format * 2;
  const active = state.players.filter((p) => p.active);
  const count = d.selected.size;
  const diff = need - count;
  const hint = diff > 0 ? `Pick ${plural(diff, 'more player')}.` : diff < 0 ? `Too many: remove ${plural(-diff, 'player')}.` : 'Ready to draw.';
  const teams = d.teams ? pitchHTML(d.teams.A, d.teams.B, { animate: d.animate, style: ui.style.draft }) : '';
  const picked = state.players.filter((p) => d.selected.has(p.id));
  const rules = [...d.rules.together.map((g, i) => ['together', i, g]), ...d.rules.apart.map((g, i) => ['apart', i, g])];
  const pickOk = d.ruleType === 'together' ? d.rulePick.size >= 2 : d.rulePick.size === 2;
  const rulesCard = count >= 2 ? `<section class="card"><h2>Draw rules</h2>
    <p class="muted small-text">Optional. Keep a guest with whoever invited them, or split two players who'd be too strong together. The rest is still random.</p>
    ${rules.length ? `<ul class="rules">${rules.map(([t, i, g]) => `<li><span>${esc(ruleText(t, g))}</span><button class="btn ghost small" data-act="remove-rule" data-type="${t}" data-i="${i}" aria-label="Remove rule: ${esc(ruleText(t, g))}">Remove</button></li>`).join('')}</ul>` : ''}
    <div class="seg two" style="margin:14px 0 10px">
      <button class="${d.ruleType === 'together' ? 'on' : ''}" data-act="rule-type" data-v="together" aria-pressed="${d.ruleType === 'together'}">Play together<small>same team</small></button>
      <button class="${d.ruleType === 'apart' ? 'on' : ''}" data-act="rule-type" data-v="apart" aria-pressed="${d.ruleType === 'apart'}">Play apart<small>opposite teams</small></button>
    </div>
    <p class="muted small-text" id="rule-hint" style="margin-bottom:8px">${d.ruleType === 'together' ? `Tap two or more players${d.rulePick.size ? ` (${d.rulePick.size} picked)` : ''}.` : `Tap exactly two players${d.rulePick.size ? ` (${d.rulePick.size} picked)` : ''}.`}</p>
    <div class="chips">${picked.map((p) => `<label class="chip"><input type="checkbox" data-rulepick="${p.id}" ${d.rulePick.has(p.id) ? 'checked' : ''}><span>${disc(p)}${esc(p.name)}</span></label>`).join('')}</div>
    <button class="btn ghost block" style="margin-top:12px" data-act="add-rule" ${pickOk ? '' : 'disabled'}>Add rule</button>
  </section>` : '';
  return `<h1>New game</h1>
  <section class="card">
    <label class="field"><span>Date</span><input type="date" id="draft-date" value="${esc(d.date)}"></label>
    <div class="field"><span class="lbl">Format</span><div class="seg">
      ${[5, 6, 7, 8].map((n) => `<button class="${n === d.format ? 'on' : ''}" data-act="fmt" data-v="${n}" aria-pressed="${n === d.format}">${n}-a-side<small>${n * 2} players</small></button>`).join('')}
    </div></div>
  </section>
  <section class="card">
    <div class="rowhead"><h2>Who's playing?</h2><span class="count ${count === need ? 'ok' : count > need ? 'over' : ''}" aria-live="polite">${count} of ${need}</span></div>
    ${active.length ? `<div class="chips">${active.map((p) => `<label class="chip"><input type="checkbox" data-pick="${p.id}" ${d.selected.has(p.id) ? 'checked' : ''}><span>${disc(p)}${esc(p.name)}</span></label>`).join('')}</div>`
      : '<p class="muted">No active players yet. Approve friends in Admin, or add a guest below.</p>'}
    <p class="muted small-text" id="pick-hint" style="margin:12px 0 0">${hint}</p>
    <div class="inline-add"><input type="text" id="new-guest" maxlength="40" placeholder="Guest's name" autocomplete="off" aria-label="Guest's name"><button class="btn ghost" data-act="add-guest-inline">Add guest</button></div>
  </section>
  <div id="rules-wrap">${rulesCard}</div>
  ${teamStyleCard('draft', ui.style.draft)}
  <div id="draw-wrap">${d.teams ? '' : `<button class="btn block" data-act="draw" ${count === need ? '' : 'disabled'}>Draw teams</button>`}
  ${d.teams ? `<div id="drawn" style="margin-top:6px">${teams}
    <div class="btn-row"><button class="btn ghost" data-act="draw">Shuffle again</button><button class="btn" data-act="save-match">Save game</button></div>
    <p class="muted small-text" style="text-align:center;margin-top:12px">Not happy? Shuffle again as many times as you like. Nothing is recorded until you tap Save game. Your draw rules stay in place.<br>The player at the back is just the first one drawn, so swap keepers between yourselves if needed.</p></div>` : ''}</div>`;
}

/* --------------------------------------------------------------- view: stats */
const COLS = [
  ['name', 'Player', 'Player'], ['games', 'GP', 'Games played'], ['wins', 'W', 'Wins'], ['draws', 'D', 'Draws'], ['losses', 'L', 'Losses'],
  ['goals_for', 'GF', 'Team goals for'], ['goals_against', 'GA', 'Team goals against'],
  ['gfpg', 'GF/g', 'Team goals for per game'], ['gapg', 'GA/g', 'Team goals against per game'],
  ['personal_goals', 'Goals', 'Your own goals'], ['gpg', 'Goals/g', 'Your own goals per game'], ['motm', 'MOTM', 'Man of the match awards'],
];
function viewStats() {
  const picker = yearPicker();
  const y = ui.year;
  const base = state.stats.filter((r) => r.season === y);
  if (!base.length) {
    return `<h1>Stats</h1>${picker}<div class="card empty"><h2>No results in ${y} yet</h2>
      <p>${y === curYear() ? `Stats appear once the first game of ${y} has a final score.` : 'No completed games were recorded this year.'}</p></div>`;
  }
  // this season only: players who haven't played yet this year show as zeros
  const have = new Set(base.map((r) => r.player_id));
  const zero = (p) => ({ player_id: p.id, name: p.name, avatar_url: p.avatar_url, active: true, season: y, games: 0, goals_for: 0, goals_against: 0, wins: 0, draws: 0, losses: 0, personal_goals: 0, motm: 0 });
  const extra = y === curYear() ? state.players.filter((p) => p.active && !have.has(p.id)).map(zero) : [];
  const rows = [...base, ...extra].map((s) => ({
    ...s,
    gfpg: s.games ? s.goals_for / s.games : 0,
    gapg: s.games ? s.goals_against / s.games : 0,
    gpg: s.games ? s.personal_goals / s.games : 0,
  }));
  const { key, dir } = ui.sort;
  rows.sort((a, b) => key === 'name' ? a.name.localeCompare(b.name) * -dir : (b[key] - a[key]) * -dir || b.wins - a.wins || a.name.localeCompare(b.name));
  const avg = (v) => v.toFixed(1);
  return `<h1>Stats</h1>${picker}<div class="card"><div class="tablewrap"><table class="stats">
    <thead><tr>${COLS.map(([k, l, full]) => `<th scope="col"><button data-act="sort" data-k="${k}" aria-pressed="${k === key}" title="${full}" aria-label="Sort by ${full}">${l}</button></th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <td><div class="nm-cell">${disc(r)}<span>${esc(r.name)}</span></div></td>
      <td>${r.games}</td><td>${r.wins}</td><td>${r.draws}</td><td>${r.losses}</td>
      <td>${r.goals_for}</td><td>${r.goals_against}</td><td>${avg(r.gfpg)}</td><td>${avg(r.gapg)}</td>
      <td class="k">${r.personal_goals}</td><td>${avg(r.gpg)}</td><td class="k">${r.motm}</td></tr>`).join('')}</tbody>
  </table></div>
  <p class="legend"><b>GF / GA</b> are goals your team scored and conceded in the games you played. <b>Goals</b> are the ones you scored yourself. Tap a heading to sort.</p></div>`;
}

/* ---------------------------------------------------------------- view: me */
function viewMe() {
  const p = state.profile;
  return `<h1>Your profile</h1>
  <section class="card photo-card">
    <div class="photo-row">${disc({ name: p.display_name, avatar_url: p.avatar_url })}
      <div><b>Your photo</b><p class="muted small-text" style="margin:2px 0 8px">Shown in a small circle on the pitch and in the stats. It's shrunk automatically.</p>
        <div class="btn-row" style="margin:0"><label class="btn small" for="photo-file">${p.avatar_url ? 'Change photo' : 'Add photo'}</label>
        ${p.avatar_url ? '<button class="btn ghost small" data-act="photo-remove">Remove</button>' : ''}</div>
        <input type="file" id="photo-file" accept="image/*" hidden></div></div>
  </section>
  <section class="card"><form data-form="rename">
    <label class="field"><span>Your name</span><input type="text" id="my-name" maxlength="40" value="${esc(p.display_name)}" autocomplete="name" required></label>
    <button class="btn block" type="submit">Save name</button>
    <p class="muted small-text" style="margin:10px 0 0">Shown on the pitch and in the stats. Changing it updates your past games too.</p>
  </form></section>
  <section class="card"><p style="margin:0 0 12px">Signed in as <b>${esc(p.email || '@' + p.github_username)}</b></p>
    <button class="btn ghost block" data-act="signout">Sign out</button></section>`;
}

function inviteLink(token) {
  return `${location.origin}${location.pathname}?invite=${token}`;
}
function invitePanel() {
  const iv = ui.invite;
  if (!iv) return '';
  const g = { name: iv.name };
  const msg = `Hi ${g.name}! You're invited to join ${APP_NAME}. Open this link and sign in with your email, and your games and stats will be waiting: ${iv.url}`;
  return `<div class="merge-panel"><h3>Invite link for ${esc(g.name)}</h3>
    <p class="small-text">Send this to ${esc(g.name)} only. It works once, for 14 days. When they open it and sign in with their email they're approved straight away${iv.isGuest ? ` and ${esc(g.name)}'s games, goals and awards move onto their login` : ''}.</p>
    <input type="text" readonly id="invite-url" value="${esc(iv.url)}" aria-label="Invite link" onfocus="this.select()">
    <div class="btn-row"><button class="btn" data-act="invite-copy">Copy link</button>
    <a class="btn wa" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">Send on WhatsApp</a>
    <button class="btn ghost" data-act="invite-close">Done</button></div></div>`;
}

function mergePanel() {
  const g = ui.merge && player(ui.merge);
  if (!g) { ui.merge = null; return ''; }
  const opts = state.players.filter((p) => p.id !== g.id)
    .sort((a, b) => (!!b.profile_id - !!a.profile_id) || a.name.localeCompare(b.name));
  return `<div class="merge-panel"><h3>Merge ${esc(g.name)} into…</h3>
    <p class="small-text">All of ${esc(g.name)}'s games, goals and man of the match awards move to the player you choose, and ${esc(g.name)} is removed. The chosen player keeps their own name. <b>This can't be undone.</b></p>
    <p class="muted small-text">The new member must have signed in and been approved first, so they appear in this list.</p>
    <label class="field"><span>Merge into</span><select id="merge-into"><option value="">Choose a player…</option>
      ${opts.map((p) => `<option value="${p.id}">${esc(p.name)}${p.profile_id ? '' : ' (guest)'}</option>`).join('')}</select></label>
    <div class="btn-row"><button class="btn" data-act="merge-confirm">Merge players</button><button class="btn ghost" data-act="merge-cancel">Cancel</button></div></div>`;
}

/* --------------------------------------------------------------- view: admin */
function viewAdmin() {
  const me = state.session.user.id;
  const pending = state.profiles.filter((p) => !p.is_approved);
  const members = state.profiles.filter((p) => p.is_approved);
  const pName = (p) => p.display_name || p.github_username || p.email;
  const handle = (p) => (p.github_username ? '@' + p.github_username : p.email || '');
  return `<h1>Admin</h1>
  <section class="card"><h2>Waiting for approval</h2>
    ${pending.length ? `<ul class="plist">${pending.map((p) => `<li>${disc({ name: pName(p), avatar_url: p.avatar_url })}<div class="who">${esc(pName(p))}<small>${esc(handle(p))}</small></div>
      <button class="btn small" data-act="approve" data-id="${p.id}">Approve</button></li>`).join('')}</ul>`
      : '<p class="muted" style="margin:0">Nobody is waiting. Friends who sign in with GitHub will appear here.</p>'}
  </section>
  <section class="card"><h2>Invite someone new</h2>
    <p class="muted small-text">Makes a one-time link that skips the approval step. Send it only to the person it's for.</p>
    <div class="inline-add"><input type="text" id="invite-new-name" maxlength="40" placeholder="Their name" autocomplete="off" aria-label="Their name"><button class="btn" data-act="invite-new">Create link</button></div>
    ${ui.invite && !ui.invite.isGuest ? invitePanel() : ''}
  </section>
  <section class="card"><h2>Members</h2>
    <p class="muted small-text">Organisers can draw teams, enter scores and add guests. Admins can also approve people, manage members and delete games.</p>
    <ul class="plist">
    ${members.map((p) => `<li class="wrap">${disc({ name: pName(p), avatar_url: p.avatar_url })}<div class="who">${esc(pName(p))}<small>${esc(handle(p))}${p.is_admin ? ' · admin' : p.can_organise ? ' · can draw teams' : ''}${p.id === me ? ' · you' : ''}</small></div>
      ${p.id === me ? '' : `<div class="acts">
        ${p.is_admin ? '' : `<button class="btn ghost small" data-act="toggle-organiser" data-id="${p.id}" data-v="${p.can_organise ? 0 : 1}">${p.can_organise ? 'Stop drawing teams' : 'Let them draw teams'}</button>`}
        <button class="btn ghost small" data-act="toggle-admin" data-id="${p.id}" data-v="${p.is_admin ? 0 : 1}">${p.is_admin ? 'Remove admin' : 'Make admin'}</button>
        <button class="btn danger small" data-act="revoke" data-id="${p.id}">Remove</button></div>`}</li>`).join('')}
  </ul></section>
  <section class="card"><h2>Players</h2>
    <p class="muted small-text">Inactive players don't appear when picking a game but keep their stats. If a guest joins the group, use <b>Merge</b> to move their history onto their new login.</p>
    ${mergePanel()}${ui.invite && ui.invite.isGuest ? invitePanel() : ''}
    <ul class="plist">${state.players.map((p) => `<li class="wrap">${disc(p)}<div class="who">${esc(p.name)}${p.profile_id ? '' : '<small>Guest</small>'}</div>
      <div class="acts"><button class="btn ghost small" data-act="toggle-active" data-id="${p.id}" data-v="${p.active ? 0 : 1}">${p.active ? 'Set inactive' : 'Set active'}</button>
      ${p.profile_id ? '' : `<button class="btn ghost small" data-act="invite-link" data-id="${p.id}">Invite link</button><button class="btn ghost small" data-act="merge-start" data-id="${p.id}">Merge…</button>`}</div></li>`).join('')}</ul>
    <div style="margin-top:14px"><label class="field"><span>Add a guest player</span><input type="text" id="guest-name" maxlength="40" placeholder="Name" autocomplete="off"></label>
    <button class="btn block" data-act="add-guest">Add player</button>
    <p class="muted small-text" style="margin:8px 0 0">Guests can be picked for teams and you can enter their goals, but they can't vote.</p></div>
  </section>
  <section class="card"><h2>Back up your data</h2>
    <p class="muted small-text">Downloads every game, line-up, score and goal tally as a file to keep. (Individual man of the match votes are never included.)</p>
    <button class="btn ghost block" data-act="backup">Download backup</button>
  </section>`;
}

/* ------------------------------------------------------------------ actions */
const num = (id) => { const v = document.getElementById(id)?.value; return v === '' || v == null ? null : parseInt(v, 10); };

const actions = {
  async 'login-github'(el) {
    await busy(el, async () => {
      const { error } = await sb.auth.signInWithOAuth({ provider: 'github', options: { redirectTo: location.origin + location.pathname } });
      if (error) throw error;
    });
  },
  reload() { location.reload(); },
  'other-email'() { ui.loginEmail = null; showLogin(); },
  async 'signout-now'() { await sb.auth.signOut(); },
  async signout() { if (confirm('Sign out of ' + APP_NAME + '?')) await sb.auth.signOut(); },

  fmt(el) { ui.draft.format = +el.dataset.v; ui.draft.teams = null; route(true); },
  draw() {
    const d = ui.draft;
    try {
      d.teams = drawTeams([...d.selected], d.format, d.rules, pname);
    } catch (e) { return toast(errMsg(e), true); }
    d.animate = true;
    route(true).then(() => document.getElementById('drawn')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  },
  'rule-type'(el) { ui.draft.ruleType = el.dataset.v; ui.draft.rulePick = new Set(); route(true); },
  'add-rule'() {
    const d = ui.draft;
    const ids = [...d.rulePick].filter((id) => d.selected.has(id));
    const next = { together: [...d.rules.together], apart: [...d.rules.apart] };
    if (d.ruleType === 'together') {
      if (ids.length < 2) return;
      if (ids.length > d.format) return toast(`A team only has ${d.format} players`, true);
      next.together.push(ids);
    } else {
      if (ids.length !== 2) return toast('Pick exactly two players to keep apart', true);
      next.apart.push(ids);
    }
    try {
      validateRules([...d.selected], next, pname);
      if (d.selected.size === d.format * 2) drawTeams([...d.selected], d.format, next, pname); // dry run: can these rules be met?
    } catch (e) { return toast(errMsg(e), true); }
    d.rules = next; d.rulePick = new Set(); d.teams = null;
    route(true);
  },
  'remove-rule'(el) {
    const d = ui.draft;
    d.rules[el.dataset.type].splice(+el.dataset.i, 1);
    d.teams = null;
    route(true);
  },
  async 'add-guest-inline'(el) {
    const name = document.getElementById('new-guest').value.trim();
    if (!name) return toast('Enter the guest\'s name', true);
    await busy(el, async () => {
      const { data, error } = await sb.from('players').insert({ name }).select().single();
      if (error) throw error;
      await loadAll();
      ui.draft.selected.add(data.id);
      ui.draft.teams = null;
      toast(`${name} added and selected`);
      await route(true);
    });
  },
  async 'save-match'(el) {
    await busy(el, async () => {
      const d = ui.draft;
      const hasRules = d.rules.together.length || d.rules.apart.length;
      const { data: id, error } = await sb.rpc('create_match', {
        p_date: d.date, p_format: d.format, p_team_a: d.teams.A, p_team_b: d.teams.B, p_rules: hasRules ? d.rules : null,
        p_name_a: ui.style.draft.A.name.trim() || null, p_colour_a: ui.style.draft.A.colour,
        p_name_b: ui.style.draft.B.name.trim() || null, p_colour_b: ui.style.draft.B.colour,
      });
      if (error) throw error;
      ui.draft = { date: today(), format: d.format, selected: new Set(), teams: null, animate: false, rules: { together: [], apart: [] }, ruleType: 'together', rulePick: new Set() };
      ui.style.draft = freshStyle();
      await loadAll();
      toast('Game saved');
      location.hash = '#/match/' + id;
    });
  },
  'share-mode'(el) { ui.shareMode = el.dataset.v; route(true); },
  async 'share-image'(el) {
    const m = state.matches.find((x) => x.id === el.dataset.m);
    if (!m) return;
    await busy(el, async () => {
      const blob = await buildLineupImage(m);
      const file = new File([blob], `${APP_NAME.replace(/\s+/g, '-')}-${m.played_on}.png`, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], text: shareCaption(m) }); }
        catch (e) { if (e?.name !== 'AbortError') throw e; }   // closing the share menu is fine
      } else {
        downloadBlob(blob, file.name);
        toast('Picture saved. Attach it in WhatsApp');
      }
    });
  },
  async 'save-image'(el) {
    const m = state.matches.find((x) => x.id === el.dataset.m);
    if (!m) return;
    await busy(el, async () => {
      const blob = await buildLineupImage(m);
      downloadBlob(blob, `${APP_NAME.replace(/\s+/g, '-')}-${m.played_on}.png`);
      toast('Picture saved');
    });
  },
  async 'copy-lineup'(el) {
    const m = state.matches.find((x) => x.id === el.dataset.m);
    if (!m) return;
    const text = shareText(m);
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } finally { ta.remove(); }
    }
    toast('Copied. Paste it into your chat');
  },
  year(el) { ui.year = +el.dataset.y; route(true); },
  async 'invite-link'(el) {
    await busy(el, async () => {
      const { data, error } = await sb.rpc('create_invite', { p_player: el.dataset.id });
      if (error) throw error;
      ui.invite = { id: el.dataset.id, name: player(el.dataset.id)?.name || 'there', isGuest: true, url: inviteLink(data) };
      ui.merge = null;
      route(true);
    });
  },
  async 'invite-copy'(el) {
    const url = ui.invite?.url;
    if (!url) return;
    try { await navigator.clipboard.writeText(url); toast('Link copied'); }
    catch { const i = document.getElementById('invite-url'); i?.select(); toast('Press and hold the link to copy it'); }
  },
  async 'invite-new'(el) {
    const name = document.getElementById('invite-new-name').value.trim();
    if (!name) return toast('Enter their name first', true);
    await busy(el, async () => {
      const { data, error } = await sb.rpc('create_invite_new', { p_name: name });
      if (error) throw error;
      ui.invite = { name, isGuest: false, url: inviteLink(data) };
      ui.merge = null;
      route(true);
    });
  },
  'invite-close'() { ui.invite = null; route(true); },
  'merge-start'(el) { ui.merge = el.dataset.id; ui.invite = null; route(true); },
  'merge-cancel'() { ui.merge = null; route(true); },
  async 'merge-confirm'(el) {
    const into = document.getElementById('merge-into')?.value;
    const from = ui.merge;
    if (!into) return toast('Choose who to merge into', true);
    if (!confirm(`Merge ${pname(from)} into ${pname(into)}? This can't be undone.`)) return;
    await busy(el, async () => {
      const { error } = await sb.rpc('merge_players', { p_from: from, p_into: into });
      if (error) throw error;
      ui.merge = null;
      toast('Players merged');
      await refresh();
    });
  },
  'team-colour'(el) {
    const st = ui.style[el.dataset.ctx];
    if (!st) return;
    const t = el.dataset.team, o = t === 'A' ? 'B' : 'A', c = el.dataset.c;
    if (st[o].colour === c) st[o].colour = st[t].colour; // picking the other team's colour swaps them
    st[t].colour = c;
    route(true);
  },
  async 'save-team-style'(el) {
    const id = el.dataset.m, st = ui.style[id];
    if (!st) return;
    await busy(el, async () => {
      const { error } = await sb.from('matches').update({
        team_a_name: st.A.name.trim() || null, team_a_colour: st.A.colour,
        team_b_name: st.B.name.trim() || null, team_b_colour: st.B.colour,
      }).eq('id', id);
      if (error) throw error;
      delete ui.style[id];
      toast('Team names and colours saved');
      await refresh();
    });
  },
  async 'toggle-organiser'(el) { await adminUpdate(el, 'profiles', { can_organise: el.dataset.v === '1' }, 'Updated'); },
  backup() {
    const data = {
      exported_at: new Date().toISOString(), app: APP_NAME,
      matches: [...state.matches].reverse().map((m) => ({
        date: m.played_on, format: m.format, status: m.status,
        team_a: matchStyle(m).A.name || pal(matchStyle(m).A.colour).label, team_b: matchStyle(m).B.name || pal(matchStyle(m).B.colour).label, score_team_a: m.score_a, score_team_b: m.score_b, drawn_by: drawnBy(m) || null,
        draw_rules: m.draw_rules ? [...(m.draw_rules.together || []).map((g) => ruleText('together', g)), ...(m.draw_rules.apart || []).map((g) => ruleText('apart', g))] : [],
        man_of_the_match: state.motm.filter((r) => r.match_id === m.id && r.is_winner).map((r) => pname(r.player_id)),
        lineup: rosterOf(m.id).map((r) => ({ player: pname(r.player_id), team: tName(matchStyle(m), r.team), goals: r.goals_recorded ? r.goals : null })),
      })),
      player_stats: state.stats.map(({ season, name, games, wins, draws, losses, goals_for, goals_against, personal_goals, motm }) => ({ season, name, games, wins, draws, losses, goals_for, goals_against, personal_goals, motm })),
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `real-socialdads-backup-${today()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Backup downloaded');
  },
  async 'save-score'(el) {
    const a = num('sa'), b = num('sb');
    if (a == null || b == null || a < 0 || b < 0) return toast('Enter a score for both teams', true);
    await busy(el, async () => {
      const { error } = await sb.from('matches').update({ score_a: a, score_b: b, status: 'completed' }).eq('id', el.dataset.m);
      if (error) throw error;
      toast('Score saved');
      await refresh();
    });
  },
  async 'save-goals'(el) {
    const input = document.querySelector(`input[data-goals="${el.dataset.pid}"]`);
    const v = input?.value === '' ? 0 : parseInt(input.value, 10);
    if (Number.isNaN(v) || v < 0) return toast('Enter a number of goals', true);

    // On mobile, a focused number input can leave the virtual keyboard/touch
    // state in an awkward state when the whole match view is replaced. Blur it
    // before refreshing the data and DOM. The database remains the authority
    // for the collective team-goal limit.
    input?.blur();

    await busy(el, async () => {
      const { error } = await sb.rpc('set_goals', { p_match: el.dataset.m, p_player: el.dataset.pid, p_goals: v });
      if (error) throw error;
      toast('Goals saved');
      await refresh();
    });
  },
  async 'photo-remove'(el) {
    await busy(el, async () => {
      const { error } = await sb.rpc('set_my_avatar', { p_url: null });
      if (error) throw error;
      await sb.storage.from('avatars').remove([`${state.session.user.id}/avatar.jpg`]);
      const { data } = await sb.from('profiles').select('*').eq('id', state.session.user.id).single();
      if (data) state.profile = data;
      toast('Photo removed');
      renderShell();
      await refresh();
    });
  },
  pick(el) {
    const matchId = el.dataset.m;
    ui.choice[matchId] = el.dataset.pid;

    // Do not replace the whole match page just to show a vote selection.
    // Keeping the existing DOM is more reliable on mobile/touch browsers.
    const list = el.closest('.vote-list');
    list?.querySelectorAll('button[data-act="pick"]').forEach((button) => {
      const selected = button === el;
      button.setAttribute('aria-pressed', String(selected));
    });
    const cast = document.querySelector(`button[data-act="cast-vote"][data-m="${matchId}"]`);
    if (cast) cast.disabled = false;
  },
  async 'cast-vote'(el) {
    const pid = ui.choice[el.dataset.m];
    if (!pid) return;
    if (!confirm('Cast your vote for ' + (player(pid)?.name || 'this player') + '? You can\'t change it afterwards.')) return;
    await busy(el, async () => {
      const { error } = await sb.rpc('cast_motm', { p_match: el.dataset.m, p_nominee: pid });
      if (error) throw error;
      delete ui.choice[el.dataset.m];
      toast('Vote recorded');
      await refresh();
    });
  },
  async 'toggle-vote'(el) {
    const closed = el.dataset.closed === '1';
    if (closed && !confirm('Close voting and reveal the result?')) return;
    await busy(el, async () => {
      const { error } = await sb.from('matches').update({ motm_closed: closed }).eq('id', el.dataset.m);
      if (error) throw error;
      await refresh();
    });
  },
  async 'delete-match'(el) {
    if (!confirm('Delete this game and everything recorded for it? This can\'t be undone.')) return;
    await busy(el, async () => {
      const { error } = await sb.from('matches').delete().eq('id', el.dataset.m);
      if (error) throw error;
      await loadAll();
      toast('Game deleted');
      location.hash = '#/';
    });
  },
  sort(el) {
    const k = el.dataset.k;
    ui.sort = ui.sort.key === k ? { key: k, dir: -ui.sort.dir } : { key: k, dir: k === 'name' ? 1 : -1 };
    route(true);
  },

  async approve(el) { await adminUpdate(el, 'profiles', { is_approved: true }, 'Approved'); },
  async 'toggle-admin'(el) { await adminUpdate(el, 'profiles', { is_admin: el.dataset.v === '1' }, 'Updated'); },
  async revoke(el) {
    if (!confirm('Remove this person\'s access? Their past stats are kept.')) return;
    await adminUpdate(el, 'profiles', { is_approved: false, is_admin: false }, 'Access removed');
  },
  async 'toggle-active'(el) { await adminUpdate(el, 'players', { active: el.dataset.v === '1' }, 'Updated'); },
  async 'add-guest'(el) {
    const name = document.getElementById('guest-name').value.trim();
    if (!name) return toast('Enter a name', true);
    await busy(el, async () => {
      const { error } = await sb.from('players').insert({ name });
      if (error) throw error;
      toast('Player added');
      await refresh();
    });
  },
};

async function adminUpdate(el, table, patch, okMsg) {
  await busy(el, async () => {
    const { error } = await sb.from(table).update(patch).eq('id', el.dataset.id);
    if (error) throw error;
    toast(okMsg);
    await refresh();
  });
}

const forms = {
  async 'send-link'(f) {
    const email = f.querySelector('input[type=email]').value.trim();
    if (!email) return;
    await busy(f.querySelector('button[type=submit]'), async () => {
      const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname } });
      if (error) throw new Error(/rate limit/i.test(error.message) ? 'Too many emails sent recently. Wait a few minutes and try again.' : error.message);
      ui.loginEmail = email;
      showCheckEmail(email);
    });
  },
  async verify(f) {
    const token = f.querySelector('#login-code').value.replace(/\s/g, '');
    if (!token) return toast('Enter the code from the email', true);
    await busy(f.querySelector('button[type=submit]'), async () => {
      const { error } = await sb.auth.verifyOtp({ email: ui.loginEmail, token, type: 'email' });
      if (error) throw new Error('That code didn\'t work. Check it, or go back and request a new one.');
    });
  },
  async name(f) {
    const name = f.querySelector('#my-name').value.trim();
    if (!name) return toast('Enter your name', true);
    await busy(f.querySelector('button[type=submit]'), async () => {
      const { error } = await sb.rpc('set_my_name', { p_name: name });
      if (error) throw error;
      const { data: check, error: chkErr } = await sb.from('profiles').select('*').eq('id', state.session.user.id).maybeSingle();
      if (chkErr) throw chkErr;
      if (!check || !check.name_confirmed) throw new Error('Your name did not save. Please try again, and tell the admin if it keeps happening.');
      state.enteredFor = null;
      await enter(state.session);
    });
  },
  async rename(f) {
    const name = f.querySelector('#my-name').value.trim();
    if (!name) return toast('Enter your name', true);
    await busy(f.querySelector('button[type=submit]'), async () => {
      const { error } = await sb.rpc('set_my_name', { p_name: name });
      if (error) throw error;
      const { data } = await sb.from('profiles').select('*').eq('id', state.session.user.id).single();
      if (data) state.profile = data;
      toast('Name saved');
      renderShell();
      await refresh();
    });
  },
};
document.addEventListener('submit', (e) => {
  const f = e.target.closest?.('form[data-form]');
  if (!f) return;
  e.preventDefault();
  forms[f.dataset.form]?.(f);
});
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el && actions[el.dataset.act]) actions[el.dataset.act](el, e);
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (!t.dataset?.teamname) return;
  const st = ui.style[t.dataset.ctx];
  if (!st) return;
  st[t.dataset.teamname].name = t.value;
  if (t.dataset.ctx === 'draft') { // keep the pitch preview's name tag in step while typing
    document.querySelectorAll?.(`.half.${t.dataset.teamname} .team-tag`)?.forEach((el) => { el.textContent = tName(st, t.dataset.teamname); });
  }
});
// Update only the parts of the New game page that depend on the selection, so a tap never
// rebuilds the chips, wipes a typed guest name or drops keyboard focus.
function swapFromView(sels) {
  const tpl = document.createElement('template');
  tpl.innerHTML = viewNew();
  for (const sel of sels) {
    const a = document.querySelector(sel), b = tpl.content.querySelector(sel);
    if (a && b) a.replaceWith(b);
  }
}
// Shrink a chosen picture to a 160x160 centred square JPEG (about 6-12 KB).
async function shrinkPhoto(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { bmp = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = URL.createObjectURL(file); }); }
  const w = bmp.width, h = bmp.height, side = Math.min(w, h), SIZE = 160;
  const c = document.createElement('canvas'); c.width = c.height = SIZE;
  c.getContext('2d').drawImage(bmp, (w - side) / 2, (h - side) / 2, side, side, 0, 0, SIZE, SIZE);
  const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.82));
  if (!blob) throw new Error('Could not read that picture');
  return blob;
}
async function savePhoto(file) {
  const uid = state.session.user.id;
  try {
    toast('Saving photo…');
    const blob = await shrinkPhoto(file);
    const path = `${uid}/avatar.jpg`;
    const up = await sb.storage.from('avatars').upload(path, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' });
    if (up.error) throw up.error;
    const url = `${sb.storage.from('avatars').getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
    const { error } = await sb.rpc('set_my_avatar', { p_url: url });
    if (error) throw error;
    const { data } = await sb.from('profiles').select('*').eq('id', uid).single();
    if (data) state.profile = data;
    toast('Photo saved');
    renderShell();
    await refresh();
  } catch (err) {
    toast(/not found|function|bucket|policy/i.test(err.message || '') ? 'Photos need the one-off database update first (see README)' : (err.message || 'Could not save photo'), true);
  }
}
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'photo-file' && t.files?.[0]) { const f = t.files[0]; t.value = ''; savePhoto(f); return; }
  if (t.id === 'draft-date') ui.draft.date = t.value;
  if (t.dataset?.pick) {
    const d = ui.draft, id = t.dataset.pick;
    if (t.checked) d.selected.add(id);
    else {
      d.selected.delete(id);
      d.rulePick.delete(id);
      const before = d.rules.together.length + d.rules.apart.length;
      d.rules.together = d.rules.together.map((g) => g.filter((x) => x !== id)).filter((g) => g.length > 1);
      d.rules.apart = d.rules.apart.filter((g) => !g.includes(id));
      if (before !== d.rules.together.length + d.rules.apart.length) toast(`Removed rules involving ${pname(id)}`);
    }
    d.teams = null;
    if (!document.getElementById('draw-wrap')) route(true);
    else {
      const cnt = document.querySelector('.count'), need = d.format * 2;
      if (cnt) {
        cnt.textContent = `${d.selected.size} of ${need}`;
        cnt.className = `count ${d.selected.size === need ? 'ok' : d.selected.size > need ? 'over' : ''}`;
      }
      swapFromView(['#pick-hint', '#rules-wrap', '#draw-wrap']);
    }
  }
  if (t.dataset?.rulepick) {
    const set = ui.draft.rulePick;
    t.checked ? set.add(t.dataset.rulepick) : set.delete(t.dataset.rulepick);
    swapFromView(['#rule-hint', '[data-act="add-rule"]']);
  }
});

boot();
