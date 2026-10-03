// Team draw with optional rules. Pure functions, no DOM, so they can be tested on their own.
//
// rules = { together: [[id, id, ...], ...], apart: [[idA, idB], ...] }
//   together: everyone in a group ends up on the SAME team
//   apart:    the two players end up on OPPOSITE teams
//
// The draw is uniformly random among all splits that satisfy every rule.

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

export function drawTeams(ids, format, rules = { together: [], apart: [] }, nameOf = (x) => x) {
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
  const mask = valid[rand(valid.length)];
  const A = [], B = [];
  clusters.forEach((c, i) => {
    const flipped = (mask >> i) & 1;
    A.push(...(flipped ? c.R : c.L));
    B.push(...(flipped ? c.L : c.R));
  });
  return { A: shuffle(A), B: shuffle(B) };
}
