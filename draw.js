// Team draw with optional rules. Pure functions, no DOM, so they can be tested on their own.
//
// rules = { together: [[id, id, ...], ...], apart: [[idA, idB], ...] }
//   together: everyone in a group ends up on the SAME team
//   apart:    the two players end up on OPPOSITE teams
//
// drawTeams is uniformly random among all splits that satisfy every rule. drawBalanced picks at random among
// the fairest of those splits, using strengths learnt from past results (playerStrengths).

export function rand(n) {
  const max = Math.floor(2 ** 32 / n) * n;
  const buf = new Uint32Array(1);
  let x;
  do { crypto.getRandomValues(buf); x = buf[0]; } while (x >= max);
  return x % n;
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Group players into "clusters". Inside a cluster every player's side is tied to the others:
// a cluster has two halves (L and R) that must go on opposite teams, and it can be flipped as a whole.
// A player with no rules is a cluster with L=[player], R=[].
function buildClusters(ids, rules, nameOf) {
  const inSet = new Set(ids);
  const together = (rules?.together || []).map((g) => g.filter((id) => inSet.has(id))).filter((g) => g.length > 1);
  const apart = (rules?.apart || []).filter(([a, b]) => inSet.has(a) && inSet.has(b));

  // union-find for "together"
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const g of together) for (let i = 1; i < g.length; i++) union(g[0], g[i]);

  const members = new Map();
  for (const id of ids) { const r = find(id); if (!members.has(r)) members.set(r, []); members.get(r).push(id); }

  // "apart" edges between those groups
  const adj = new Map([...members.keys()].map((r) => [r, new Set()]));
  for (const [a, b] of apart) {
    const ra = find(a), rb = find(b);
    if (ra === rb) throw new Error(`${nameOf(a)} and ${nameOf(b)} can't be kept apart because other rules put them on the same team.`);
    adj.get(ra).add(rb); adj.get(rb).add(ra);
  }

  // 2-colour each connected set of groups
  const color = new Map();
  const clusters = [];
  for (const start of members.keys()) {
    if (color.has(start)) continue;
    color.set(start, 0);
    const queue = [start], seen = [start];
    while (queue.length) {
      const cur = queue.shift();
      for (const nxt of adj.get(cur)) {
        if (!color.has(nxt)) { color.set(nxt, 1 - color.get(cur)); queue.push(nxt); seen.push(nxt); }
        else if (color.get(nxt) === color.get(cur)) throw new Error("These rules contradict each other, so no draw can satisfy them all.");
      }
    }
    const L = [], R = [];
    for (const r of seen) (color.get(r) === 0 ? L : R).push(...members.get(r));
    clusters.push({ L, R });
  }
  return clusters;
}

// Quick check used while building rules (doesn't care about team sizes).
export function validateRules(ids, rules, nameOf = (x) => x) {
  buildClusters(ids, rules, nameOf);
}

// Every split (as a bit mask over the clusters) that gives both teams `format` players.
function validSplits(ids, format, rules, nameOf) {
  if (ids.length !== format * 2) throw new Error(`Pick exactly ${format * 2} players.`);
  const clusters = buildClusters(ids, rules, nameOf);
  const k = clusters.length;
  const valid = [];
  for (let mask = 0; mask < (1 << k); mask++) {
    let sizeA = 0;
    for (let i = 0; i < k; i++) sizeA += (mask >> i) & 1 ? clusters[i].R.length : clusters[i].L.length;
    if (sizeA === format) valid.push(mask);
  }
  if (!valid.length) throw new Error("These rules can't all be met with this line-up (a team would end up too big). Remove or loosen one.");
  return { clusters, valid };
}

function splitTeams(clusters, mask) {
  const A = [], B = [];
  clusters.forEach((c, i) => {
    const flipped = (mask >> i) & 1;
    A.push(...(flipped ? c.R : c.L));
    B.push(...(flipped ? c.L : c.R));
  });
  return { A, B };
}

export function drawTeams(ids, format, rules = { together: [], apart: [] }, nameOf = (x) => x) {
  const { clusters, valid } = validSplits(ids, format, rules, nameOf);
  const { A, B } = splitTeams(clusters, valid[rand(valid.length)]);
  return { A: shuffle(A), B: shuffle(B) };
}

// ---------------------------------------------------------------- balanced draw

