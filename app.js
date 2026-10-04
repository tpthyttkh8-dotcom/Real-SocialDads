// Real SocialDads — weekly 5/6/7/8-a-side organiser.
// Plain ES modules, no build step. Data + GitHub login via Supabase.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY, APP_NAME, ENABLE_GITHUB } from './config.js';
import { drawTeams, validateRules } from './draw.js';

const TEAM = { A: 'Blue', B: 'Orange' };
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
  choice: {},
};
let routeToken = 0;
const linkError = /error_description=|error_code=/.test(location.hash);

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
    const { data: profile, error } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
    if (error) throw error;
    if (!profile) return showNoProfile();
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
    <p> Team Creation, final scores and play stats for our weekly game.</p>
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

/* ------------------------------------------------------------ view: matches */
function rosterOf(id) { return state.mp.filter((r) => r.match_id === id); }

function viewMatches() {
  const list = state.matches;
  if (!list.length) {
    return `<h1>Matches</h1><div class="card empty"><h2>No games yet</h2>
      <p>${isOrganiser() ? 'Pick who is playing and draw the first teams.' : 'Once an organiser draws the teams, the game will show up here.'}</p>
      ${isOrganiser() ? '<a class="btn" href="#/new">Draw teams</a>' : ''}</div>`;
  }
  return `<h1>Matches</h1>${list.map(matchCard).join('')}`;
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
      ${done ? `<div class="scoreline" aria-label="Blue ${m.score_a}, Orange ${m.score_b}"><span class="a">${m.score_a}</span><span class="dash">–</span><span class="b">${m.score_b}</span></div>` : ''}
    </div>
    ${badges.length ? `<div class="badges">${badges.join('')}</div>` : ''}
  </a>`;
}

/* ------------------------------------------------------------- the pitch */
function rowsFor(n) { return { 1: [1], 2: [1, 1], 3: [1, 2], 4: [2, 2], 5: [2, 2, 1], 6: [2, 2, 2], 7: [3, 2, 2], 8: [3, 3, 2] }[n] || [n]; }

function pitchHTML(teamA, teamB, { animate = false, score = null } = {}) {
  const me = myPlayer()?.id;
  const half = (team, ids) => {
    let rows = rowsFor(ids.length);
    if (team === 'B') rows = [...rows].reverse();
    let k = 0;
    const bodies = rows.map((count) => {
      const toks = [];
      for (let i = 0; i < count; i++) {
        // forwards line is always the row nearest the halfway line
        const idx = k++;
        toks.push(ids[idx]);
      }
      return toks;
    });
    // Place players so the draw order reads naturally: A fills top->bottom, B fills bottom->top
    let order = 0;
    const html = bodies.map((r) => `<div class="row">${r.map((id) => {
      const p = player(id);
      const i = order++ * 2 + (team === 'B' ? 1 : 0);
      return `<div class="tok ${team}${id === me ? ' me' : ''}" style="--i:${i}">${disc(p)}<span class="nm">${esc(firstName(p?.name))}</span></div>`;
    }).join('')}</div>`).join('');
    return `<div class="half ${team}"><span class="team-tag">${TEAM[team]}</span>${html}</div>`;
  };
  return `<div class="pitch-wrap"><div class="pitch${animate ? ' animate' : ''}" role="img" aria-label="Teams: ${esc(teamA.map((i) => player(i)?.name).join(', '))} versus ${esc(teamB.map((i) => player(i)?.name).join(', '))}">
    <div class="lines"></div><div class="box top"></div><div class="box bot"></div>
    ${half('A', teamA)}${half('B', teamB)}
    ${score ? `<div class="mid-score"><span class="a">${score[0]}</span> – <span class="b">${score[1]}</span></div>` : ''}
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

  const pitch = pitchHTML(A.map((r) => r.player_id), B.map((r) => r.player_id), { score: done ? [m.score_a, m.score_b] : null });

  let scoreCard = '';
  if (org) {
    scoreCard = `<section class="card"><h2>${done ? 'Final score' : 'Enter the final score'}</h2>
      <div class="score-entry">
        <label class="a">Blue<input class="num" id="sa" type="number" inputmode="numeric" min="0" max="99" value="${done ? m.score_a : ''}" placeholder="0"></label>
        <span class="dash">–</span>
        <label class="b">Orange<input class="num" id="sb" type="number" inputmode="numeric" min="0" max="99" value="${done ? m.score_b : ''}" placeholder="0"></label>
      </div>
      <button class="btn block" data-act="save-score" data-m="${id}">${done ? 'Update score' : 'Save final score'}</button></section>`;
  } else if (!done) {
    scoreCard = `<section class="card"><p class="muted" style="margin:0">Teams are set. The organiser will add the final score after the game.</p></section>`;
  }

  let goalsCard = '';
  if (done) {
    const team = (t, rows, score) => {
      const logged = rows.filter((r) => r.goals_recorded).reduce((s, r) => s + r.goals, 0);
      return `<div class="sub-h"><i class="${t}"></i>${TEAM[t]}<small>${logged} of ${score} goals accounted for</small></div>
        <ul class="plist">${rows.map((r) => goalRow(r, m)).join('')}</ul>`;
    };
    goalsCard = `<section class="card"><h2>Goals</h2>
      <p class="muted small-text">${mine ? 'Add the goals you scored. Admins can fill in for anyone.' : 'Each player records their own goals.'}</p>
      ${team('A', A, m.score_a)}${team('B', B, m.score_b)}</section>`;
  }

  let motmCard = '';
  if (done) motmCard = motmSection(m, roster, mine, progress);
  const rulesCard = rulesSummary(m);
  const shareCard = shareSection(m);

  const del = admin ? `<p style="margin-top:20px"><button class="btn danger block" data-act="delete-match" data-m="${id}">Delete this game</button></p>` : '';
  return head + pitch + shareCard + rulesCard + scoreCard + goalsCard + motmCard + del;
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
  if (m.status === 'completed') t += `Final score: Blue ${m.score_a} – ${m.score_b} Orange\n\n`;
  t += `🔵 *Blue*\n${list('A')}\n\n🟠 *Orange*\n${list('B')}\n\n${lineupUrl(m)}`;
  return t;
}
function shareSection(m) {
  const done = m.status === 'completed';
  return `<section class="card"><h2>${done ? 'Share the result' : 'Share the line-up'}</h2>
    <p class="muted small-text">Opens WhatsApp with the teams ready to send. You choose the chat.</p>
    <div class="btn-row">
      <a class="btn wa" href="https://wa.me/?text=${encodeURIComponent(shareText(m))}" target="_blank" rel="noopener">Share to WhatsApp</a>
      <button class="btn ghost" data-act="copy-lineup" data-m="${m.id}">Copy text</button>
    </div></section>`;
}