// How much a one-goal difference in expected strength moves the chance of winning (a logistic scale, in goals).
const WIN_SCALE = 2;
// Pulls every strength towards average (0). Higher = players need more games before they stand out.
const SHRINK = 3;
// Older games count for less: a game this many days old counts half as much as one played today.
const HALF_LIFE_DAYS = 180;
// A big win counts as this many goals at most, so one 12-1 doesn't decide everything.
const MAX_GD = 6;

// games: [{ A: [ids], B: [ids], scoreA, scoreB, date: 'YYYY-MM-DD' }] (completed games only)
// Returns a Map of player id -> strength, in goals per game compared with an average player (0).
// It's a ridge regression on goal difference: each game says "team A's strengths minus team B's ≈ the goal
// difference", so a player who keeps winning with different team-mates rises, and one who only wins alongside
// the same strong player doesn't get all the credit. Players with few games stay close to 0.
export function playerStrengths(games, today = new Date().toISOString().slice(0, 10)) {
  const idx = new Map();
  for (const g of games) for (const id of [...g.A, ...g.B]) if (!idx.has(id)) idx.set(id, idx.size);
  const n = idx.size;
  const out = new Map();
  if (!n) return out;
  const M = Array.from({ length: n }, () => new Float64Array(n));
  const v = new Float64Array(n);
  const t0 = Date.parse(today + 'T00:00:00Z');
  for (const g of games) {
    if (!g.A.length || !g.B.length) continue;
    const age = Math.max(0, (t0 - Date.parse(g.date + 'T00:00:00Z')) / 86400000) || 0;
    const w = 0.5 ** (age / HALF_LIFE_DAYS);
    const y = Math.max(-MAX_GD, Math.min(MAX_GD, (g.scoreA ?? 0) - (g.scoreB ?? 0)));
    const row = new Map();
    for (const id of g.A) row.set(idx.get(id), 1);
    for (const id of g.B) row.set(idx.get(id), -1);
    const ents = [...row];
    for (const [i, xi] of ents) {
      v[i] += w * xi * y;
      for (const [j, xj] of ents) M[i][j] += w * xi * xj;
    }
  }
  for (let i = 0; i < n; i++) M[i][i] += SHRINK;
  const s = solve(M, v);
  for (const [id, i] of idx) out.set(id, s[i]);
  return out;
}

// Gaussian elimination with partial pivoting (the matrix is small: one row per player in the group).
function solve(M, v) {
  const n = v.length;
  const a = M.map((r, i) => [...r, v[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    if (Math.abs(d) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r][c] / d;
      if (f) for (let k = c; k <= n; k++) a[r][k] -= f * a[c][k];
    }
  }
  return a.map((r, i) => (Math.abs(r[i]) < 1e-12 ? 0 : r[n] / r[i]));
}

// Team 1's chance of winning, from the difference in total strength (in goals).
export function winChance(diff) { return 1 / (1 + Math.exp(-diff / WIN_SCALE)); }

// Like drawTeams, but only from the fairest splits. Players missing from `strengths` count as average.
// Picks at random among splits within `slack` goals of the fairest one (topped up to `minChoices` with the next fairest, if they're close),
// so "Shuffle again" still gives different teams.
// Each line-up is counted once: a split and its mirror (the same two teams, Team 1 and Team 2 swapped) are the same choice,
// so `minChoices` really means that many different line-ups. Which side is Team 1 is then decided at random.
export function drawBalanced(ids, format, rules = { together: [], apart: [] }, strengths = new Map(), nameOf = (x) => x, { slack = 0.4, minChoices = 8 } = {}) {
  const { clusters, valid } = validSplits(ids, format, rules, nameOf);
  const str = (id) => strengths.get(id) || 0;
  const scored = valid.filter((mask) => !(mask & 1)).map((mask) => {
    const { A, B } = splitTeams(clusters, mask);
    let d = 0;
    for (const id of A) d += str(id);
    for (const id of B) d -= str(id);
    return { mask, diff: d };
  }).sort((x, y) => Math.abs(x.diff) - Math.abs(y.diff));
  const best = Math.abs(scored[0].diff);
  let pool = scored.filter((x) => Math.abs(x.diff) <= best + slack);
  if (pool.length < minChoices) pool = scored.slice(0, minChoices).filter((x) => Math.abs(x.diff) <= best + 2.5 * slack);
  const pick = pool[rand(pool.length)];
  const { A, B } = splitTeams(clusters, pick.mask);
  const flip = rand(2) === 1, diff = flip ? -pick.diff : pick.diff;
  return { A: shuffle(flip ? B : A), B: shuffle(flip ? A : B), diff, chanceA: winChance(diff) };
}