function goalRow(r, m) {
  const p = player(r.player_id);
  const me = myPlayer();
  const isMe = me && me.id === r.player_id;
  const canEdit = isOrganiser() || isMe;
  const max = r.team === 'A' ? m.score_a : m.score_b;
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
function viewNew() {
  const d = ui.draft;
  const need = d.format * 2;
  const active = state.players.filter((p) => p.active);
  const count = d.selected.size;
  const diff = need - count;
  const hint = diff > 0 ? `Pick ${plural(diff, 'more player')}.` : diff < 0 ? `Too many: remove ${plural(-diff, 'player')}.` : 'Ready to draw.';
  const teams = d.teams ? pitchHTML(d.teams.A, d.teams.B, { animate: d.animate }) : '';
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
    <p class="muted small-text" style="margin-bottom:8px">${d.ruleType === 'together' ? `Tap two or more players${d.rulePick.size ? ` (${d.rulePick.size} picked)` : ''}.` : `Tap exactly two players${d.rulePick.size ? ` (${d.rulePick.size} picked)` : ''}.`}</p>
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
    <p class="muted small-text" style="margin:12px 0 0">${hint}</p>
    <div class="inline-add"><input type="text" id="new-guest" maxlength="40" placeholder="Guest's name" autocomplete="off" aria-label="Guest's name"><button class="btn ghost" data-act="add-guest-inline">Add guest</button></div>
  </section>
  ${rulesCard}
  <button class="btn block" data-act="draw" ${count === need ? '' : 'disabled'}>${d.teams ? 'Shuffle again' : 'Draw teams'}</button>
  ${d.teams ? `<div id="drawn" style="margin-top:18px">${teams}
    <button class="btn block" data-act="save-match">Save game</button>
    <p class="muted small-text" style="text-align:center;margin-top:10px">Not happy? Shuffle again before saving. Once saved, the line-up is recorded for good.</p></div>` : ''}`;
}

/* --------------------------------------------------------------- view: stats */
const COLS = [
  ['name', 'Player', 'Player'], ['games', 'GP', 'Games played'], ['wins', 'W', 'Wins'], ['draws', 'D', 'Draws'], ['losses', 'L', 'Losses'],
  ['goals_for', 'GF', 'Team goals for'], ['goals_against', 'GA', 'Team goals against'],
  ['gfpg', 'GF/g', 'Team goals for per game'], ['gapg', 'GA/g', 'Team goals against per game'],
  ['personal_goals', 'Goals', 'Your own goals'], ['gpg', 'Goals/g', 'Your own goals per game'], ['motm', 'MOTM', 'Man of the match awards'],
];
function viewStats() {
  const rows = state.stats.filter((s) => s.games > 0 || s.active).map((s) => ({
    ...s,
    gfpg: s.games ? s.goals_for / s.games : 0,
    gapg: s.games ? s.goals_against / s.games : 0,
    gpg: s.games ? s.personal_goals / s.games : 0,
  }));
  if (!state.matches.some((m) => m.status === 'completed')) {
    return `<h1>Stats</h1><div class="card empty"><h2>No results yet</h2><p>Stats appear once the first game has a final score.</p></div>`;
  }
  const { key, dir } = ui.sort;
  rows.sort((a, b) => key === 'name' ? a.name.localeCompare(b.name) * -dir : (b[key] - a[key]) * -dir || b.wins - a.wins || a.name.localeCompare(b.name));
  const avg = (v) => v.toFixed(1);
  return `<h1>Stats</h1><div class="card"><div class="tablewrap"><table class="stats">
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
  <section class="card"><form data-form="rename">
    <label class="field"><span>Your name</span><input type="text" id="my-name" maxlength="40" value="${esc(p.display_name)}" autocomplete="name" required></label>
    <button class="btn block" type="submit">Save name</button>
    <p class="muted small-text" style="margin:10px 0 0">Shown on the pitch and in the stats. Changing it updates your past games too.</p>
  </form></section>
  <section class="card"><p style="margin:0 0 12px">Signed in as <b>${esc(p.email || '@' + p.github_username)}</b></p>
    <button class="btn ghost block" data-act="signout">Sign out</button></section>`;
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
    <p class="muted small-text">Inactive players don't appear when picking a game but keep their stats.</p>
    <ul class="plist">${state.players.map((p) => `<li>${disc(p)}<div class="who">${esc(p.name)}${p.profile_id ? '' : '<small>Guest</small>'}</div>
      <button class="btn ghost small" data-act="toggle-active" data-id="${p.id}" data-v="${p.active ? 0 : 1}">${p.active ? 'Set inactive' : 'Set active'}</button></li>`).join('')}</ul>
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
      });
      if (error) throw error;
      ui.draft = { date: today(), format: d.format, selected: new Set(), teams: null, animate: false, rules: { together: [], apart: [] }, ruleType: 'together', rulePick: new Set() };
      await loadAll();
      toast('Game saved');
      location.hash = '#/match/' + id;
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
  async 'toggle-organiser'(el) { await adminUpdate(el, 'profiles', { can_organise: el.dataset.v === '1' }, 'Updated'); },
  backup() {
    const data = {
      exported_at: new Date().toISOString(), app: APP_NAME,
      matches: [...state.matches].reverse().map((m) => ({
        date: m.played_on, format: m.format, status: m.status,
        score_blue: m.score_a, score_orange: m.score_b, drawn_by: drawnBy(m) || null,
        draw_rules: m.draw_rules ? [...(m.draw_rules.together || []).map((g) => ruleText('together', g)), ...(m.draw_rules.apart || []).map((g) => ruleText('apart', g))] : [],
        man_of_the_match: state.motm.filter((r) => r.match_id === m.id && r.is_winner).map((r) => pname(r.player_id)),
        lineup: rosterOf(m.id).map((r) => ({ player: pname(r.player_id), team: TEAM[r.team], goals: r.goals_recorded ? r.goals : null })),
      })),
      player_stats: state.stats.map(({ name, games, wins, draws, losses, goals_for, goals_against, personal_goals, motm }) => ({ name, games, wins, draws, losses, goals_for, goals_against, personal_goals, motm })),
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `Real SocialDads-backup-${today()}.json`;
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
    await busy(el, async () => {
      const { error } = await sb.rpc('set_goals', { p_match: el.dataset.m, p_player: el.dataset.pid, p_goals: v });
      if (error) throw error;
      toast('Goals saved');
      await refresh();
    });
  },
  pick(el) { ui.choice[el.dataset.m] = el.dataset.pid; route(true); },
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
document.addEventListener('change', (e) => {
  const t = e.target;
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
    route(true);
  }
  if (t.dataset?.rulepick) {
    const set = ui.draft.rulePick;
    t.checked ? set.add(t.dataset.rulepick) : set.delete(t.dataset.rulepick);
    route(true);
  }
});

boot();
