// Reliques (capsules en interne) : une relique par heure, ouverture animée, collection par rareté / gamme / champion. PWA autonome servie par l'API.
const API = '/api/v1';
const DD = 'https://ddragon.leagueoflegends.com/cdn/img/champion';
const CD = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/';
const RARITIES = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC', 'ULTIMATE', 'EXALTED'];
const LABEL = { COMMON: 'Commun', RARE: 'Rare', EPIC: 'Épique', LEGENDARY: 'Légendaire', MYTHIC: 'Mythique', ULTIMATE: 'Ultime', EXALTED: 'Exalté' };
const COLOR = { COMMON: '#9aa4b1', RARE: '#4f9cff', EPIC: '#b06cff', LEGENDARY: '#ff9f1a', MYTHIC: '#ff4d6d', ULTIMATE: '#ffd34d', EXALTED: '#ffffff' };
const CATALOG_KEY = 'capsules.catalog.v7';
// Build de cette coquille, gravé au déploiement par le Dockerfile ; « dev » en local.
const APP_VERSION = '__BUILD__'.includes('_') ? 'dev' : '__BUILD__';
const rank = (r) => RARITIES.indexOf(r);

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* idem */ } },
};

const S = {
  token: store.get('capsules.token'),
  user: JSON.parse(store.get('capsules.user') || 'null'),
  wallet: null,
  clockOffset: 0,
  cat: null,
  owned: new Map(),
  recent: [],
  view: 'open',
  type: 'STANDARD',
  busy: false,
  sound: store.get('capsules.sound') !== 'off',
  coll: { group: 'line', q: '', missing: false, rarity: null, role: null, open: new Set(), limits: {} },
  pushKey: null,
  roster: [null, null, null, null, null],
  teams: [],
  activeTeam: 0,
  friend: null,
  friends: [],
};

// ---------- API ----------
// Réveil du serveur (plan gratuit : mis en veille après 15 min, jusqu'à une minute pour repartir).
const wake = {
  since: 0, pending: 0, timer: 0,
  begin() {
    if (this.pending++ === 0) this.timer = setTimeout(() => this.show(), 2500);
  },
  end() {
    if (--this.pending > 0) return;
    clearTimeout(this.timer); this.since = 0;
    $('#wake').hidden = true;
  },
  show() {
    const el = $('#wake');
    if (!el.hidden) return;
    this.since ||= Date.now();
    el.hidden = false;
    const tick = () => {
      if (el.hidden) return;
      const s = Math.round((Date.now() - this.since) / 1000);
      $('#wake-text').textContent = `Réveil du serveur… ${s} s`;
      setTimeout(tick, 1000);
    };
    tick();
  },
};
const RETRYABLE = new Set([0, 502, 503, 504]);

/**
 * Appel d'API. retry : relance tant que le serveur se réveille (réseau coupé, 502/503/504), jusqu'à ~2 min.
 * Réservé aux appels sans effet de bord (lectures, connexion) : une ouverture n'est jamais rejouée.
 */
async function api(path, { method = 'GET', body, retry = false } = {}) {
  const deadline = Date.now() + 120_000;
  let delay = 1500;
  wake.begin();
  try {
    for (;;) {
      let res;
      const ctl = new AbortController();
      const abort = setTimeout(() => ctl.abort(), 30_000);
      try {
        res = await fetch(API + path, {
          method,
          signal: ctl.signal,
          headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: `Bearer ${S.token}` } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch { res = null; } finally { clearTimeout(abort); }
      const status = res?.status ?? 0;
      if (!RETRYABLE.has(status)) return await parse(res);
      if (!retry || Date.now() > deadline) throw new Error('Serveur injoignable pour le moment, réessaie dans un instant.');
      wake.show();
      await sleep(delay);
      delay = Math.min(delay * 1.5, 6000);
    }
  } finally { wake.end(); }
}

async function parse(res) {
  if (res.status === 401 && S.token) { logout(); throw new Error('Session expirée, reconnecte-toi.'); }
  if (!res.ok) {
    let msg = `Erreur ${res.status}`;
    try { const j = await res.json(); msg = j.error || j.title || msg; } catch { /* corps vide */ }
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

// ---------- Version ----------
// Le service worker sert la coquille depuis son cache : après un déploiement, l'app ouverte peut être en retard sur le serveur.
async function checkVersion() {
  let server = null;
  try { server = await (await fetch(`${API}/version`, { cache: 'no-store' })).json(); } catch { /* serveur endormi : on réessaiera */ }
  $('#menu-version').textContent = `Version ${APP_VERSION}${server?.commit ? ` · ${server.commit}` : ''}`;
  const stale = server && server.version !== 'dev' && server.version !== APP_VERSION;
  $('#update-bar').hidden = !stale;
  if (stale) $('#update-version').textContent = server.version;
}

async function applyUpdate() {
  $('#update-go').disabled = true;
  $('#update-go').textContent = 'Mise à jour…';
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => null);
  if (!reg) { location.reload(); return; }
  // Le nouveau service worker télécharge la coquille puis prend la main ; on recharge dès qu'il est actif.
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
  await reg.update().catch(() => {});
  setTimeout(() => location.reload(), 5000);
}

function toast(msg, error = false) {
  const el = document.createElement('div');
  el.className = `toast${error ? ' error' : ''}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 3800);
}

// ---------- Catalogue ----------
function indexCatalog(data) {
  const champ = new Map(data.champions.map((c) => [c.id, c]));
  const skin = new Map(data.skins.map((s) => [s.id, s]));
  const line = new Map(data.lines.map((l) => [l.id, l]));
  const byLine = new Map();
  const byChamp = new Map();
  const byRarity = Object.fromEntries(RARITIES.map((r) => [r, []]));
  // Les champions occupent le palier le plus rare.
  byRarity.EXALTED = data.champions.map((c) => `CHAMPION:${c.id}`);
  for (const s of data.skins) {
    byRarity[s.rarity].push(`SKIN:${s.id}`);
    for (const l of s.lines) (byLine.get(l) || byLine.set(l, []).get(l)).push(s.id);
    (byChamp.get(s.championId) || byChamp.set(s.championId, []).get(s.championId)).push(s.id);
  }
  // oddsBy.STANDARD.EPIC = { percent, duplicateEssence }
  const oddsBy = Object.fromEntries(data.odds.map((o) => [o.type, Object.fromEntries(o.rates.map((r) => [r.rarity, r]))]));
  const price = Object.fromEntries(data.odds.map((o) => [o.type, o.essenceCost]));
  return { ...data, champ, skin, line, byLine, byChamp, byRarity, oddsBy, price };
}

async function loadCatalog() {
  const cached = JSON.parse(store.get(CATALOG_KEY) || 'null');
  if (cached && Date.now() - cached.at < 6 * 3600e3) { S.cat = indexCatalog(cached.data); return; }
  // Version dans l'URL : le catalogue est aussi en cache HTTP (6 h), un changement de format doit le contourner.
  const data = await api('/capsules/catalog?v=7', { retry: true });
  store.set(CATALOG_KEY, JSON.stringify({ at: Date.now(), data }));
  S.cat = indexCatalog(data);
}

function item(kind, id) {
  if (kind === 'CHAMPION') {
    const c = S.cat.champ.get(id);
    if (!c) return null;
    return { key: `CHAMPION:${id}`, kind, id, name: c.name, sub: 'Champion', rarity: 'EXALTED', champ: c,
      art: `${DD}/loading/${c.alias}_0.jpg`, splash: `${DD}/splash/${c.alias}_0.jpg`, fb: null, lines: [] };
  }
  const s = S.cat.skin.get(id);
  const c = s && S.cat.champ.get(s.championId);
  if (!c) return null;
  return { key: `SKIN:${id}`, kind, id, name: s.name, sub: c.name, rarity: s.rarity, champ: c, legacy: s.legacy,
    art: `${DD}/loading/${c.alias}_${s.num}.jpg`, splash: `${DD}/splash/${c.alias}_${s.num}.jpg`, fb: s.load ? CD + s.load : null, lines: s.lines };
}
/** Champion prêté par la rotation de la semaine : jouable sans le posséder, rareté Commune (sans bonus de rareté). */
function loanItem(id) {
  const it = item('CHAMPION', id);
  return it && { ...it, key: `LOAN:${id}`, loan: true, rarity: 'COMMON', sub: 'Prêt de la semaine' };
}
const fromKey = (key) => { const [k, id] = key.split(':'); return k === 'LOAN' ? loanItem(+id) : item(k, +id); };
/** Objet d'un poste de roster (prêt compris). */
const slotItem = (s) => (s ? (s.loan ? loanItem(s.itemId) : item(s.kind, s.itemId)) : null);
const rotationIds = () => new Set(S.rotation?.championIds || []);
/** Fin de la rotation (lundi minuit, heure de Paris) : « à la fin du dimanche 22 novembre ». */
const fmtWeekEnd = (iso) => `à la fin du ${new Date(new Date(iso).getTime() - 1).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' })}`;

// Image de secours CommunityDragon quand Data Dragon n'a pas l'écran de chargement.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img.tagName !== 'IMG') return;
  if (img.dataset.fb) { img.src = img.dataset.fb; delete img.dataset.fb; } else img.style.visibility = 'hidden';
}, true);

function cardHTML(it, { missing = false, count = 0, isNew = false, tag = 'button' } = {}) {
  if (!it) return '';
  return `<${tag} class="card r-${it.rarity}${missing ? ' missing' : ''}" data-key="${it.key}" ${tag === 'button' ? 'type="button"' : ''} aria-label="${esc(it.name)}">
    <img loading="lazy" decoding="async" src="${esc(it.art)}" ${it.fb ? `data-fb="${esc(it.fb)}"` : ''} alt="">
    <span class="shade"></span>
    ${isNew ? '<span class="new">NOUVEAU</span>' : ''}${count > 1 ? `<span class="count">×${count}</span>` : ''}
    <span class="meta"><b>${esc(it.name)}</b><span>${it.kind === 'SKIN' ? esc(it.sub) : LABEL[it.rarity]}</span></span>
  </${tag}>`;
}

// ---------- Son et vibrations ----------
const audio = {
  ctx: null,
  ensure() {
    if (!S.sound) return null;
    try { this.ctx ||= new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },
  tone(freq, dur = 0.12, type = 'sine', vol = 0.12, when = 0) {
    const ctx = this.ensure(); if (!ctx) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + dur + 0.02);
  },
  step(i) { this.tone(260 * Math.pow(1.26, i), 0.16, 'triangle', 0.14); },
  burst(power) {
    const ctx = this.ensure(); if (!ctx) return;
    const len = ctx.sampleRate * 0.6; const buf = ctx.createBuffer(1, len, ctx.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900 + power * 500;
    const g = ctx.createGain(); g.gain.value = 0.35;
    src.connect(f).connect(g).connect(ctx.destination); src.start();
    this.tone(70, 0.4, 'sine', 0.4);
  },
  chime(r) {
    const notes = [523, 659, 784, 988, 1175, 1319, 1568];
    for (let i = 0; i <= Math.max(1, r); i++) this.tone(notes[i], 0.5, 'sine', 0.09, i * 0.07);
  },
};
const buzz = (p) => { try { navigator.vibrate?.(p); } catch { /* non supporté */ } };

// ---------- Particules ----------
const fx = {
  canvas: null, ctx: null, parts: [], raf: 0,
  init() {
    this.canvas = $('#fx'); this.ctx = this.canvas.getContext('2d');
    const resize = () => { const d = devicePixelRatio || 1; this.canvas.width = innerWidth * d; this.canvas.height = innerHeight * d; this.ctx.setTransform(d, 0, 0, d, 0, 0); };
    addEventListener('resize', resize); resize();
  },
  burst(x, y, rarity, count = 120, power = 1) {
    const rainbow = rarity === 'EXALTED';
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2; const v = (2 + Math.random() * 9) * power;
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2, life: 1, decay: 0.008 + Math.random() * 0.016,
        size: 1.5 + Math.random() * 3.5, color: rainbow ? `hsl(${Math.random() * 360} 100% 65%)` : (Math.random() < 0.25 ? '#ffffff' : COLOR[rarity]) });
    }
    this.parts.push({ ring: true, x, y, r: 10, life: 1, color: rainbow ? '#ffffff' : COLOR[rarity], power });
    if (!this.raf) this.loop();
  },
  loop() {
    const { ctx } = this;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.globalCompositeOperation = 'lighter';
    this.parts = this.parts.filter((p) => p.life > 0);
    for (const p of this.parts) {
      if (p.ring) {
        p.r += 14 * p.power; p.life -= 0.035;
        ctx.strokeStyle = p.color; ctx.globalAlpha = Math.max(0, p.life); ctx.lineWidth = 3 + 6 * p.life;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.stroke();
        continue;
      }
      p.vx *= 0.97; p.vy = p.vy * 0.97 + 0.12; p.x += p.vx; p.y += p.vy; p.life -= p.decay;
      ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.5 + p.life), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    this.raf = this.parts.length ? requestAnimationFrame(() => this.loop()) : 0;
    if (!this.raf) ctx.clearRect(0, 0, innerWidth, innerHeight);
  },
};

const restart = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
const SPARK = '<svg viewBox="0 0 24 24"><path d="M12 0c.7 6.4 5.6 11.3 12 12-6.4.7-11.3 5.6-12 12-.7-6.4-5.6-11.3-12-12C6.4 11.3 11.3 6.4 12 0z"/></svg>';
/** Quelques étincelles en étoile autour du cristal, plutôt qu'une pluie de confettis. */
function sparkle(n, color, spread = 120) {
  const host = $('#sparks'); if (!host || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (let i = 0; i < n; i++) {
    const sp = document.createElement('span'); sp.className = 'spark'; sp.innerHTML = SPARK;
    const a = Math.random() * Math.PI * 2, d = 50 + Math.random() * spread;
    sp.style.cssText = `left:calc(50% + ${Math.cos(a) * d}px);top:calc(42% + ${Math.sin(a) * d}px);color:${color};--sz:${10 + Math.random() * 16}px;animation-delay:${Math.random() * 0.2}s`;
    host.appendChild(sp); setTimeout(() => sp.remove(), 1400);
  }
}

// ---------- État et minuterie ----------
const now = () => Date.now() + S.clockOffset;

function setWallet(w) {
  S.wallet = { ...w, nextAtMs: w.nextAt ? Date.parse(w.nextAt) : null };
  S.clockOffset = Date.parse(w.serverTime) - Date.now();
  renderWallet();
}

function tick() {
  const w = S.wallet; if (!w) return;
  if (w.nextAtMs && now() >= w.nextAtMs) {
    w.available++;
    w.nextAtMs = w.available >= w.maxStock ? null : w.nextAtMs + w.intervalSeconds * 1000;
    if (w.available === w.notifyAt) toast(`${w.available} reliques en stock : ouvre-les !`);
    renderWallet();
  }
  renderTimer();
}

function renderTimer() {
  const w = S.wallet;
  if (!w.nextAtMs) { $('#next-text').textContent = w.available >= w.maxStock ? 'Stock plein' : ''; $('#timer-fill').style.width = '100%'; return; }
  const left = Math.max(0, w.nextAtMs - now());
  const m = Math.floor(left / 60000); const s = Math.floor((left % 60000) / 1000);
  $('#next-text').textContent = `prochaine dans ${m}:${String(s).padStart(2, '0')}`;
  const nx = $('#ring-next');
  if (nx && S.type !== 'PREMIUM') { const n = w.maxStock, i = w.available, r = 136, c = 150, frac = Math.max(0.001, 1 - left / (w.intervalSeconds * 1000));
    const pt = (a) => `${(c + r * Math.cos(a)).toFixed(1)} ${(c + r * Math.sin(a)).toFixed(1)}`, a0 = (i / n) * Math.PI * 2 - Math.PI / 2 + 0.06, a1 = a0 + (((i + 1) / n) * Math.PI * 2 - Math.PI / 2 - 0.06 - a0) * frac;
    nx.setAttribute('d', `M${pt(a0)} A${r} ${r} 0 0 1 ${pt(a1)}`); }
  $('#timer-fill').style.width = `${100 - (left / (w.intervalSeconds * 1000)) * 100}%`;
}

const stockOf = (type = S.type) => (type === 'PREMIUM' ? S.wallet.premiumAvailable : S.wallet.available);

function renderWallet() {
  const w = S.wallet;
  const premium = S.type === 'PREMIUM';
  const stock = stockOf();
  const has = stock > 0;
  $('#view-open').classList.toggle('premium', premium);
  $('#count-std').textContent = w.available;
  $('#count-prem').textContent = w.premiumAvailable;
  $('#stock').hidden = premium;
  $('#premium-note').hidden = !premium;
  $('#capsule').classList.toggle('empty', !has);
  $('#capsule').disabled = !has;
  $('#capsule-count').textContent = stock;
  $('#tap-hint').textContent = has ? 'Touche le cristal pour l’ouvrir' : premium ? `Forge-en une : ${w.essencePerPremium} essence` : 'Le prochain cristal arrive bientôt';
  $('#stock-n').textContent = premium ? w.premiumAvailable : w.available;
  $('#stock-max').textContent = w.maxStock;
  $('#stock-max').parentElement.hidden = premium;
  renderStockRing();
  $('#pips').innerHTML = Array.from({ length: w.maxStock }, (_, i) => `<i class="pip${i < w.available ? ' on' : ''}"></i>`).join('')
    + (w.available > w.maxStock ? '' : '');
  $('#stock-text').textContent = `${w.available} / ${w.maxStock} reliques${w.available > w.maxStock ? ' (bonus)' : ''}`;
  $('#open-one').disabled = !has || S.busy || !S.online;
  const n = Math.min(stock, 10);
  $('#open-all').disabled = n < 2 || S.busy || !S.online;
  $('#open-all').textContent = n >= 2 ? `Ouvrir ×${n}` : 'Tout ouvrir';
  $('#essence').textContent = w.essence;
  // Jauge jusqu'au prix d'une prestige, repère au prix d'une capsule.
  $('#essence-text').textContent = `${fmtInt(w.essence)} essence`;
  $('#essence-fill').style.width = `${Math.min(100, (w.essence / w.essencePerPremium) * 100)}%`;
  $('#essence-tick').style.left = `${(w.essencePerCapsule / w.essencePerPremium) * 100}%`;
  $('#price-std').textContent = w.essencePerCapsule;
  $('#price-prem').textContent = w.essencePerPremium;
  $('#buy-std').disabled = w.essence < w.essencePerCapsule || S.busy || !S.online;
  $('#buy-prem').disabled = w.essence < w.essencePerPremium || S.busy || !S.online;
  $('#pity-text').textContent = w.pityIn <= 1 ? 'Épique garanti à la prochaine' : `Épique garanti dans ${w.pityIn}`;
  $('#pity-fill').style.width = `${((10 - w.pityIn) / 9) * 100}%`;
  $('#total-opened').textContent = w.totalOpened ? `${w.totalOpened} ouvertes` : '';
  const all = w.available + w.premiumAvailable;
  const badge = $('#nav-badge'); badge.hidden = !all; badge.textContent = all;
  document.title = all ? `(${all}) Reliques` : 'Reliques';
  try { all ? navigator.setAppBadge?.(all) : navigator.clearAppBadge?.(); } catch { /* non supporté */ }
  $('#debug').hidden = !w.debug;
  renderQueenPack();
  renderTimer();
}

/** Anneau de stock autour du cristal : un cran par relique, le cran suivant se remplit avec le minuteur. */
function renderStockRing() {
  const w = S.wallet, el = $('#stock-ring'); if (!w || !el) return;
  const premium = S.type === 'PREMIUM', n = premium ? Math.max(1, Math.min(10, w.premiumAvailable)) : w.maxStock;
  const full = premium ? w.premiumAvailable : w.available, r = 136, c = 150;
  const pt = (a) => `${(c + r * Math.cos(a)).toFixed(1)} ${(c + r * Math.sin(a)).toFixed(1)}`;
  const arc = (i, frac = 1) => { const a0 = (i / n) * Math.PI * 2 - Math.PI / 2 + 0.06, a1 = a0 + (((i + 1) / n) * Math.PI * 2 - Math.PI / 2 - 0.06 - a0) * frac; return `M${pt(a0)} A${r} ${r} 0 0 1 ${pt(a1)}`; };
  let out = '';
  for (let i = 0; i < n; i++) out += `<path d="${arc(i)}" class="${i < full ? 'on' : ''}"/>`;
  if (!premium && full < n) out += `<path d="${arc(full, 0.001)}" class="next" id="ring-next"/>`;
  el.innerHTML = out;
  el.classList.toggle('premium', premium);
}

function renderRecent() {
  const el = $('#recent-strip');
  if (!S.recent.length) { el.innerHTML = '<p class="empty-note">Tes trouvailles apparaîtront ici.</p>'; return; }
  el.innerHTML = S.recent.slice(0, 20).map((d) => cardHTML(item(d.kind, d.itemId), { isNew: d.isNew })).join('');
}

// ---------- Ouverture ----------
// Passer l'animation : toucher la relique pendant la charge écourte toutes les pauses restantes.
const skipper = { on: false, wake: () => {} };
const pause = (ms) => (skipper.on ? Promise.resolve() : new Promise((r) => { const t = setTimeout(r, ms); skipper.wake = () => { clearTimeout(t); r(); }; }));
function skipAnimation() { if (skipper.on) return; skipper.on = true; skipper.wake(); }

async function openCapsules(count) {
  const type = S.type;
  if (S.busy || !S.online || !S.wallet || stockOf(type) < 1) return;
  S.busy = true; renderWallet();
  audio.ensure();
  const reveal = $('#reveal'); const cap = $('#reveal-capsule');
  const startGlow = type === 'PREMIUM' ? COLOR.ULTIMATE : COLOR.RARE;
  reveal.hidden = false; reveal.style.setProperty('--glow', startGlow);
  $('#reveal-single').hidden = true; $('#reveal-multi').hidden = true; $('#reveal-actions').hidden = true; $('#rays').className = 'rays';
  skipper.on = false;
  cap.hidden = false; cap.className = 'reveal-capsule descend';
  $$('.cracks path', cap).forEach((c) => c.classList.remove('on'));
  $('#pillar').className = 'pillar on';
  buzz(30);
  let res;
  try {
    [res] = await Promise.all([api('/capsules/open', { method: 'POST', body: { count, type } }), pause(450)]);
  } catch (e) {
    reveal.hidden = true; S.busy = false; renderWallet(); toast(e.message, true); return;
  }
  const best = res.drops.reduce((m, d) => (rank(d.rarity) > rank(m) ? d.rarity : m), 'COMMON');

  // Montée de palier : la colonne de lumière passe par chaque rareté, le cristal se fissure un peu plus à chaque fois.
  const steps = rank(best) <= 1 ? [best] : RARITIES.slice(1, rank(best) + 1);
  const cracks = $$('.cracks path', cap);
  for (let i = 0; i < steps.length; i++) {
    if (skipper.on) { reveal.style.setProperty('--glow', COLOR[best]); break; }
    reveal.style.setProperty('--glow', COLOR[steps[i]]);
    restart($('#pillar'), 'pulse'); restart(cap, `shake${Math.min(i, 3)}`);
    cracks.slice(0, Math.min(cracks.length, (i + 1) * 2)).forEach((c) => c.classList.add('on'));
    sparkle(3 + i * 2, COLOR[steps[i]]);
    audio.step(rank(steps[i])); buzz(20 + i * 15);
    await pause(count > 1 ? 340 : 480 + i * 70);
  }
  cap.classList.add('pop');
  await pause(200);
  const r = rank(best);
  restart($('#flash'), 'go'); restart($('#wave'), 'go');
  sparkle(8 + r * 2, '#fff3d0', 170);
  audio.burst(r); buzz(r >= 3 ? [60, 40, 120] : 50);
  if (r >= 2) $('#rays').className = 'rays on';
  $('#pillar').className = 'pillar';
  cap.hidden = true;

  for (const d of res.drops) applyDrop(d);
  setWallet(res.state);
  saveSnapshot();
  if (count === 1) showSingle(res.drops[0]); else showMulti(res.drops);
  renderRecent();
  if (S.view === 'collection') renderCollection();
}

function applyDrop(d) {
  const key = `${d.kind}:${d.itemId}`;
  const cur = S.owned.get(key);
  S.owned.set(key, { kind: d.kind, itemId: d.itemId, count: d.count, firstObtainedAt: cur?.firstObtainedAt || new Date().toISOString() });
  S.recent.unshift({ kind: d.kind, itemId: d.itemId, rarity: d.rarity, isNew: d.isNew });
}

function dropInfo(d, it) {
  const lines = it.lines.map((l) => S.cat.line.get(l)?.name).filter(Boolean);
  return `<div class="drop-info r-${d.rarity}">
    <div class="rarity r-${d.rarity}">${LABEL[d.rarity]}</div>
    <h2>${esc(it.name)}</h2>
    <div class="sub">${it.kind === 'SKIN' ? `Skin · ${esc(it.sub)}` : 'Champion'}${lines.length ? ` · ${esc(lines.join(', '))}` : ''}</div>
    <div class="tags">${d.isNew ? '<span class="chip-new">NOUVEAU</span>' : `<span class="chip-dup">Doublon ×${d.count} · +${d.essence} essence</span>`}
    ${d.guaranteed ? '<span class="chip-pity">Garantie</span>' : ''}</div>
  </div>`;
}

/** Étoiles de rareté : 1 pour Commun … 7 pour Exalté. */
const starsHTML = (r) => `<div class="stars" aria-label="${rank(r) + 1} étoiles">${Array.from({ length: rank(r) + 1 }, (_, i) => `<i style="animation-delay:${i * 0.18}s"><svg viewBox="0 0 24 24"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.5 1.3 6.6L12 17.2 6.1 20.5l1.3-6.6L2.5 9.4l6.6-.8z"/></svg></i>`).join('')}</div>`;

/** Meilleur poste où le skin tiré renforce l'équipe active (même calcul que la puissance du roster). */
function bestUpgrade(it) {
  if (!it || S.friend) return null;
  const cur = rosterItems(Array.from({ length: 5 }, (_, i) => S.roster?.[i] ?? null)), base = teamPower(cur);
  let best = null;
  for (let i = 0; i < 5; i++) {
    if (cur[i]?.key === it.key) return null;
    // Pas de doublon de champion : on ne remplace que son propre poste.
    const other = cur.findIndex((x, j) => j !== i && x?.champ.id === it.champ.id);
    if (other >= 0) continue;
    const next = cur.slice(); next[i] = it;
    const gain = teamPower(next) - base;
    if (gain > 0 && (!best || gain > best.gain)) best = { slot: i, gain, from: cur[i], power: teamPower(next) };
  }
  return best;
}

function impactHTML(d, it) {
  if (!d.isNew) return `<div class="impact dupe"><div><b>Doublon</b><span>Converti en essence</span></div><b class="num">+${d.essence}</b></div>`;
  const up = bestUpgrade(it);
  if (!up) return '';
  return `<div class="impact"><div><b>${up.from ? `Meilleur que ton ${ROLES[up.slot]}` : `Poste ${ROLES[up.slot]} libre`}</b>
    <span>${up.from ? `${esc(up.from.name)} → ${esc(it.name)}` : 'Il entre directement dans ton équipe'}</span></div><b class="num">+${up.gain}</b>
    <button class="btn primary small" type="button" data-equip="${up.slot}" data-key="${it.key}">Équiper</button></div>`;
}

function showSingle(d) {
  const it = item(d.kind, d.itemId);
  const el = $('#reveal-single');
  const more = stockOf() > 0 && !S.queenReveal;
  const theme = themeOfItem(it)?.key;
  const queen = theme === 'ahri', rage = theme === 'tryn';
  $('#reveal').classList.toggle('ahri', queen);
  $('#reveal').classList.toggle('tryn', rage);
  const star = /<svg viewBox="0 0 24 24"><path d="M12 2\.5[^"]*"\/><\/svg>/g;
  el.innerHTML = `<div class="summon r-${d.rarity}"><div class="summon-in">
      <div class="summon-back"><svg viewBox="0 0 100 100"><use href="#${queen ? 'crystal-queen' : rage ? 'crystal-rage' : 'crystal'}"/></svg></div>
      <div class="summon-front big-card${more ? ' tappable' : ''}" ${more ? 'role="button" tabindex="0" aria-label="Ouvrir la relique suivante"' : ''}>${cardHTML(it, { isNew: d.isNew, tag: 'div' })}</div>
    </div></div>
    <div class="summon-after">${queen ? starsHTML(d.rarity).replace(star, HEART_SVG) : rage ? starsHTML(d.rarity).replace(star, DROP_SVG) : starsHTML(d.rarity)}${dropInfo(d, it)}${queen ? '<p class="queen">La reine est arrivée ♡</p>' : rage ? '<p class="rage-line">Il refuse de mourir.</p>' : ''}${impactHTML(d, it)}
    ${more ? '<p class="tap-again">Touche la carte pour ouvrir la suivante</p>' : ''}</div>`;
  el.hidden = false;
  const sm = $('.summon', el);
  // La carte arrive face cachée, se retourne sur la silhouette, puis la couleur revient. Tryndamere entre d'abord en rage.
  const pre = rage && !skipper.on ? rageIntro() : 0;
  requestAnimationFrame(() => sm.classList.add('in'));
  setTimeout(() => { sm.classList.add('turn'); audio.chime(rank(d.rarity)); }, skipper.on ? 0 : 900 + pre);
  setTimeout(() => { sm.classList.add('color'); if (queen) heartBurst(14); }, skipper.on ? 150 : 1450 + pre);
  setTimeout(() => { el.classList.add('done'); showRevealActions(false); }, skipper.on ? 200 : 1650 + pre);
  const eq = $('[data-equip]', el);
  if (eq) eq.onclick = async (e) => { e.stopPropagation(); eq.disabled = true; await setSlot(+eq.dataset.equip, eq.dataset.key); eq.textContent = 'Équipé'; toast(`${it.name} rejoint ton équipe en ${ROLES[+eq.dataset.equip]}.`); };
  $('#reveal-actions').hidden = true;
  if (more) {
    const card = $('.big-card', el);
    // Après l'animation de retournement, pour ne pas enchaîner sur un double tap.
    setTimeout(() => {
      card.onclick = () => openNext(1);
      card.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openNext(1); } };
    }, 600);
  }
}

/** Referme la révélation et ouvre aussitôt les suivantes (même type de relique). */
function openNext(count) {
  if (stockOf() < 1) return;
  closeReveal();
  openCapsules(Math.min(count, stockOf()));
}

function showMulti(drops) {
  const grid = $('#multi-grid');
  $('#multi-title').textContent = `${drops.length} reliques`;
  $('#multi-sub').textContent = 'Touche une carte pour la révéler';
  grid.innerHTML = drops.map((d, i) => {
    const it = item(d.kind, d.itemId);
    return `<div class="flip r-${d.rarity}${rank(d.rarity) >= 2 ? ' hot' : ''}" data-i="${i}" style="animation-delay:${i * 60}ms">
      <div class="flip-inner"><div class="flip-back"><svg viewBox="0 0 200 220"><use href="#capsule-art"/></svg></div>
      <div class="flip-front">${cardHTML(it, { isNew: d.isNew, count: d.count, tag: 'div' })}</div></div></div>`;
  }).join('');
  grid.dataset.drops = JSON.stringify(drops);
  $('#reveal-multi').hidden = false;
  showRevealActions(true);
}

function flipCard(el) {
  // Toutes retournées : toucher une carte lance le lot suivant.
  if (el.classList.contains('open')) {
    if (!$$('.flip:not(.open)').length) openNext(10);
    return;
  }
  el.classList.add('open');
  const d = JSON.parse($('#multi-grid').dataset.drops)[+el.dataset.i];
  const r = rank(d.rarity);
  if (r >= 2) {
    el.style.setProperty('--rc', COLOR[d.rarity]);
    audio.chime(r); buzz(r >= 4 ? [40, 30, 80] : 30);
  } else audio.tone(420 + r * 120, 0.08, 'triangle', 0.08);
  if ($$('.flip:not(.open)').length === 0) multiDone(JSON.parse($('#multi-grid').dataset.drops));
}

function multiDone(drops) {
  const news = drops.filter((d) => d.isNew).length;
  const ess = drops.reduce((s, d) => s + d.essence, 0);
  const ups = drops.filter((d) => d.isNew).map((d) => bestUpgrade(item(d.kind, d.itemId))).filter(Boolean).length;
  $('#multi-sub').innerHTML = `<span class="multi-summary"><b>${news}</b> nouveauté${news > 1 ? 's' : ''}${ess ? ` · <b>+${ess}</b> essence` : ''}${ups ? ` · <b>${ups}</b> amélioration${ups > 1 ? 's' : ''} d'équipe` : ''}${stockOf() ? ' · touche une carte pour continuer' : ''}</span>`;
  showRevealActions(false);
}

async function revealAll() {
  // Du plus commun au plus rare : le meilleur arrive en dernier.
  const drops = JSON.parse($('#multi-grid').dataset.drops);
  const order = $$('.flip:not(.open)').sort((a, b) => rank(drops[+a.dataset.i].rarity) - rank(drops[+b.dataset.i].rarity));
  $('#reveal-skip').hidden = true;
  for (const el of order) { flipCard(el); await sleep(rank(drops[+el.dataset.i].rarity) >= 3 ? 520 : 170); }
}

function showRevealActions(pending) {
  $('#reveal-actions').hidden = false;
  $('#reveal-skip').hidden = !pending;
  const stock = stockOf();
  $('#reveal-again').hidden = pending || stock < 1 || S.queenReveal;
  $('#reveal-again').textContent = stock > 1 ? `Encore ×${Math.min(stock, 10)}` : 'Ouvrir encore';
  $('#reveal-close').hidden = pending;
}

/** Gerbe de cœurs depuis le centre (révélation d'Ahri). */
function heartBurst(n) {
  const host = $('#sparks'); if (!host || reduceMotion()) return;
  for (let i = 0; i < n; i++) {
    const h = document.createElement('span'); h.className = 'hpop'; h.innerHTML = HEART_SVG;
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4, r = 110 + Math.random() * 60;
    h.style.cssText = `--tx:${Math.cos(a) * r}px;--ty:${Math.sin(a) * r}px;--sz:${16 + Math.random() * 14}px;color:${i % 3 ? '#ff8ad8' : '#ffd1ee'};animation-delay:${Math.random() * 0.15}s`;
    host.appendChild(h); setTimeout(() => h.remove(), 1700);
  }
}

function closeReveal() {
  S.queenReveal = false;
  $('#reveal').classList.remove('ahri', 'tryn', 'rage-shake');
  $('#reveal .rage-fx')?.remove();
  $('#reveal').hidden = true; $('#rays').className = 'rays'; $('#reveal-single').classList.remove('done');
  S.busy = false; renderWallet();
}

// ---------- Relique de la Reine : que des objets d'Ahri, 1 500 essence, invocation de 10 s ----------
/** Objets d'Ahri du catalogue (ses skins et le champion) et ceux déjà possédés. */
function queenItems() {
  const q = S.cat?.queen;
  if (!q) return null;
  const keys = [`CHAMPION:${q.championId}`, ...(S.cat.byChamp.get(q.championId) || []).map((id) => `SKIN:${id}`)];
  return { q, total: keys.length, owned: keys.filter((k) => S.owned.has(k)).length };
}

function renderQueenPack() {
  const el = $('#queen-pack');
  const info = queenItems();
  if (!el || !info || !S.wallet) { if (el) el.hidden = true; return; }
  const { q, total, owned } = info;
  const can = S.wallet.essence >= q.essenceCost && !S.busy && S.online;
  const odds = RARITIES.map((r) => q.rates.find((x) => x.rarity === r)).filter(Boolean);
  el.hidden = false;
  el.innerHTML = `<div class="qp-main">
      <span class="qp-gem"><svg viewBox="0 0 100 100"><use href="#crystal-queen"/></svg></span>
      <span class="qp-txt"><span class="kicker">Relique spéciale</span><b>Relique de la Reine</b><span>Que des skins d'Ahri · taux de la relique standard</span></span>
      <span class="qp-price"><b class="num">${fmtInt(q.essenceCost)}</b><span>essence</span></span>
    </div>
    <div class="qp-own"><span>Ta collection Ahri</span><span class="qp-bar"><i style="width:${Math.round((owned / Math.max(1, total)) * 100)}%"></i></span><b class="num">${owned} / ${total}</b></div>
    <div class="qp-odds" aria-label="Taux">${odds.map((r) => `<i class="r-${r.rarity}" title="${LABEL[r.rarity]}"><span>${String(r.percent).replace('.', ',')} %</span></i>`).join('')}</div>
    ${owned >= total ? '<p class="qp-note">Tu as tout : chaque invocation devient un doublon converti en essence.</p>' : ''}
    <button class="btn block qp-go" type="button" id="queen-go" ${can ? '' : 'disabled'}>${S.wallet.essence >= q.essenceCost
      ? `Invoquer la Reine · ${fmtInt(q.essenceCost)}` : `Encore ${fmtInt(q.essenceCost - S.wallet.essence)} essence`}</button>`;
  $('#queen-go').onclick = confirmQueen;
}

/** Deux touches pour dépenser 1 500 essence : la première arme le bouton quelques secondes. */
function confirmQueen() {
  const btn = $('#queen-go');
  if (!btn.classList.contains('armed')) {
    btn.classList.add('armed'); btn.textContent = `Confirmer · −${fmtInt(S.cat.queen.essenceCost)} essence`;
    clearTimeout(confirmQueen.t); confirmQueen.t = setTimeout(renderQueenPack, 3500);
    return;
  }
  clearTimeout(confirmQueen.t);
  openQueen();
}

const qwait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Cœurs et pétales qui montent du bas de la scène. */
function queenRise(n) {
  const fx = $('#q-fx');
  for (let i = 0; i < n; i++) {
    const h = document.createElement('span'); h.className = 'q-rise';
    h.innerHTML = `<svg viewBox="0 0 24 24"><use href="#${Math.random() < 0.35 ? 'petal' : 'heart'}"/></svg>`;
    h.style.cssText = `left:${50 + (Math.random() - 0.5) * 90}%;top:${80 + Math.random() * 14}%;--s:${8 + Math.random() * 12}px;--c:${['#ff8ad8', '#ffd1ee', '#e6cf98'][i % 3]};--x:${(Math.random() - 0.5) * 60}px;--r:${(Math.random() - 0.5) * 120}deg;--d:${2 + Math.random() * 1.6}s;animation-delay:${Math.random() * 1.2}s`;
    fx.appendChild(h); setTimeout(() => h.remove(), 5000);
  }
}

/** Gerbe de cœurs et pétales depuis le cristal. */
function queenBurst(n) {
  const fx = $('#q-fx');
  for (let i = 0; i < n; i++) {
    const b = document.createElement('span'); b.className = 'q-burst';
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.3, r = 120 + Math.random() * 130;
    b.innerHTML = `<svg viewBox="0 0 24 24"><use href="#${i % 3 === 0 ? 'petal' : 'heart'}"/></svg>`;
    b.style.cssText = `--s:${12 + Math.random() * 16}px;--c:${['#ff8ad8', '#ffe1f3', '#e6cf98'][i % 3]};--x:${Math.cos(a) * r}px;--y:${Math.sin(a) * r}px;--r:${(Math.random() - 0.5) * 360}deg`;
    fx.appendChild(b); setTimeout(() => b.remove(), 1500);
  }
}

/**
 * Invocation : environ 8 s de cinématique (cristal rose, neuf queues, feux follets, charme, ruée), non interruptible,
 * puis la révélation habituelle (dos, retournement, silhouette, couleur). Version sobre si l'utilisateur limite les animations.
 */
async function openQueen() {
  if (S.busy || !S.online) return;
  S.busy = true; renderWallet();
  audio.ensure();
  const st = $('#queen');
  const calm = reduceMotion();
  const tails = $('#q-tails');
  if (!tails.children.length) {
    for (let i = 0; i < 9; i++) tails.insertAdjacentHTML('beforeend',
      `<div class="q-tail" style="--a:${-60 + i * 15}deg;--i:${Math.abs(i - 4) * 2 + (i > 4 ? 1 : 0)}"><svg viewBox="0 0 70 230"><use href="#tail"/></svg></div>`);
  }
  $('#q-fx').innerHTML = '';
  st.className = `qscene${calm ? ' calm' : ''}`;
  st.hidden = false;
  void st.offsetWidth;
  const add = (c) => st.classList.add(c);
  add('run'); add('q0');
  buzz(30);
  let res;
  try {
    [res] = await Promise.all([api('/capsules/queen', { method: 'POST' }), qwait(calm ? 300 : 1000)]);
  } catch (e) {
    st.hidden = true; S.busy = false; renderWallet(); toast(e.message, true); return;
  }
  const d = res.drops[0];
  if (calm) {
    add('q1'); await qwait(1600);
  } else {
    add('q1'); queenRise(10);
    for (let i = 0; i < 9; i++) setTimeout(() => audio.step(Math.min(6, Math.floor(i / 1.4))), 100 + i * 190);
    await qwait(2000);
    add('q2'); queenRise(14); buzz(20);
    await qwait(1600);
    add('q3'); queenRise(10); setTimeout(() => { audio.chime(3); buzz([30, 40, 30]); }, 900);
    await qwait(1300);
    add('q4'); restart($('#q-flash'), 'go'); restart(st, 'shake');
    [1150, 1450, 1750].forEach((t) => setTimeout(() => { restart(st, 'shake'); audio.tone(880, 0.09, 'triangle', 0.1); }, t));
    await qwait(1900);
    add('q5'); queenBurst(34); restart($('#q-flash'), 'go'); audio.burst(Math.max(4, rank(d.rarity))); buzz([60, 40, 120]);
    await qwait(500);
  }

  // Révélation habituelle, variante d'Ahri.
  applyDrop(d);
  setWallet(res.state);
  saveSnapshot();
  renderRecent();
  if (S.view === 'collection') renderCollection();
  const reveal = $('#reveal');
  reveal.hidden = false; reveal.style.setProperty('--glow', '#ff8ad8');
  $('#reveal-multi').hidden = true; $('#reveal-actions').hidden = true; $('#reveal-capsule').hidden = true;
  $('#pillar').className = 'pillar'; $('#rays').className = rank(d.rarity) >= 2 ? 'rays on' : 'rays';
  skipper.on = false;
  S.queenReveal = true;
  showSingle(d);
  add('end');
  await qwait(calm ? 200 : 600);
  st.hidden = true; st.className = 'qscene';
}

// ---------- Collection ----------
// Collection affichée : la sienne, ou celle de l'ami consulté.
const lens = () => S.friend?.owned ?? S.owned;
function ownedOf(key) { return lens().get(key); }

function totals() {
  const out = {};
  for (const r of RARITIES) {
    const keys = S.cat.byRarity[r];
    out[r] = { total: keys.length, owned: keys.filter((k) => lens().has(k)).length };
  }
  return out;
}

function renderSummary() {
  const t = totals();
  const all = RARITIES.reduce((s, r) => s + t[r].total, 0);
  const own = RARITIES.reduce((s, r) => s + t[r].owned, 0);
  const pct = all ? (own / all) * 100 : 0;
  $('#ring-pct').textContent = `${pct < 10 ? pct.toFixed(1) : Math.round(pct)} %`;
  $('#coll-own').textContent = fmtInt(own);
  $('#coll-all').textContent = fmtInt(all);
  // Une barre : chaque rareté y prend la place de ses objets possédés, le reste en gris.
  $('#rstack').innerHTML = RARITIES.map((r) => `<i class="r-${r}" style="flex:${t[r].owned}"></i>`).join('') + `<i class="rest" style="flex:${all - own}"></i>`;
  $('#rarity-bars').innerHTML = [...RARITIES].reverse().map((r) => `
    <button class="rbar r-${r}" data-rarity="${r}" aria-pressed="${S.coll.rarity === r}"><b class="num">${t[r].owned}</b><span class="name">${LABEL[r]}</span></button>`).join('');
}

// Filtre par poste : le champion y joue en poste principal ou secondaire.
const playsRole = (c, role = S.coll.role) => role == null || c?.profile?.main === role || c?.profile?.secondary === role;

function matches(it, q) {
  if (!playsRole(it.champ)) return false;
  if (!q) return true;
  const lines = it.lines.map((l) => S.cat.line.get(l)?.name || '').join(' ');
  return `${it.name} ${it.sub} ${lines}`.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').includes(q);
}

function renderCollection() {
  if (!S.cat) return;
  renderSummary();
  const { group, missing } = S.coll;
  const q = S.coll.q.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').trim();
  const body = $('#coll-body');
  if (group === 'rarity') body.innerHTML = renderByRarity(q, missing);
  else if (group === 'line') body.innerHTML = renderByLine(q, missing);
  else body.innerHTML = renderByChampion(q, missing);
}

function renderByRarity(q, missing) {
  const sections = [...RARITIES].reverse().filter((r) => !S.coll.rarity || S.coll.rarity === r).map((r) => {
    const keys = S.cat.byRarity[r];
    const owned = keys.filter((k) => lens().has(k)).length;
    let items = keys.map(fromKey).filter((it) => it && (missing || lens().has(it.key)) && matches(it, q));
    if (!items.length) return '';
    items.sort((a, b) => (lens().has(b.key) - lens().has(a.key)) || a.name.localeCompare(b.name, 'fr'));
    const limit = S.coll.limits[r] || 60;
    const more = items.length - limit;
    items = items.slice(0, limit);
    return `<section class="r-${r}">
      <div class="group-head"><h3>${LABEL[r]}</h3><span class="mini"><i style="width:${(owned / keys.length) * 100}%"></i></span><span class="num">${owned} / ${keys.length}</span></div>
      <div class="grid">${items.map((it) => { const o = ownedOf(it.key); return cardHTML(it, { missing: !o, count: o?.count }); }).join('')}</div>
      ${more > 0 ? `<button class="btn small more" data-more="${r}">Voir ${more} de plus</button>` : ''}
    </section>`;
  }).join('');
  return sections || emptyColl();
}

function renderByLine(q, missing) {
  const rows = S.cat.lines.map((l) => {
    const ids = S.cat.byLine.get(l.id) || [];
    const its = ids.map((id) => item('SKIN', id)).filter((it) => it && playsRole(it.champ));
    const owned = its.filter((it) => lens().has(it.key));
    return { l, its, owned };
  }).filter(({ l, its, owned }) => its.length && (missing || owned.length)
    && (!q || l.name.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').includes(q) || its.some((it) => matches(it, q))))
    .sort((a, b) => (b.owned.length / b.its.length) - (a.owned.length / a.its.length) || b.owned.length - a.owned.length || a.l.name.localeCompare(b.l.name, 'fr'));
  if (!rows.length) return emptyColl();
  const limit = S.coll.limits.lines || 30;
  return `<div class="shelves">${rows.slice(0, limit).map(({ l, its, owned }) => {
    const complete = owned.length === its.length;
    // Possédés d'abord (du plus rare au plus commun), puis les manquants en ombre.
    const sorted = its.slice().sort((a, b) => (lens().has(b.key) - lens().has(a.key)) || rank(b.rarity) - rank(a.rarity));
    return `<section class="shelf${complete ? ' complete' : ''}">
      <div class="shelf-head"><h3>${esc(l.name)}</h3><span class="shelf-num"><b>${owned.length}</b> / ${its.length}${complete ? ' · complète' : ''}</span></div>
      <div class="shelf-row">${sorted.map((it) => { const o = ownedOf(it.key); return cardHTML(it, { missing: !o, count: o?.count }); }).join('')}</div>
    </section>`;
  }).join('')}</div>${rows.length > limit ? '<button class="btn small more" data-more="lines">Voir plus de gammes</button>' : ''}`;
}

function renderByChampion(q, missing) {
  const champs = S.cat.champions.map((c) => {
    const skins = S.cat.byChamp.get(c.id) || [];
    const ownedSkins = skins.filter((id) => lens().has(`SKIN:${id}`)).length;
    return { c, skins, ownedSkins, has: lens().has(`CHAMPION:${c.id}`) };
  }).filter(({ c, has, ownedSkins }) => (missing || has || ownedSkins) && playsRole(c) && (!q || c.name.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').includes(q)));
  if (!champs.length) return emptyColl();
  return `<div class="champ-grid">${champs.map(({ c, skins, ownedSkins, has }) => `
    <button class="champ${has ? ' owned' : ''}" data-champ="${c.id}" type="button">
      <span class="pic"><img loading="lazy" src="${esc(`${DD}/loading/${c.alias}_0.jpg`)}" alt=""></span>
      <span>${esc(c.name)}</span><span class="sk"><b>${ownedSkins}</b> / ${skins.length} skins</span>
    </button>`).join('')}</div>`;
}

function emptyColl() {
  const empty = S.friend ? `La collection de ${esc(S.friend.name)} est vide pour l'instant.` : 'Ta collection est vide : ouvre ta première relique !';
  return `<p class="empty-note">${lens().size ? 'Rien ne correspond. Active « Manquants » pour tout voir.' : empty}</p>`;
}

// ---------- Fiches ----------
function openSheet(html) { $('#sheet-body').innerHTML = html; $('#sheet').hidden = false; }
function closeSheet() { $('#sheet').hidden = true; }

function showItem(key) {
  const it = fromKey(key); if (!it) return;
  const o = ownedOf(key);
  const odds = S.cat.oddsBy.STANDARD[it.rarity];
  const chanceIn = (type) => (S.cat.oddsBy[type][it.rarity]?.percent ?? 0) / S.cat.byRarity[it.rarity].length;
  const fmt = (c) => (c === 0 ? '—' : `${c >= 0.01 ? c.toFixed(2) : c.toFixed(3)} %`);
  const lines = it.lines.map((l) => S.cat.line.get(l)).filter(Boolean);
  const p = it.champ?.profile;
  const lineRows = lines.map((l) => { const ids = S.cat.byLine.get(l.id) || []; const own = ids.filter((id) => lens().has(`SKIN:${id}`)).length;
    return `<button type="button" class="ln-row" data-goto-line="${l.id}"><span>Gamme ${esc(l.name)}</span><b>${own} / ${ids.length}</b></button>`; }).join('');
  openSheet(`<div class="skin-sheet r-${it.rarity}">
    <div class="ss-art" style="background-image:url('${esc(it.art)}')"></div>
    <div class="ss-body">
      <div class="ss-tags"><span class="tg r-${it.rarity}">${LABEL[it.rarity]}</span>${o?.count > 1 ? `<span class="tg">×${o.count}</span>` : ''}${it.legacy ? '<span class="tg">Héritage</span>' : ''}${o ? '' : '<span class="tg">Pas encore obtenu</span>'}</div>
      <h2>${esc(it.name)}</h2>
      <p class="muted">${it.kind === 'SKIN' ? esc(it.sub) : 'Champion'}${p ? ` · ${CURVE[p.curve].label} · ${STYLE[p.style].label}` : ''}</p>
      ${unitBlock(it, o)}
      ${lineRows ? `<div class="ln-list">${lineRows}</div>` : ''}
      <p class="ss-fine">Chance par relique ${fmt(chanceIn('STANDARD'))} · prestige ${fmt(chanceIn('PREMIUM'))}${o ? ` · obtenu le ${new Date(o.firstObtainedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} · doublon ${odds?.duplicateEssence ?? 0} essence` : ''}</p>
    </div></div>`);
}

/** Puissance d'une unité seule à un poste (rareté, poste, méta), comme dans teamPower. */
const unitPower = (it, i) => Math.round(100 * (1 + rank(it.rarity) * 0.02) * (1 + fitOf(it.champ, i) / 100) * (1 + metaOf(it.champ) / 100));

/** Bloc « en équipe » de la fiche : puissance au poste conseillé, bonus et bouton pour l'équiper. */
function unitBlock(it, o) {
  if (!it?.champ || S.friend) return '';
  const role = it.champ.profile?.main ?? 0;
  const up = o ? bestUpgrade(it) : null;
  const slot = up ? up.slot : role;
  const fit = fitOf(it.champ, slot), meta = metaOf(it.champ);
  const chip = (cls, txt) => `<span class="tchip ${cls}">${txt}</span>`;
  const equipped = S.roster?.some((x) => keyOf(x) === it.key);
  return `<div class="unit-block">
    <div class="ub-head"><span class="muted">Puissance en ${ROLES[slot]}</span><b class="num">${unitPower(it, slot)}</b></div>
    <div class="ub-chips">${it.champ.profile ? chip(fit > 0 ? 'p' : 'm', `${fit === FIT.main ? 'Poste principal' : fit === FIT.secondary ? 'Poste secondaire' : 'Hors poste'} ${signed(fit)} %`) : ''}
      ${meta ? chip(meta > 0 ? 'p' : 'm', `Méta ${signed(meta)} %`) : chip('z', 'Méta 0 %')}${it.champ.talent ? chip('z', `Talent ${esc(it.champ.talent.spell || '')}`) : ''}</div>
    ${o ? `<div class="ub-actions">${equipped ? '<span class="btn small" aria-disabled="true">Dans ton équipe</span>'
      : `<button class="btn primary small" type="button" data-equip-sheet="${slot}" data-key="${it.key}">Équiper en ${ROLES[slot]}${up ? ` · +${up.gain}` : ''}</button>`}
      <button class="btn small" type="button" data-avatar-champ="${it.champ.id}">Mettre en avatar</button></div>` : ''}
  </div>`;
}

function showChampion(id) {
  const c = S.cat.champ.get(id);
  const its = [item('CHAMPION', id), ...(S.cat.byChamp.get(id) || []).map((s) => item('SKIN', s))].filter(Boolean)
    .sort((a, b) => rank(b.rarity) - rank(a.rarity));
  const own = its.filter((it) => lens().has(it.key)).length;
  openSheet(`<div class="detail-body" style="margin-top:0;padding-top:22px">
    <h2>${esc(c.name)}</h2><p class="muted">${own} / ${its.length} obtenus</p>
    ${profileHTML(c.profile, true)}
    ${c.talent ? `<div class="talent-card"><span class="kicker">Talent d'arène</span>${talentHTML(c.talent, true)}</div>` : ''}
    <div class="grid">${its.map((it) => { const o = ownedOf(it.key); return cardHTML(it, { missing: !o, count: o?.count }); }).join('')}</div></div>`);
}

// Tableau comparatif : taux par type de capsule et essence d'un doublon (colonne du type choisi mise en avant).
function oddsHTML() {
  const pct = (type, r) => { const o = S.cat.oddsBy[type][r]; return o ? `${o.percent}%` : '—'; };
  const cls = (type) => (type === S.type ? 'sel' : 'dim');
  return `<span class="h name">Rareté</span><span class="h">Relique</span><span class="h prem">Prestige</span><span class="h">Doublon</span>
    ${[...RARITIES].reverse().map((r) => `<span class="name r-${r}">${LABEL[r]}</span>
      <span class="${cls('STANDARD')}">${pct('STANDARD', r)}</span><span class="${cls('PREMIUM')}">${pct('PREMIUM', r)}</span>
      <span>+${(S.cat.oddsBy.STANDARD[r] || S.cat.oddsBy.PREMIUM[r]).duplicateEssence}</span>`).join('')}`;
}

function oddsNote() {
  return `Prix en essence : relique ${S.cat.price.STANDARD}, prestige ${S.cat.price.PREMIUM}. « Doublon » : essence reçue quand l'objet est déjà dans ta collection. `
    + `Après ${S.cat.pityThreshold - 1} reliques sans Épique, la suivante est Épique ou mieux. La prestige ne contient pas de skin commun. Les champions sont le palier Exalté, le plus rare.`;
}

function renderOdds() {
  if (!S.cat) return;
  $('#odds-table').innerHTML = oddsHTML();
  $('#odds-note').textContent = oddsNote();
}

function showOdds() {
  openSheet(`<div class="odds"><h2>Taux de drop</h2><div class="odds-table">${oddsHTML()}</div><p class="odds-note">${esc(oddsNote())}</p></div>`);
}

function setType(type) {
  S.type = type;
  $$('.type-switch [data-type]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.type === type)));
  if (S.wallet) renderWallet();
  renderOdds();
}

// ---------- Roster et amis ----------
const ROLES = ['Top', 'Jungle', 'Mid', 'Bot', 'Support'];
const keyOf = (slot) => (slot ? (slot.loan ? `LOAN:${slot.itemId}` : `${slot.kind}:${slot.itemId}`) : null);

const ROLE_ICON = ['r-top', 'r-jgl', 'r-mid', 'r-bot', 'r-sup'];
const roleIcon = (i, cls = '') => `<svg viewBox="0 0 24 24" class="ricon ${cls}" aria-hidden="true"><use href="#${ROLE_ICON[i]}"/></svg>`;
const fullSlots = (slots) => Array.from({ length: 5 }, (_, k) => slots?.[k] ?? null);
const warnIcon = '<svg viewBox="0 0 24 24" class="wicon"><path d="M12 4 21 20H3z"/><path d="M12 10v4M12 17v.01"/></svg>';
/** Icône de combat (épées croisées) pour les actions qui lancent un duel. */
const SWORD_ICON = '<svg viewBox="0 0 24 24" class="fight-ic" aria-hidden="true"><use href="#cls-FIGHTER"/></svg>';
const boltIcon = '<svg viewBox="0 0 24 24" class="wicon ok"><path d="M13 3 5 14h6l-1 7 8-11h-6z"/></svg>';

/** Malus de composition à corriger (frontline, dégâts, protection) et bonus de gamme, en lignes courtes. */
function teamNotes(its) {
  const filled = its.filter(Boolean);
  const notes = [];
  if (filled.length < 5) notes.push(['warn', `Encore ${5 - filled.length} poste${filled.length < 4 ? 's' : ''} à remplir pour entrer dans l'arène`]);
  else teamNeeds(its).filter((x) => !x.ok).forEach((x) => notes.push(['warn', x.tip.replace(/^Ajoute [^:]+ : /, '').replace(/^sans /, 'Sans ')]));
  if (new Set(filled.map((it) => it.champ.id)).size < filled.length) notes.push(['warn', 'Champion en double : −10 % pour toute l\'équipe']);
  const lines = {};
  filled.forEach((it) => new Set(it.lines).forEach((l) => { lines[l] = (lines[l] || 0) + 1; }));
  const [bl, bn] = Object.entries(lines).sort((a, b) => b[1] - a[1])[0] || [];
  if (bn >= 2) notes.push(['ok', `Gamme ${esc(S.cat.line.get(+bl)?.name || '')} ×${bn} : +${3 * (bn - 1)} % à toute l'équipe`]);
  return notes;
}
const notesHTML = (notes) => notes.map(([k, t]) => `<div class="tnote ${k}">${k === 'ok' ? boltIcon : warnIcon}<span>${t}</span></div>`).join('');

/** Pièce maîtresse d'une équipe : la plus rare, le mid en cas d'égalité. Son splash sert de fond à la bannière. */
function teamLead(its) {
  let best = -1;
  its.forEach((it, i) => {
    if (!it) return;
    if (best < 0 || rank(it.rarity) > rank(its[best].rarity) || (rank(it.rarity) === rank(its[best].rarity) && i === 2)) best = i;
  });
  return best;
}

/**
 * Bannière d'équipe façon boss : splash de la pièce maîtresse en fond, nom et puissance en grand, cinq portraits avec leur poste.
 * side : 'me' (bleu) ou 'them' (rouge). editable : portraits et bouton Composer ouvrent le compositeur.
 */
function teamBannerHTML(its, { kicker = '', name = '', power = 0, side = 'me', editable = false, vs = null, foot = '' } = {}) {
  const lead = teamLead(its);
  const L = its[lead];
  const filled = its.filter(Boolean).length;
  const tag = editable ? 'button' : 'div';
  const ports = its.map((it, i) => `<${tag} class="tb-p${it ? ` r-${it.rarity}` : ' empty'}${i === lead ? ' lead' : ''}" ${editable ? `type="button" data-compose="${i}"` : ''}
      aria-label="${ROLES[i]}${it ? ` : ${esc(it.name)}` : ' libre'}">
      ${it ? `<img loading="lazy" src="${esc(it.art)}" ${it.fb ? `data-fb="${esc(it.fb)}"` : ''} alt="">` : '<b class="tplus">+</b>'}${roleIcon(i)}</${tag}>`).join('');
  const gap = vs ? power - vs : 0;
  const cmp = !vs ? '' : `<span class="tb-cmp ${gap > 0 ? 'up' : gap < 0 ? 'down' : ''}">${gap ? `${signed(gap)} vs toi` : 'même puissance'}</span>`;
  return `<section class="tbanner ${side}">
    ${L ? `<img class="tb-art" src="${esc(L.splash)}" data-fb="${esc(L.art)}" alt="">` : ''}
    <div class="tb-top">
      <div class="tb-id"><span class="kicker">${kicker}</span><h2>${esc(name)}</h2>
        ${L ? `<span class="tb-lead">${esc(L.name)}<i class="r-${L.rarity}">${LABEL[L.rarity]}</i></span>` : `<span class="tb-lead">${filled} / 5 postes</span>`}</div>
      <div class="tb-pow"><b class="num">${fmtInt(power)}</b><span>Puissance</span>${cmp}</div>
    </div>
    <div class="tb-row">${ports}</div>
    ${foot}
  </section>`;
}

function renderRoster() {
  const friend = S.friend;
  const slots = friend ? friend.roster : S.roster;
  const editable = !friend;
  const its = rosterItems(fullSlots(slots));
  const team = !friend && S.teams?.[S.activeTeam];
  $('#roster').innerHTML = teamBannerHTML(its, {
    kicker: friend ? 'Son équipe' : `Mon équipe${team?.name ? ` · ${esc(team.name)}` : ''}`, name: friend ? friend.name : (S.user?.displayName || 'Moi'),
    power: teamPower(its), side: friend ? 'them' : 'me', editable,
    foot: editable ? `<div class="tb-foot"><div class="tb-notes">${notesHTML(teamNotes(its).slice(0, 2))}</div>
      <button class="btn primary small" type="button" data-compose="0">Composer</button></div>` : '' });
  $('#team-coach').innerHTML = '';
  if ($('#composer') && !$('#composer').hidden) drawComposer();
}

// ---------- Aide à la composition (miroir des règles du serveur, BattleRules) ----------
const FIT = { main: 12, secondary: 8, off: -10 };
const fitOf = (c, role) => (!c?.profile ? 0 : c.profile.main === role ? FIT.main : c.profile.secondary === role ? FIT.secondary : FIT.off);
const primaryClass = (c) => c?.roles?.[0];

/** Bonus de méta d'un champion en % (patch de la semaine, miroir de Meta.Bonus) : son changement et celui de sa classe principale. */
function metaOf(c) {
  const cls = primaryClass(c)?.toUpperCase();
  const m = (S.meta?.changes || []).filter((x) => (x.target === 'CHAMPION' && x.championId === c?.id) || (x.target === 'CLASS' && x.class === cls))
    .reduce((acc, x) => acc * (1 + x.percent / 100), 1);
  return Math.round((m - 1) * 100);
}
const metaTag = (c, cls = 'meta-tag') => { const m = metaOf(c); return m ? `<span class="${cls} ${m > 0 ? 'up' : 'down'}" title="Patch de la semaine">${m > 0 ? '▲' : '▼'} ${signed(m)} %</span>` : ''; };
const rosterItems = (slots) => slots.map(slotItem);

/** Puissance comme au combat : rareté, poste, gamme commune et champion en double. */
function teamPower(its) {
  const filled = its.filter(Boolean);
  const lines = {};
  filled.forEach((it) => new Set(it.lines).forEach((l) => { lines[l] = (lines[l] || 0) + 1; }));
  const best = Math.max(0, ...Object.values(lines));
  let bonus = best >= 2 ? 0.03 * (best - 1) : 0;
  if (new Set(filled.map((it) => it.champ.id)).size < filled.length) bonus -= 0.10;
  return its.reduce((sum, it, i) => sum + (it ? Math.round(100 * (1 + rank(it.rarity) * 0.02) * (1 + fitOf(it.champ, i) / 100) * (1 + bonus) * (1 + metaOf(it.champ) / 100)) : 0), 0);
}

/** Besoins de composition en teamfight : frontline, dégâts, protection ou engage. */
function teamNeeds(its) {
  const cs = its.filter(Boolean).map((it) => it.champ);
  return [
    { label: 'Frontline', ok: cs.some((c) => ['tank', 'fighter'].includes(primaryClass(c)) || c.roles.includes('tank')), tip: 'Ajoute un tank ou un combattant : sans frontline, −10 % en teamfight.' },
    { label: 'Dégâts', ok: cs.some((c) => ['marksman', 'mage', 'assassin'].includes(primaryClass(c))), tip: 'Ajoute un tireur, un mage ou un assassin : sans dégâts, −10 % en teamfight.' },
    { label: 'Protection', ok: cs.some((c) => c.roles.includes('support') || primaryClass(c) === 'tank'), tip: 'Ajoute un soutien ou un tank : sans protection ni engage, −5 % en teamfight.' },
  ];
}

function curveVerdict(its) {
  const n = { EARLY: 0, MID: 0, LATE: 0 };
  its.forEach((it) => { if (it?.champ.profile) n[it.champ.profile.curve]++; });
  if (n.EARLY >= 3) return 'Équipe early : écrase les lanes et conclus avant les derniers teamfights.';
  if (n.LATE >= 3) return 'Équipe late : tiens la phase de lanes, les derniers teamfights sont à toi.';
  if (n.MID >= 3) return 'Équipe mid : pic de puissance autour des dragons et du premier teamfight.';
  return 'Courbe équilibrée : présente à chaque phase de la partie.';
}

function coachHTML(slots) {
  const its = rosterItems(slots);
  const filled = its.filter(Boolean);
  if (!filled.length) return '<p class="coach-empty">Place tes champions : l\'analyse de l\'équipe s\'affiche ici.</p>';
  const needs = teamNeeds(its);
  const count = (style) => filled.filter((it) => it.champ.profile?.style === style).length;
  const tips = [
    ...its.map((it, i) => it && fitOf(it.champ, i) < 0
      && `${esc(it.champ.name)} est hors poste en ${ROLES[i]} (−10 %). Son poste : ${ROLES[it.champ.profile.main]}.`),
    new Set(filled.map((it) => it.champ.id)).size < filled.length && 'Champion en double : −10 % pour toute l\'équipe.',
    ...filled.map((it) => metaOf(it.champ) < 0 && `${esc(it.champ.name)} est nerfé cette semaine (${signed(metaOf(it.champ))} %).`),
    filled.length === 5 && needs.find((x) => !x.ok)?.tip,
    filled.length < 5 && `Encore ${5 - filled.length} poste${filled.length < 4 ? 's' : ''} à remplir pour entrer dans l'arène.`,
  ].filter(Boolean);
  const bonus = [count('TEAMFIGHT') >= 3 && 'comp teamfight +5 %', count('SOLO') >= 2 && 'split-push'].filter(Boolean);
  return `<div class="coach">
    <div class="coach-head"><span class="kicker">Analyse de l'équipe</span><span class="power">Puissance <b>${teamPower(its)}</b></span></div>
    <div class="coach-links">${S.meta?.changes.length ? `<button class="btn ghost small" type="button" id="coach-meta">Patch ${S.meta.number} : buffs et nerfs</button>` : ''}
      <button class="btn ghost small" type="button" id="coach-guide">Guide des règles</button></div>
    <div class="coach-needs">${needs.map((x) => `<span class="need ${x.ok ? 'ok' : 'ko'}">${x.ok ? '✓' : '✗'} ${x.label}</span>`).join('')}</div>
    <div class="coach-curve">${its.map((it, i) => { const p = it?.champ.profile; return `<span class="cv" style="--pc:${p ? CURVE[p.curve].color : 'var(--line-2)'}"><i></i><em>${ROLES[i]}</em><b>${p ? CURVE[p.curve].label : '—'}</b><small>${p ? STYLE[p.style].label : ''}</small></span>`; }).join('')}</div>
    <p class="coach-verdict">${curveVerdict(its)}${bonus.length ? ` Bonus : ${bonus.join(', ')}.` : ''}</p>
    ${tips.length ? `<ul class="coach-tips">${tips.map((t) => `<li>${t}</li>`).join('')}</ul>` : '<p class="coach-ok">Tout le monde est à son poste et la compo est complète.</p>'}
  </div>`;
}

// Sélecteur d'un poste : chaque candidat avec son gain réel de puissance pour l'équipe et la raison en une ligne.
function showSlotPicker(index) {
  const current = keyOf(S.roster[index]);
  const used = new Set(fullSlots(S.roster).map(keyOf).filter((k) => k && k !== current));
  const taken = new Set(fullSlots(S.roster).map((sl, i) => i !== index && slotItem(sl)?.champ.id).filter(Boolean));
  const loans = [...rotationIds()].filter((id) => !S.owned.has(`CHAMPION:${id}`)).map(loanItem);
  const cur = rosterItems(fullSlots(S.roster)), base = teamPower(cur);
  const needsBefore = teamNeeds(cur);
  const rows = [...S.owned.keys()].map(fromKey).concat(loans).filter((it) => it && !used.has(it.key)).map((it) => {
    const next = cur.slice(); next[index] = it;
    const gain = teamPower(next) - base;
    const fit = fitOf(it.champ, index), meta = metaOf(it.champ);
    const fixes = needsBefore.filter((x, k) => !x.ok && teamNeeds(next)[k].ok).map((x) => x.label.toLowerCase());
    const why = [
      CLASS[primaryClass(it.champ)?.toUpperCase()]?.label,
      fixes.length ? `<span class="up">corrige ${fixes.join(', ')}</span>` : '',
      meta > 0 ? `<span class="up">buff ${signed(meta)} %</span>` : meta < 0 ? `<span class="down">nerf ${signed(meta)} %</span>` : '',
      it.champ.profile && fit < 0 ? `<span class="down">hors poste −10 %</span>` : '',
      taken.has(it.champ.id) ? '<span class="down">déjà dans l\'équipe</span>' : '',
      it.loan ? 'prêt de la semaine' : '',
    ].filter(Boolean).join(' · ');
    return { it, gain, fit, meta, why, sel: it.key === current };
  }).sort((a, b) => b.sel - a.sel || b.gain - a.gain || rank(b.it.rarity) - rank(a.it.rarity));
  const row = (r) => `<button type="button" class="pk-row${r.sel ? ' sel' : ''}" data-pick="${r.it.key}" data-slot-index="${index}" data-f="${r.fit === FIT.main ? 'main' : ''} ${r.meta > 0 ? 'buff' : ''}" data-q="${esc(`${r.it.name} ${r.it.sub}`.toLowerCase().normalize('NFD').replace(/\p{M}/gu, ''))}">
      <span class="pk-art r-${r.it.rarity}"><img loading="lazy" src="${esc(r.it.splash)}" alt=""></span>
      <span class="pk-txt"><b>${esc(r.it.name)} <em class="tg r-${r.it.rarity}">${LABEL[r.it.rarity]}</em>${r.sel ? ' <em class="tg eq">équipé</em>' : ''}</b><span>${r.why}</span></span>
      <span class="pk-gain"><b class="num ${r.sel ? '' : r.gain > 0 ? 'up' : r.gain < 0 ? 'down' : ''}">${r.sel ? '—' : `${r.gain > 0 ? '+' : r.gain < 0 ? '−' : ''}${Math.abs(r.gain)}`}</b><small>${base + (r.sel ? 0 : r.gain)}</small></span></button>`;
  openSheet(`<div class="picker2">
    <div class="pk-head">${roleIcon(index, 'big')}<h2>${ROLES[index]}</h2><span class="muted">équipe ${base}</span></div>
    <div class="pk-chips" role="group"><button type="button" data-pk="" aria-pressed="true">Meilleurs</button><button type="button" data-pk="main" aria-pressed="false">Poste principal</button><button type="button" data-pk="buff" aria-pressed="false">Buffés</button></div>
    ${rows.length > 8 ? '<input type="search" id="pick-search" placeholder="Rechercher dans ta collection" autocomplete="off">' : ''}
    ${current ? `<button class="btn small pk-clear" type="button" data-pick-clear="${index}">Retirer du poste</button>` : ''}
    <div class="pk-list">${rows.length ? rows.map(row).join('') : '<p class="empty-note">Ouvre des reliques pour remplir ton équipe.</p>'}</div>
  </div>`);
  let f = '', q = '';
  const apply = () => $$('.pk-row').forEach((r) => { r.hidden = (f && !r.dataset.f.includes(f)) || (q && !r.dataset.q.includes(q)); });
  $$('[data-pk]').forEach((b) => (b.onclick = () => { f = b.dataset.pk; $$('[data-pk]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); apply(); }));
  $('#pick-search')?.addEventListener('input', (e) => { q = e.target.value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').trim(); apply(); });
}

function pickCard(it, index, { selected = false, best = false, dup = false } = {}) {
  const p = it.champ.profile;
  const tags = `<span class="pick-tags">${it.loan ? '<span class="pick-loan">Prêt</span>' : ''}${best ? '<span class="pick-best">Conseillé</span>' : ''}${dup ? '<span class="pick-dup">Déjà pris</span>' : ''}${metaTag(it.champ)}
    ${p ? `<span class="ptag" style="--pc:${CURVE[p.curve].color}">${CURVE[p.curve].label}</span><span class="ptag">${STYLE[p.style].label}</span>` : ''}</span>`;
  return cardHTML(it, { count: 0 }).replace('class="card ', `class="card pick${selected ? ' selected' : ''}${dup ? ' dup' : ''} `)
    .replace(`data-key="${it.key}"`, `data-key="${it.key}" data-pick="${it.key}" data-slot-index="${index}"`)
    .replace(/<\/button>\s*$/, `${tags}</button>`);
}

async function setSlot(index, key) {
  const slots = Array.from({ length: 5 }, (_, i) => S.roster?.[i] ?? null).map((s) => (s ? { kind: s.kind, itemId: s.itemId, loan: !!s.loan } : null));
  slots[index] = key ? (([kind, id]) => (kind === 'LOAN' ? { kind: 'CHAMPION', itemId: +id, loan: true } : { kind, itemId: +id }))(key.split(':')) : null;
  await saveRoster(slots);
}

async function saveRoster(slots) {
  try {
    S.roster = await api('/capsules/roster', { method: 'PUT', body: { slots } });
    if (S.teams[S.activeTeam]) S.teams[S.activeTeam].slots = S.roster;
    closeSheet(); renderRoster(); buzz(20);
  } catch (e) { toast(e.message, true); }
}

// Étiquette de la honte : perdre contre le compte de test.
const shameTag = () => "Paillasson d'AmiTest";
const shameTitle = (account, n) => `Paillasson d'${esc(account)}${n > 1 ? ` ×${n}` : ''}`;

function applyTeams(t) { S.teams = t.teams; S.activeTeam = t.active; S.roster = t.roster; }

/** Équipes enregistrées : changer d'équipe change aussi la défense ; l'équipe active se renomme. */
async function selectTeam(i) {
  if (i === S.activeTeam) { renameTeam(i); return; }
  try {
    applyTeams(await api(`/capsules/teams/${i}/select`, { method: 'POST' }));
    renderRoster(); buzz(20);
    if (S.view === 'arena') loadArena({ quiet: true });
    toast(`${S.teams[i].name} part au combat (et défend).`);
    if (S.arena) loadArena({ quiet: true });
  } catch (e) { toast(e.message, true); }
}

function renameTeam(i) {
  openSheet(`<form class="picker" id="team-rename"><h2>Renommer l'équipe</h2>
    <input id="team-name" maxlength="20" value="${esc(S.teams[i].name)}" autocomplete="off" required>
    <button class="btn primary block" type="submit">Enregistrer</button></form>`);
  const input = $('#team-name'); input.focus(); input.select();
  $('#team-rename').onsubmit = async (e) => {
    e.preventDefault();
    try { applyTeams(await api(`/capsules/teams/${i}/name`, { method: 'PUT', body: { name: input.value } })); closeSheet(); renderRoster(); }
    catch (err) { toast(err.message, true); }
  };
}

function avatarHTML(p) {
  return `<span class="avatar${p.frame || p.legend ? ' framed' : ''}${p.legend ? ' legend' : ''}"${frameAttrs(p.frame, p.legend)}>${avatarInner(p)}</span>`;
}

/** Cadre de l'icône : palier final du joueur à la saison passée ; Légende = pass de saison terminé (cadre animé). */
const LEGEND_COLOR = '#ffd36b';
const frameTitle = (tier, legend) => [tier && `${TIER[tier].label} la saison passée`, legend && 'Légende : pass de saison terminé'].filter(Boolean).join(' · ');
const frameAttrs = (tier, legend = false) => (tier || legend ? ` style="--fc:${tier ? TIER[tier].color : LEGEND_COLOR}" title="${frameTitle(tier, legend)}"` : '');
function setFrame(el, tier, legend = false) {
  el.classList.toggle('framed', !!(tier || legend));
  el.classList.toggle('legend', !!legend);
  if (tier || legend) { el.style.setProperty('--fc', tier ? TIER[tier].color : LEGEND_COLOR); el.title = frameTitle(tier, legend); } else { el.style.removeProperty('--fc'); el.removeAttribute('title'); }
}

// ---------- Icône de profil : un champion au choix ----------
const avatarSrc = (p) => (p.avatarChampionId ? `${CD}v1/champion-icons/${+p.avatarChampionId}.png`
  : p.profileIconId ? `https://ddragon.leagueoflegends.com/cdn/img/profileicon/${+p.profileIconId}.png` : null);
const fold = (s) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').trim();

/** Choix de l'icône ; forcé (sans fermeture possible) tant que le joueur n'en a pas. Résolu une fois l'icône enregistrée ou la feuille fermée. */
function showAvatarPicker(force = false) {
  const champs = [...S.cat.champions].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const current = S.user?.avatarChampionId;
  $('#sheet').classList.toggle('locked', force);
  openSheet(`<div class="picker avatar-picker">
    <h2>${force ? 'Choisis ton icône' : 'Changer d\'icône'}</h2>
    <p class="muted">Le champion choisi s'affiche à côté de ton nom : classement, arène, amis.</p>
    <input type="search" id="avatar-search" placeholder="Rechercher un champion" autocomplete="off">
    <div class="avatar-grid">${champs.map((c) => `<button type="button" class="avatar-opt${c.id === current ? ' selected' : ''}" data-avatar="${c.id}" title="${esc(c.name)}" aria-label="${esc(c.name)}">
      <img loading="lazy" src="${CD}v1/champion-icons/${c.id}.png" alt=""><span>${esc(c.name)}</span></button>`).join('')}</div>
  </div>`);
  $('#avatar-search').addEventListener('input', (e) => {
    const q = fold(e.target.value);
    $$('.avatar-opt').forEach((b) => { b.hidden = !!q && !fold(b.title).includes(q); });
  });
  let saving = false;
  return new Promise((resolve) => {
    $$('.avatar-opt').forEach((b) => (b.onclick = async () => {
      if (saving) return;
      saving = true;
      try {
        setUser(await api('/capsules/avatar', { method: 'PUT', body: { championId: +b.dataset.avatar } }));
        $('#sheet').classList.remove('locked'); closeSheet(); buzz(20);
        if (S.view === 'arena') loadArena({ quiet: true });
        resolve();
      } catch (e) { toast(e.message, true); } finally { saving = false; }
    }));
    const wait = setInterval(() => { if ($('#sheet').hidden) { clearInterval(wait); resolve(); } }, 300);
  });
}

function setUser(user) {
  S.user = user;
  store.set('capsules.user', JSON.stringify(user));
  $('#menu-user').innerHTML = `<span class="avatar">${avatarInner(user)}</span><span><b>${esc(user.displayName)}</b>${esc(user.email)}</span>`;
  renderMe();
}

/** Carte du profil : cote, rang et collection en un coup d'œil. */
function renderMe() {
  const el = $('#me-stats'); if (!el) return;
  const a = S.arena, owned = S.owned?.size || 0, st = S.myStats;
  const cell = (v, l) => `<div><b>${v}</b><span>${l}</span></div>`;
  el.innerHTML = (a ? cell(fmtInt(a.rating), a.rank ? `cote · #${a.rank}` : 'cote') + cell(`${a.wins}–${a.losses}`, 'victoires – défaites') : '') + (owned ? cell(fmtInt(owned), 'objets collectionnés') : '');
  const extra = $('#me-extra');
  if (!extra || !st) return;
  const form = (st.form || []).slice(-10);
  const sig = st.signature && item(st.signature.kind, st.signature.itemId);
  extra.innerHTML = `${form.length ? `<div class="me-form"><span class="kicker">Forme · ${form.length} derniers</span>
      <div class="form-row">${form.map((w) => `<i class="${w ? 'w' : 'l'}"></i>`).join('')}</div>
      <span class="muted">Série en cours : <b>${st.streak > 0 ? `${st.streak} victoire${st.streak > 1 ? 's' : ''}` : st.streak < 0 ? `${-st.streak} défaite${st.streak < -1 ? 's' : ''}` : '—'}</b> · record ${st.bestStreak}</span></div>` : ''}
    ${sig ? `<div class="me-sig"><img src="${esc(sig.art)}" alt=""><div><span class="kicker">Ta signature</span><b>${esc(sig.name)}</b><span class="muted">${st.signature.games} parties · ${st.signature.wins} victoires</span></div></div>` : ''}
    ${st.nemesis ? `<div class="me-sig nemesis"><span class="kicker">Bête noire</span><b>${esc(st.nemesis.displayName)}</b><span class="muted">${st.nemesis.count} défaite${st.nemesis.count > 1 ? 's' : ''} contre</span></div>` : ''}`;
}

function friendHTML(p) {
  const total = S.cat ? RARITIES.reduce((s, r) => s + S.cat.byRarity[r].length, 0) : 0;
  const pct = total ? Math.round((p.owned / total) * 1000) / 10 : 0;
  return `<div class="friend">
    <button class="friend-main" data-profile="${p.userId}" type="button">
      <span class="fring" style="--tc:${p.frame ? TIER[p.frame].color : 'var(--line-2)'}">${avatarInner(p)}</span>
      <span class="who"><b>${esc(p.displayName)}</b><span>${fmtInt(p.owned)} objets · ${String(pct).replace('.', ',')} %</span></span>
    </button>
    ${p.added ? `<button class="icon-btn" data-unfriend="${p.userId}" aria-label="Retirer ${esc(p.displayName)}"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`
      : `<button class="btn small" data-befriend="${p.userId}">Ajouter</button>`}
  </div>`;
}

/** Bande de potes en haut du Club : anneau à la couleur de leur palier, liseré animé s'ils ont un gros tirage récent. */
function renderStories(added) {
  const fresh = new Set((S.feed || []).filter((f) => f.kind === 'DROP' && now() - Date.parse(f.at) < 864e5).map((f) => f.player.userId));
  $('#stories').innerHTML = `<button class="story add" type="button" id="story-add"><span class="sring"><b>+</b></span><span>Ajouter</span></button>`
    + added.map((p) => `<button class="story${fresh.has(p.userId) ? ' fresh' : ''}" type="button" data-profile="${p.userId}">
      <span class="sring" style="--tc:${p.frame ? TIER[p.frame].color : 'var(--line-2)'}">${avatarInner(p)}</span><span>${esc(p.displayName)}</span></button>`).join('');
  $('#story-add').onclick = () => { const q = $('#friend-query'); q.focus(); q.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
}

const feedAgo = (iso) => ago(iso);

function feedItemHTML(f) {
  if (f.kind === 'DROP') {
    const it = item(f.itemKind, f.itemId); if (!it) return '';
    const mine = S.owned.has(it.key);
    return `<article class="fcard fdrop r-${it.rarity}">
      <div class="fc-art" style="background-image:url('${esc(it.splash)}'), url('${esc(it.art)}')"><span class="fc-rar">${LABEL[it.rarity]}</span></div>
      <div class="fc-body"><span class="fc-av">${avatarInner(f.player)}</span>
        <div class="fc-txt"><b>${esc(f.player.displayName)}</b> a tiré <b>${esc(it.name)}</b><span>${feedAgo(f.at)}${mine ? '' : ' · tu ne l\'as pas'}</span></div>
        <button class="btn small" type="button" data-player="${f.player.userId}">Sa collection</button></div>
    </article>`;
  }
  const me = S.user?.id;
  const [w, l] = f.attackerWon ? [f.attacker, f.defender] : [f.defender, f.attacker];
  const text = w.userId === me ? `Tu as battu <b>${esc(l.displayName)}</b>` : l.userId === me ? `<b>${esc(w.displayName)}</b> t'a battu` : `<b>${esc(w.displayName)}</b> a battu <b>${esc(l.displayName)}</b>`;
  const tone = w.userId === me ? 'win' : l.userId === me ? 'loss' : '';
  return `<article class="fcard fbattle ${tone}">
    <div class="fc-body"><span class="fc-duo"><span class="fc-av">${avatarInner(w)}</span><span class="fc-av">${avatarInner(l)}</span></span>
      <div class="fc-txt">${text}<span>${feedAgo(f.at)}</span></div>
      <button class="btn small" type="button" data-battle="${f.battleId}">Revoir</button></div>
  </article>`;
}

async function loadFeed() {
  try {
    S.feed = await api('/capsules/feed');
    $('#feed').innerHTML = S.feed.length ? S.feed.map(feedItemHTML).join('')
      : '<p class="empty-note">Rien cette semaine. Les gros tirages et les combats de tes potes apparaîtront ici.</p>';
    if (S.friends) renderStories(S.friends.filter((p) => p.added));
    if (S.view === 'friends') ambientFor('friends');
  } catch (e) { $('#feed').innerHTML = `<p class="empty-note">${esc(e.message)}</p>`; }
}

/** Ta bête noire du moment (stats du profil) : la revanche à un geste. */
async function loadRival() {
  const el = $('#rival-card');
  try {
    const st = await api(`/capsules/players/${S.user.id}/stats`);
    S.myStats = st;
    // Seulement une défaite non vengée contre un joueur défiable maintenant (calculé par le serveur).
    const n = st.revenge;
    if (!n) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `<div class="rv-top"><span class="kicker">Rivalité</span><span class="muted">dernier duel perdu</span></div>
      <div class="rv-main"><div class="rv-txt"><b>Toi contre ${esc(n.displayName)}</b><span>${n.count} défaite${n.count > 1 ? 's' : ''} contre ${esc(n.displayName)}, à toi de répondre</span></div>
      <b class="num rv-score">${n.count}</b></div>
      <button class="btn primary block" type="button" data-foe="${n.userId}">${SWORD_ICON}Prendre ma revanche</button>`;
  } catch { el.hidden = true; }
}

async function loadFriends() {
  try {
    loadFeed(); loadRival();
    const list = await api('/capsules/friends');
    S.friends = list;
    const added = list.filter((p) => p.added);
    renderStories(added);
    const met = list.filter((p) => !p.added);
    $('#friends-count').textContent = added.length ? `${added.length}` : '';
    $('#friends-list').innerHTML = added.length ? added.map(friendHTML).join('')
      : '<p class="empty-note">Ajoute un ami avec son Riot ID ou son pseudo pour voir sa collection et son roster.</p>';
    $('#suggest-block').hidden = !met.length;
    $('#suggest-list').innerHTML = met.map(friendHTML).join('');
  } catch (e) { toast(e.message, true); }
}

async function addFriend(body) {
  try {
    const p = await api('/capsules/friends', { method: 'POST', body });
    toast(`${p.displayName} ajouté à tes amis`);
    await loadFriends();
    return p;
  } catch (e) { toast(e.message, true); return null; }
}

async function openPlayer(userId) {
  try {
    const res = await api(`/capsules/players/${userId}`);
    S.friend = { userId, name: res.player.displayName, added: res.player.added, roster: res.player.roster,
      owned: new Map(res.items.map((i) => [`${i.kind}:${i.itemId}`, i])) };
    S.coll.rarity = null;
    setView('collection', { friend: true });
  } catch (e) { toast(e.message, true); }
}

// ---------- Profil public : palmarès et statistiques d'arène, visible par tous ----------
const pctOf = (w, l) => (w + l ? Math.round((w / (w + l)) * 100) : 0);

/** Titres honorifiques gagnés, du plus prestigieux au plus modeste ; toujours au moins un. */
function profileTitles(s, collPct) {
  const games = s.wins + s.losses;
  const top = s.rank ? Math.ceil((s.rank / s.ranked) * 100) : null;
  return [
    s.titles && [`Champion de saison ${(s.titleSeasons || []).map((n) => `S${n}`).join(' · ')}`.trim(), 'gold'],
    s.legendSeasons?.length && [`Légende ${s.legendSeasons.map((n) => `S${n}`).join(' · ')}`, 'gold'],
    s.rank === 1 && ['Numéro 1 du classement', 'gold'],
    s.podiums > s.titles && ['Habitué des podiums', 'gold'],
    top && top <= 10 && s.ranked >= 5 && [`Top ${top} % des joueurs`, 'gold'],
    games >= 3 && !s.losses && ['Invaincu', 'gold'],
    s.bestStreak >= 5 && [`Série infernale (${s.bestStreak})`, 'hot'],
    s.streak >= 3 && ['En feu', 'hot'],
    s.bestUpset?.gap >= 100 && ['Tueur de géants', 'hot'],
    s.flawless && [`Partie parfaite${s.flawless > 1 ? ` ×${s.flawless}` : ''}`, 'hot'],
    s.aces >= 5 && ['Roi de l\'ACE', 'hot'],
    s.defenseWins >= 5 && pctOf(s.defenseWins, s.defenseLosses) >= 60 && ['Forteresse imprenable', ''],
    s.attackWins >= 10 && ['Conquérant', ''],
    games >= 5 && s.firstBloods / games >= 0.6 && ['Premier sang', ''],
    s.kills >= 100 && ['Machine à kills', ''],
    collPct >= 30 && ['Grand collectionneur', ''],
    games >= 50 && ['Vétéran de l\'arène', ''],
    s.shameLosses && [shameTitle(s.shameAccount, s.shameLosses), 'shame'],
    s.rank && s.ranked >= 4 && s.rank === s.ranked && ['Lanterne rouge', 'shame'],
    s.defenseLosses >= 5 && !s.defenseWins && ['Passoire : 0 défense tenue', 'shame'],
    s.streak <= -5 && [`Série noire (${-s.streak} D)`, 'shame'],
    games >= 20 && pctOf(s.wins, s.losses) < 35 && ['Abonné aux défaites', 'shame'],
  ].filter(Boolean).concat(games ? [] : [['Talent en devenir', '']]);
}

async function showProfile(userId) {
  try {
    const [s, coll] = await Promise.all([api(`/capsules/players/${userId}/stats`), api(`/capsules/players/${userId}`).catch(() => null)]);
    if (!S.cat) await loadCatalog();
    const p = s.player;
    const me = userId === S.user?.id;
    const games = s.wins + s.losses;
    const total = RARITIES.reduce((n, r) => n + S.cat.byRarity[r].length, 0);
    const collPct = total ? Math.round((p.owned / total) * 1000) / 10 : 0;
    const gem = (coll?.items || []).filter((i) => i.kind === 'SKIN').map((i) => item(i.kind, i.itemId)).filter(Boolean)
      .sort((a, b) => rank(b.rarity) - rank(a.rarity))[0];
    const top = s.rank ? Math.ceil((s.rank / s.ranked) * 100) : null;
    const team = rosterItems(fullSlots(me ? S.roster : coll?.player?.roster));
    const fact = (v, label) => `<div><b>${v}</b><span>${label}</span></div>`;
    const sec = (title, body) => `<section class="pf-sec"><span class="kicker">${title}</span>${body}</section>`;
    const champ = (c, label, line) => {
      const it = c && item(c.kind, c.itemId);
      return c ? `<div class="pf-champ">${it ? `<img loading="lazy" class="r-${it.rarity}" src="${esc(it.art)}" ${it.fb ? `data-fb="${esc(it.fb)}"` : ''} alt="">` : ''}
        <span><span class="kicker">${label}</span><b>${esc(c.champion)}</b><small>${line(c)}</small></span></div>` : '';
    };
    const rival = (r, label, line, cls = '') => (r ? `<button class="pf-rival ${cls}" type="button" data-profile="${r.userId}">
      <span class="kicker">${label}</span><b>${esc(r.displayName)}</b><small>${line(r)}</small></button>` : '');
    const streak = s.streak > 0 ? `${s.streak} V` : s.streak < 0 ? `${-s.streak} D` : '—';

    openSheet(`<div class="pf" style="--tc:${TIER[s.tier].color}">
      <div class="pf-hero">
        <span class="fring pf-ring" style="--tc:${TIER[s.tier].color}">${avatarInner(p)}</span>
        <div class="pf-id"><h2>${esc(p.displayName)}</h2>
          <div class="pf-tags"><span class="tg" style="--rc:${TIER[s.tier].color}">${TIER[s.tier].label}</span><span class="muted">${fmtInt(s.rating)}${s.rank ? ` · #${s.rank} sur ${s.ranked}` : ''}</span></div>
          <span class="muted pf-best">record ${fmtInt(s.bestRating)}${top && s.rank > 1 && top <= 50 ? ` · top ${top} %` : ''}</span></div>
      </div>
      <div class="pf-titles">${profileTitles(s, collPct).map(([t, c]) => `<span class="pf-title ${c}">${t}</span>`).join('')}</div>
      ${team.some(Boolean) ? teamBannerHTML(team, { kicker: me ? 'Mon équipe' : 'Son équipe', name: p.displayName, power: teamPower(team), side: me ? 'me' : 'them',
        vs: me || !S.roster ? null : teamPower(rosterItems(fullSlots(S.roster))) }) : ''}
      ${games ? `
      ${sec('Bilan', `<div class="pf-big"><b>${pctOf(s.wins, s.losses)} %</b><span>de victoires sur ${games} combat${games > 1 ? 's' : ''}</span></div>
        <div class="pf-form" aria-label="Forme récente">${s.form.map((w) => `<i class="${w ? 'w' : 'l'}">${w ? 'V' : 'D'}</i>`).join('')}</div>
        <div class="facts">${fact(`${s.wins} V · ${s.losses} D`, 'Toutes saisons')}${fact(`${pctOf(s.attackWins, s.attackLosses)} %`, `En attaque (${s.attackWins} V)`)}${fact(`${pctOf(s.defenseWins, s.defenseLosses)} %`, `En défense (${s.defenseWins} V)`)}</div>`)}
      ${sec('Exploits', `<div class="facts">${fact(s.bestStreak, 'Meilleure série')}${fact(streak, 'Série en cours')}${fact(s.bestGain ? `+${s.bestGain}` : '—', 'Plus gros gain')}
        ${fact(s.fastestWin ? `${s.fastestWin} min` : '—', 'Victoire éclair')}${fact(s.flawless, 'Parties parfaites')}${fact(s.essence, 'Essence gagnée')}</div>
        ${s.bestUpset ? `<p class="pf-brag">Plus bel exploit : victoire contre <b>${esc(s.bestUpset.displayName)}</b>, pourtant <b>${s.bestUpset.gap} pts</b> au-dessus.</p>` : ''}`)}
      ${sec('Carnage', `<div class="facts">${fact(s.kills, 'Éliminations')}${fact(s.deaths ? (s.kills / s.deaths).toFixed(1).replace('.', ',') : s.kills ? 'Parfait' : '—', 'Ratio K/D')}
        ${fact((s.kills / games).toFixed(1).replace('.', ','), 'Kills par partie')}${fact(s.aces, 'ACE')}${fact(`${Math.round((s.firstBloods / games) * 100)} %`, 'Premier sang')}${fact(s.deaths, 'Morts')}</div>`)}
      ${sec('Champions', `<div class="pf-pair">${champ(s.signature, 'Champion fétiche', (c) => `${c.games} partie${c.games > 1 ? 's' : ''} · ${pctOf(c.wins, c.games - c.wins)} % de victoires`)}
        ${champ(s.killer, 'Le plus meurtrier', (c) => `${c.kills} éliminations`)}</div>`)}
      ${s.victim || s.nemesis ? sec('Rivalités', `<div class="pf-pair">${rival(s.victim, 'Victime préférée', (r) => `battu ${r.count} fois`, 'up')}
        ${rival(s.nemesis, 'Bête noire', (r) => `${r.count} défaite${r.count > 1 ? 's' : ''} contre`, 'down')}</div>`) : ''}
      ` : `<p class="empty-note">${me ? 'Lance ton premier combat dans l\'arène pour remplir ton palmarès.' : `${esc(p.displayName)} n'a pas encore combattu.`}</p>`}
      ${sec('Saisons', `<div class="facts">${fact(s.bestTier ? TIER[s.bestTier].label : '—', 'Meilleur palier')}${fact(s.seasonsPlayed, 'Saisons jouées')}${fact(s.podiums, 'Podiums')}${fact(`Niv. ${s.passLevel}`, 'Pass de saison')}
        ${fact(`${s.seasonWins} V · ${s.seasonLosses} D`, 'Cette saison')}${fact(s.seasonPeak, 'Pic de la saison')}${fact(s.firstBattleAt ? new Date(s.firstBattleAt).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }) : '—', 'Dans l\'arène depuis')}</div>`)}
      ${sec('Collection', `<div class="facts">${fact(p.owned, 'Objets')}${fact(`${String(collPct).replace('.', ',')} %`, 'Du catalogue')}${fact(p.totalOpened, 'Reliques ouvertes')}</div>
        ${gem ? `<div class="pf-champ">${`<img loading="lazy" class="r-${gem.rarity}" src="${esc(gem.art)}" ${gem.fb ? `data-fb="${esc(gem.fb)}"` : ''} alt="">`}
          <span><span class="kicker">Plus belle pièce</span><b>${esc(gem.name)}</b><small class="pf-rar r-${gem.rarity}">${LABEL[gem.rarity]}</small></span></div>` : ''}`)}
      <div class="pf-actions">
        <button class="btn primary block" type="button" data-pf-coll>${me ? 'Ma collection' : 'Voir sa collection'}</button>
        ${me ? '' : `<button class="btn ghost block" type="button" data-pf-fight>Défier</button>`}
        ${me || p.added ? '' : `<button class="btn ghost block" type="button" data-pf-add>Ajouter en ami</button>`}
      </div>
    </div>`);
    $('[data-pf-coll]').onclick = () => { closeSheet(); if (me) setView('collection'); else openPlayer(userId); };
    $('[data-pf-fight]')?.addEventListener('click', () => openFoe(userId));
    $('[data-pf-add]')?.addEventListener('click', async (e) => { if (await addFriend({ userId })) e.target.remove(); });
  } catch (e) { toast(e.message, true); }
}

// ---------- Arène : combats roster contre roster ----------
const CLASS = {
  ASSASSIN: { label: 'Assassin', color: '#ff4d6d' },
  MAGE: { label: 'Mage', color: '#a78bfa' },
  MARKSMAN: { label: 'Tireur', color: '#ffc94d' },
  TANK: { label: 'Tank', color: '#3ddc84' },
  FIGHTER: { label: 'Combattant', color: '#ff8a3d' },
  SUPPORT: { label: 'Soutien', color: '#6fb7ff' },
};
const CURVE = {
  EARLY: { label: 'Early', color: '#ff8a3d', text: 'Fort en lane, plus faible en fin de partie.' },
  MID: { label: 'Mid', color: '#ffc94d', text: 'Au sommet autour des dragons et du premier teamfight.' },
  LATE: { label: 'Late', color: '#a78bfa', text: 'Faible en lane, redoutable dans les derniers teamfights.' },
};
const STYLE = {
  SOLO: { label: 'Solo', text: 'Gagne ses duels et pousse les side lanes.' },
  TEAMFIGHT: { label: 'Teamfight', text: 'Brille dans les combats à cinq.' },
};
const TUTO_KEY = 'capsules.tuto.arena.v3';
const TIER = {
  BRONZE: { label: 'Bronze', color: '#d08a5b' },
  SILVER: { label: 'Argent', color: '#c3cfe2' },
  GOLD: { label: 'Or', color: '#ffc94d' },
  PLATINUM: { label: 'Platine', color: '#3ddcc4' },
  DIAMOND: { label: 'Diamant', color: '#6fb7ff' },
  MASTER: { label: 'Maître', color: '#d08bff' },
  GRANDMASTER: { label: 'Grand maître', color: '#ff5d7a' },
  CHALLENGER: { label: 'Challenger', color: '#ffe9a0' },
};
const tierBadge = (t, big = false) => `<span class="tier${big ? ' big' : ''}" style="--tc:${TIER[t].color}">${TIER[t].label}</span>`;
const SLOT_LABEL = { P: 'Passif', Q: 'A', W: 'Z', E: 'E', R: 'R' };

/** Talent d'un champion : icône du sort, nom, touche ; avec la description en version détaillée. */
function talentHTML(t, full = false) {
  if (!t) return '';
  const icon = t.icon ? `<img src="${esc(t.icon)}" alt="" loading="lazy">` : '<svg viewBox="0 0 24 24"><use href="#cls-MAGE"/></svg>';
  return `<span class="talent${full ? ' full' : ''}" title="${esc(t.description)}"><span class="talent-ico">${icon}</span>
    <span class="talent-txt"><b>${esc(t.spell)} <em>${SLOT_LABEL[t.slot] || t.slot}</em></b>${full ? `<span>${esc(t.description)}</span>` : ''}</span></span>`;
}

/** Profil d'arène : courbe et style ; en version détaillée, postes principal et secondaire avec leur bonus. */
function profileHTML(p, full = false) {
  if (!p) return '';
  const tags = `<span class="ptags"><span class="ptag" style="--pc:${CURVE[p.curve].color}">${CURVE[p.curve].label}</span><span class="ptag">${STYLE[p.style].label}</span></span>`;
  if (!full) return tags;
  return `<div class="profile"><span class="kicker">Profil d'arène</span>
    <div class="profile-roles"><span><b>${ROLES[p.main]}</b> poste principal · +12 %</span>
      ${p.secondary != null ? `<span><b>${ROLES[p.secondary]}</b> poste secondaire · +8 %</span>` : ''}
      <span class="muted">Partout ailleurs : −10 %</span></div>
    ${tags}<p class="muted">${CURVE[p.curve].text} ${STYLE[p.style].text}</p></div>`;
}

function daysLeft(iso) {
  const d = Math.max(0, Date.parse(iso) - now()) / 86400e3;
  return d >= 1 ? `${Math.floor(d)} j` : `${Math.max(1, Math.ceil(d * 24))} h`;
}

const clsIcon = (c, extra = '') => (CLASS[c]
  ? `<svg class="cls ${extra}" style="--cc:${CLASS[c].color}" viewBox="0 0 24 24" role="img" aria-label="${CLASS[c].label}"><use href="#cls-${c}"/></svg>` : '');
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
const fitLabel = (f) => (f >= 10 ? 'Poste principal' : f > 0 ? 'Poste secondaire' : f < 0 ? 'Hors poste' : 'Neutre');
const unitItem = (u) => (!S.cat ? null : u.kind === 'CHAMPION' && u.rarity && u.rarity !== 'EXALTED' ? loanItem(u.itemId) : item(u.kind, u.itemId));
const unitImg = (u) => { const it = unitItem(u); return it ? `<img loading="lazy" src="${esc(it.art)}" ${it.fb ? `data-fb="${esc(it.fb)}"` : ''} alt="">` : ''; };

function fmtWait(ms) {
  const m = Math.ceil(ms / 60000);
  return m >= 60 ? `dans ${Math.ceil(m / 60)} h` : `dans ${m} min`;
}

function ago(iso) {
  const s = (now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'à l\'instant';
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  return `il y a ${Math.floor(s / 86400)} j`;
}

function avatarInner(p) {
  const src = avatarSrc(p);
  return `${esc((p.displayName[0] || '?').toUpperCase())}${src ? `<img src="${esc(src)}" alt="">` : ''}`;
}

const synergyHTML = (list) => `<div class="synergies">${list.length
  ? list.map((s) => `<span class="syn${s.includes('−') ? ' bad' : ''}">${esc(s)}</span>`).join('')
  : '<span class="syn none">Aucune synergie</span>'}</div>`;

async function loadArena({ quiet = false } = {}) {
  try {
    if (!S.cat) await loadCatalog();
    S.arena = await api('/capsules/arena', { retry: true });
    renderArenaBadge();
    renderMe();
    if (S.view !== 'arena') return;
    renderArenaHead();
    renderArenaTeam();
    renderArenaBody();
    ambientFor('arena'); animateIn($('#view-arena'));
  } catch (e) { if (!quiet) toast(e.message, true); }
}

function renderArenaBadge() {
  const n = S.arena?.opponents.filter((o) => o.revenge).length || 0;
  const b = $('#arena-badge'); b.hidden = !n; b.textContent = n;
}

function renderArenaHead() {
  const a = S.arena;
  $('#arena-rating').textContent = a.rating;
  $('#arena-record').textContent = a.wins + a.losses ? `${a.wins} V · ${a.losses} D` : 'Aucun combat pour l\'instant';
  $('#arena-rank').textContent = a.rank ? `#${a.rank}` : '—';
  const s = a.season;
  const span = s.nextTierAt ? s.nextTierAt - s.tierFloor : 1;
  const pct = s.nextTierAt ? Math.min(100, Math.max(0, ((a.rating - s.tierFloor) / span) * 100)) : 100;
  const next = Object.keys(TIER)[Object.keys(TIER).indexOf(s.tier) + 1];
  const extras = $('#arena-extras');
  if (extras) extras.innerHTML = rookieBanner(a) + eventBanner(a.event) + passHTML(a.pass) + shortcutsHTML();
  const tc = TIER[s.tier].color, nc = next ? TIER[next].color : tc;
  $('#arena-hero').style.setProperty('--tc', tc);
  $('#arena-season').innerHTML = `<div class="tier-head" style="--tc:${tc};--nc:${nc}">
      <svg class="tier-emblem" viewBox="0 0 64 64" aria-hidden="true"><use href="#emblem"/></svg>
      <div class="tier-main"><div class="tier-line"><b class="tier-name">${TIER[s.tier].label}</b><span><b class="num">${fmtInt(a.rating)}</b>${a.rank ? ` <span class="muted">#${a.rank}</span>` : ''}</span></div>
        <div class="tier-bar"><i style="width:${pct}%"></i></div>
        <div class="tier-sub"><span>${s.nextTierAt ? `${s.nextTierAt - a.rating} pts avant <b style="color:${nc}">${TIER[next].label}</b>` : 'Palier maximal atteint'}</span><span class="muted">${a.wins} V – ${a.losses} D · saison ${s.number}, ${daysLeft(s.endsAt)}</span></div></div>
    </div>`;
  if (a.lastSeason && !S.seasonShown) { S.seasonShown = true; showSeasonEnd(a.lastSeason); }
  else if (a.lastBoss && !S.bossShown && $('#sheet').hidden) { S.bossShown = true; showBossResult(a.lastBoss); }
  $('#reward-pips').innerHTML = Array.from({ length: a.rewardedPerDay }, (_, i) => `<i class="${i < a.rewardedToday ? 'on' : ''}${i % 2 ? ' pair' : ''}"></i>`).join('');
  const left = a.rewardedPerDay - a.rewardedToday;
  $('#reward-text').innerHTML = left > 0
    ? `<b>+${a.winEssence}</b> essence par victoire${a.catchUpPercent ? ` <span class="catchup" title="Bonus de rattrapage : ta collection est encore petite">dont +${a.catchUpPercent} % rattrapage</span>` : ''} · encore <b>${left}</b> aujourd'hui`
    : 'Essence du jour empochée · la cote compte toujours';
}

const fmtInt = (n) => Number(n || 0).toLocaleString('fr-FR');
const rewardText = (r) => [r.essence && `${r.essence} essence`, r.standard && `${r.standard} relique${r.standard > 1 ? 's' : ''}`,
  r.premium && `${r.premium} prestige`, r.legend && 'cadre Légende'].filter(Boolean).join(' + ');

// ---------- Arène des recrues ----------
/** Bandeau des recrues : adversaires à collection proche, fin à la date ou au nombre d'attaques. */
function rookieBanner(a) {
  const r = a.rookie;
  if (!r) return '';
  const day = new Date(r.endsAt).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });
  return `<div class="rookie-banner"><span class="kicker">Arène des recrues</span>
    <b>Tu affrontes des joueurs à ta mesure</b>
    <span>Hors amis, tes adversaires ont une collection proche de la tienne, et les joueurs confirmés ne peuvent pas te défier.
    Fin ${day} ou dans ${r.battlesLeft} attaque${r.battlesLeft > 1 ? 's' : ''}, au premier des deux.</span></div>`;
}

// ---------- Événements du week-end ----------
function eventBanner(e) {
  if (!e) return '';
  return `<button type="button" class="event-banner k-${e.kind}${e.active ? ' on' : ''}" data-event>
    <span class="kicker">${e.active ? 'Événement en cours' : 'Ce week-end'}</span><b>${esc(e.title)}</b>
    <span class="event-when">${e.active ? `fin dans ${daysLeft(e.endsAt)}` : `dans ${daysLeft(e.startsAt)}`}</span></button>`;
}

const EVENT_MARK = { DOUBLE_ESSENCE: '×2', DOUBLE_XP: 'XP ×2', CHAOS_META: '?!' };

function showEvent(e) {
  if (!e) return;
  const changes = e.kind === 'CHAOS_META' && e.active ? (S.meta?.changes || []).filter((c) => c.reason.startsWith('Événement')) : [];
  openSheet(`<div class="event-pop k-${e.kind}">
    <span class="kicker">${e.active ? 'Événement en cours' : 'Prochain événement'}</span>
    <div class="event-mark">${EVENT_MARK[e.kind]}</div>
    <h2>${esc(e.title)}</h2><p>${esc(e.text)}</p>
    ${changes.length ? `<div class="event-changes">${changes.map((c) => `<span class="${c.percent > 0 ? 'up' : 'down'}">${esc(c.name)} ${signed(c.percent)} %</span>`).join('')}</div>` : ''}
    <p class="muted">${e.active ? `Jusqu'à lundi minuit · fin dans ${daysLeft(e.endsAt)}` : `Du samedi au lundi minuit · dans ${daysLeft(e.startsAt)}`}</p>
    <button class="btn primary big block" type="button" id="event-go">${e.active ? 'Foncer dans l\'arène' : 'Compris'}</button></div>`);
  if (e.active) { audio.chime(4); buzz([40, 30, 80]); }
  $('#event-go').onclick = () => { closeSheet(); if (e.active && S.view !== 'arena') setView('arena'); };
}

const EVENT_KEY = 'reliques.event.seen';

/** Popup à la première ouverture pendant un événement. */
async function maybeShowEvent() {
  const e = S.meta?.event;
  if (!e?.active || store.get(EVENT_KEY) === e.id || !$('#tuto').hidden || !$('#sheet').hidden) return;
  store.set(EVENT_KEY, e.id);
  showEvent(e);
  while (!$('#sheet').hidden) await sleep(300);
}

// ---------- Pass de saison ----------
/** Icône de récompense : relique, prestige, essence ou cadre Légende. */
function rewardIcon(r) {
  if (r.legend) return '<svg viewBox="0 0 64 64" class="ri legend"><use href="#emblem"/></svg>';
  if (r.premium) return '<svg viewBox="0 0 100 100" class="ri prem"><use href="#crystal"/></svg>';
  if (r.standard) return '<svg viewBox="0 0 100 100" class="ri"><use href="#crystal"/></svg>';
  return '<svg viewBox="0 0 16 16" class="ri ess"><path d="M8 1 13 8 8 15 3 8z"/></svg>';
}

/** Piste du pass : quelques niveaux autour du niveau actuel, avec leurs récompenses. */
function passHTML(p) {
  if (!p) return '';
  const max = p.level >= p.maxLevel;
  const into = max ? p.xpPerLevel : p.xp - p.level * p.xpPerLevel;
  const from = Math.max(1, Math.min(p.level - 1, p.maxLevel - 5));
  const nodes = p.rewards.filter((r) => r.level >= from && r.level < from + 6);
  return `<button type="button" class="pass-track2${max ? ' max' : ''}" data-pass>
    <span class="pt-head"><b>Pass · niveau ${p.level}</b><span class="muted">${max ? 'Terminé : tu es une Légende' : `${into} / ${p.xpPerLevel} XP`}</span></span>
    <span class="pt-nodes">${nodes.map((r) => `<span class="pt-node${r.level <= p.level ? ' done' : ''}${r.level === p.level + 1 ? ' next' : ''}">
      <span class="pt-ico">${rewardIcon(r)}</span><em>${r.level}</em></span>`).join('')}</span>
    <span class="pass-bar"><i style="width:${Math.min(100, (into / p.xpPerLevel) * 100)}%"></i></span></button>`;
}

/** Raccourcis : boss de la semaine et patch de la semaine. */
function shortcutsHTML() {
  const m = S.meta;
  return `<div class="shortcuts">
    <button type="button" class="sc" data-arena-go="boss"><svg viewBox="0 0 24 24"><path d="M4 18h16M4 16 3 7l5 4 4-6 4 6 5-4-1 9z"/></svg><span><b>Boss</b><em>de la semaine</em></span></button>
    ${m?.changes.length ? `<button type="button" class="sc" data-meta-open><svg viewBox="0 0 24 24"><path d="M5 8h13l-4-4M19 16H6l4 4"/></svg><span><b>Patch ${m.number}</b><em>${m.changes.length} changements</em></span></button>` : ''}
  </div>`;
}

function showPass() {
  const a = S.arena; const p = a?.pass; if (!p) return;
  openSheet(`<div class="pass-sheet"><span class="kicker">Saison ${a.season.number} · fin dans ${daysLeft(a.season.endsAt)}</span>
    <h2>Pass de saison</h2>
    <p class="muted">Victoire en attaque +${p.attackWinXp} XP, défaite +${p.attackLossXp}, défense tenue +${p.defenseWinXp}, boss +${p.bossXp}.
      ${p.xpPerLevel} XP par niveau, chaque niveau paie tout de suite. ${a.event?.active && a.event.kind === 'DOUBLE_XP' ? '<b>Double XP ce week-end !</b>' : ''}</p>
    <ol class="pass-track">${p.rewards.map((r) => `<li class="${r.level <= p.level ? 'done' : r.level === p.level + 1 ? 'next' : ''}${r.legend ? ' legend' : ''}">
      <b>${r.level}</b><span>${rewardText(r)}</span>${r.level <= p.level ? '<em>Obtenu</em>' : r.level === p.level + 1 ? `<em>${p.xp - p.level * p.xpPerLevel} / ${p.xpPerLevel}</em>` : ''}</li>`).join('')}</ol>
    <p class="muted">Niveau ${p.maxLevel} : cadre animé « Légende » jusqu'à la fin de la saison suivante, et le titre Légende sur ton profil, pour toujours. Le pass repart à zéro à chaque saison.</p></div>`);
}

function showLevelUp(rewards) {
  const top = rewards[rewards.length - 1];
  openSheet(`<div class="levelup${top.legend ? ' legend' : ''}"><span class="kicker">Pass de saison</span>
    <div class="lvl-badge"><em>Niveau</em><b>${top.level}</b></div>
    <h2>${top.legend ? 'Tu es une Légende !' : 'Niveau atteint !'}</h2>
    <ul class="lvl-rewards">${rewards.map((r) => `<li><b>Niv. ${r.level}</b><span>${rewardText(r)}</span></li>`).join('')}</ul>
    ${top.legend ? '<p class="muted">Cadre animé débloqué jusqu\'à la fin de la saison prochaine. Flex autorisé.</p>' : ''}
    <button class="btn primary big block" type="button" id="lvl-ok">Récupérer</button></div>`);
  audio.chime(top.legend ? 6 : 4); buzz([60, 40, 120]);
  $('#lvl-ok').onclick = async () => { closeSheet(); try { setWallet(await api('/capsules/state')); saveSnapshot(); } catch { /* le stock suivra */ } };
}

// ---------- Boss de la semaine ----------
async function renderBoss() {
  const body = $('#arena-body');
  if (!S.boss) body.innerHTML = '<p class="empty-note">Le boss arrive…</p>';
  try {
    const b = S.boss = await api('/capsules/boss');
    if (S.arenaTab !== 'boss') return;
    body.innerHTML = bossHTML(b);
    $('#boss-go').onclick = attackBoss;
  } catch (e) { body.innerHTML = `<p class="empty-note">${esc(e.message)}</p>`; }
}

function bossHTML(b) {
  const lead = unitItem(b.team.units[2] || b.team.units[0]);
  const units = b.team.units.map((u) => `<div class="tport r-${u.rarity}">${unitImg(u)}${roleIcon(u.role)}</div>`).join('');
  const rows = b.top.map((e) => `<button type="button" class="lrow${e.userId === S.user?.id ? ' me' : ''}" data-profile="${e.userId}">
    <span class="rank">${e.rank}</span>${avatarHTML(e)}
    <span class="who"><b>${esc(e.displayName)}${e.userId === S.user?.id ? ' (toi)' : ''}</b><span>${e.attempts} tentative${e.attempts > 1 ? 's' : ''}</span></span>
    <b class="pts">${fmtInt(e.best)}</b></button>`).join('');
  const wait = Date.parse(b.resetAt) - now();
  return `<section class="boss2">
    <div class="b2-banner" style="${lead ? `background-image:url('${esc(lead.splash)}')` : ''}"><div><span class="kicker">Boss · fin dans ${daysLeft(b.endsAt)}</span><h2>${esc(b.name)}</h2></div></div>
    <div class="trow">${units}</div>
    <p class="muted b2-rule">Équipe Exaltée à <b>+35 %</b>. Fais un max de dégâts et lis ses intentions à chaque phase.</p>
    <div class="b2-me"><div><span class="kicker">Ton record</span><b class="num">${b.myBest != null ? fmtInt(b.myBest) : '—'}</b><span>${b.myRank ? `#${b.myRank} cette semaine` : 'pas encore classé'}</span></div>
      <div class="r"><span class="kicker">Tentatives</span><b class="num">${b.attemptsLeft} / ${b.attemptsPerDay}</b><span>aujourd'hui</span></div></div>
    <button class="btn primary block" id="boss-go" type="button" ${b.openRun || (b.attemptsLeft && b.mine) ? '' : 'disabled'}>${b.openRun ? 'Reprendre la partie en cours'
      : !b.mine ? 'Complète ton équipe d\'abord' : b.attemptsLeft ? 'Attaquer le boss' : `Nouvelles tentatives ${fmtWait(wait)}`}</button>
    <details class="vs-more"><summary>Règles et récompenses</summary><p class="muted">${b.killPoints} points par kill, ${b.towerPoints} par tour, ${fmtInt(b.winPoints)} si tu le bats, +${b.readPoints} par call réussi. Ton meilleur score compte. Lundi : 1er +3 prestige, 2e +2, 3e +1, tous les autres participants +1 relique.</p></details>
    <div class="section-head"><h2>Dégâts infligés</h2><span class="muted">${b.top.length} joueur${b.top.length > 1 ? 's' : ''}</span></div>
    ${rows ? `<div class="ladder">${rows}</div>` : '<p class="empty-note">Personne n\'a encore attaqué : sois le premier.</p>'}
  </section>`;
}

/** Coquille de combat pour une partie contre le boss en cours (avant la fin, pas de score). */
const bossShell = (s) => ({ id: s.runId, attacker: s.me, defender: s.boss, a: s.a, b: s.b, events: s.events, attackerWon: false,
  boss: true, essence: 0, passXp: 0, minutes: 0 });

async function attackBoss() {
  const btn = $('#boss-go'); btn.disabled = true; btn.textContent = 'Combat en cours…';
  try {
    const step = await api('/capsules/boss/attack', { method: 'POST' });
    await playBattle(bossShell(step), { live: { step } });
  } catch (e) { toast(e.message, true); renderBoss(); }
}

const STAGE_KICKER = { PLAN: 'Avant les lanes', OBJECTIVES: 'Avant les dragons', FIGHT: 'Avant le combat' };

/** Panneau de décision pendant le combat contre le boss ; renvoie l'option choisie (0 à 2). Touches 1, 2, 3 au clavier. */
function askTactic(d) {
  const el = $('#b-tactic');
  el.innerHTML = `<span class="kicker">${STAGE_KICKER[d.stage]} · ${d.minute}'</span>
    <h3>${esc(d.title)}</h3><p>${esc(d.text)}</p>
    <div class="tactic-hints"><span class="kicker">Renseignements</span>${d.hints.slice().sort((x, y) => y.percent - x.percent)
      .map((h) => `<div class="tactic-hint" style="--p:${h.percent}%"><span>${esc(h.label)}</span><b>${h.percent} %</b></div>`).join('')}</div>
    <div class="tactic-opts">${d.options.map((o) => `<button type="button" class="tactic-opt" data-tactic="${o.id}"><b><em>${o.id + 1}</em>${esc(o.label)}</b><span>${esc(o.text)}</span></button>`).join('')}</div>`;
  el.hidden = false;
  audio.tone(520, 0.12, 'triangle', 0.05); buzz(25);
  return new Promise((resolve) => {
    const done = (choice) => { el.hidden = true; el.onclick = null; removeEventListener('keydown', key); resolve(choice); };
    const key = (e) => { if (['1', '2', '3'].includes(e.key)) done(+e.key - 1); };
    el.onclick = (e) => { const b = e.target.closest('[data-tactic]'); if (b) done(+b.dataset.tactic); };
    addEventListener('keydown', key);
  });
}

function showBossResult(r) {
  const rewards = [r.rewardStandard && `+${r.rewardStandard} relique${r.rewardStandard > 1 ? 's' : ''}`, r.rewardPremium && `+${r.rewardPremium} prestige`].filter(Boolean).join(' · ');
  openSheet(`<div class="season-end boss-end"><span class="kicker">Boss de la semaine terminé</span>
    <h2>${esc(r.name)}</h2>
    <div class="facts"><div><b>#${r.rank}</b><span>sur ${r.players}</span></div><div><b>${fmtInt(r.best)}</b><span>Dégâts</span></div></div>
    <p class="season-reward">${rewards ? `<b>${rewards}</b> ajoutées à ton stock` : 'Pas de récompense cette fois.'}</p>
    <p class="muted">Un nouveau boss t'attend déjà.</p>
    <button class="btn primary big block" id="boss-ok">${rewards ? 'Récupérer' : 'OK'}</button></div>`);
  $('#boss-ok').onclick = async () => {
    closeSheet();
    try {
      await api(`/capsules/boss/${encodeURIComponent(r.weekId)}/seen`, { method: 'POST' });
      setWallet(await api('/capsules/state'));
      if (rewards) { audio.chime(5); buzz([60, 40, 120]); }
    } catch (e) { toast(e.message, true); }
  };
}

function unitCell(u) {
  return `<div class="unit r-${u.rarity}" data-unit="${u.role}" role="button" tabindex="0">
    <div class="unit-art">${unitImg(u)}<span class="role">${ROLES[u.role]}</span><span class="unit-cls">${u.classes.slice(0, 2).map((c) => clsIcon(c)).join('')}</span></div>
    <b>${esc(u.champion)}</b>
    <span class="fit ${u.fitPercent > 0 ? 'up' : u.fitPercent < 0 ? 'down' : ''}" title="${fitLabel(u.fitPercent)}">${u.fitPercent ? `${signed(u.fitPercent)} % ${u.fitPercent >= 10 ? 'poste' : u.fitPercent > 0 ? 'poste 2' : 'hors poste'}` : 'Neutre'}</span>
    ${profileHTML(u.profile)}
    ${talentHTML(u.talent)}
  </div>`;
}

function renderArenaTeam() {
  const a = S.arena;
  const el = $('#arena-team');
  if (!a.rosterReady) {
    el.innerHTML = `<div class="team-empty"><b>Ton roster n'est pas complet</b><span>Remplis les 5 postes pour entrer dans l'arène.</span>
      <button class="btn primary small" data-goto="collection">Compléter mon roster</button></div>`;
    return;
  }
  const its = rosterItems(fullSlots(S.roster));
  const team = S.teams?.[S.activeTeam];
  el.innerHTML = teamBannerHTML(its, {
    kicker: `Mon équipe${team?.name ? ` · ${esc(team.name)}` : ''}`, name: S.user?.displayName || 'Moi', power: a.team.power, side: 'me', editable: true,
    foot: `<div class="tb-foot"><div class="tb-notes">${notesHTML(teamNotes(its).slice(0, 2))}</div>
      <button class="btn primary small" type="button" data-compose="0">Composer</button></div>` });
}

function renderArenaBody() {
  const tab = S.arenaTab || 'foes';
  $$('[data-arena]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.arena === tab)));
  if (tab === 'foes') renderFoes();
  else if (tab === 'ladder') renderLadder();
  else if (tab === 'boss') renderBoss();
  else renderHistory();
}

/**
 * Statut d'un duel, lisible sans ouvrir l'aperçu (règle anti-farm de BattleService) :
 * attente de riposte après mon attaque, revanche ouverte après la sienne, sinon libre.
 */
function duelStatus(o, name) {
  const wait = o.availableAt ? Date.parse(o.availableAt) - now() : 0;
  if (wait > 0) return { key: 'wait', chip: o.lastWon ? 'Battu · attend sa riposte' : 'Perdu · attend sa riposte', cta: fmtWait(wait), go: false,
    long: `Tu l'as déjà attaqué. Nouveau duel quand ${esc(name)} riposte, ou ${fmtWait(wait)}.` };
  if (o.revenge) return o.lastWon === false
    ? { key: 'rev', chip: 'T’a battu', cta: 'Prendre ma revanche', go: true, long: `${esc(name)} t'a attaqué et gagné. À toi de répondre.` }
    : { key: 'riposte', chip: 'T’a attaqué', cta: 'Riposter', go: true, long: `${esc(name)} t'a attaqué et perdu. Tu peux riposter.` };
  return { key: 'free', chip: 'Défiable', cta: 'Défier', go: true, long: '' };
}

function foeHTML(o) {
  const p = o.player;
  const st = duelStatus(o, p.displayName);
  // Puissance de son roster estimée côté client (rareté, poste, méta), comparée à la tienne : un repère, pas une prédiction.
  const theirs = S.cat ? teamPower(rosterItems(fullSlots(p.roster))) : 0, mine = S.arena?.team?.power || 0;
  const gap = mine && theirs ? theirs - mine : 0;
  return `<button class="foe st-${st.key}" data-foe="${p.userId}" type="button" aria-label="${esc(p.displayName)} : ${st.chip}, ${st.cta}">
    <span class="fring" style="--tc:${p.frame ? TIER[p.frame].color : TIER[tierOf(o.rating)].color}">${avatarInner(p)}</span>
    <span class="who"><b>${esc(p.displayName)}${o.rookie ? ' <em class="tg new">Recrue</em>' : ''}${o.friend ? '' : ' <em class="tg eq">Suggéré</em>'}</b>
      <span class="foe-meta"><em class="dstat ${st.key}">${st.chip}</em>${theirs ? `<span>équipe <b class="num">${theirs}</b>${gap ? ` <i class="${gap > 0 ? 'm' : 'p'}">${signed(gap)}</i>` : ''}</span>` : ''}</span></span>
    <span class="foe-cta ${st.go ? 'go' : 'wait'}">${st.go ? SWORD_ICON : ''}${st.cta}</span>
  </button>`;
}

function renderFoes() {
  const list = S.arena.opponents;
  $('#arena-body').innerHTML = list.length ? `<div class="foes">${list.map(foeHTML).join('')}</div>`
    : '<p class="empty-note">Personne à défier pour l\'instant. Ajoute des amis : dès que leur roster est complet, ils apparaissent ici.</p>';
}

function ladderRow(e) {
  return ladderRowHTML(e);
}

function ladderTags(e) {
  const tags = [
    e.titles?.length && `<em class="ltag champ" title="Champion de saison">Champion ${e.titles.map((n) => `S${n}`).join(' · ')}</em>`,
    e.legend && '<em class="ltag legend" title="Pass de saison terminé">Légende</em>',
    e.shamed && `<em class="ltag shame" title="A perdu contre le compte de test cette saison">${shameTag()}</em>`,
    S.ladderLast && e.rank === S.ladderLast && '<em class="ltag shame" title="Dernier du classement">Lanterne rouge</em>',
  ].filter(Boolean);
  return tags.length ? `<span class="ltags">${tags.join('')}</span>` : '';
}

function ladderRowHTML(e) {
  const mine = e.userId === S.user?.id;
  return `<button type="button" class="lrow${mine ? ' me' : ''}${e.rank <= 3 ? ` podium p${e.rank}` : ''}" data-profile="${e.userId}">
    <span class="rank">${e.rank}</span><span class="fring" style="--tc:${TIER[tierOf(e.rating)].color}">${avatarInner(e)}</span>
    <span class="who"><b>${esc(e.displayName)}${mine ? ' (toi)' : ''}</b><span>${e.wins} V · ${e.losses} D</span>
      ${ladderTags(e)}</span>
    <b class="pts">${fmtInt(e.rating)}</b></button>`;
}

async function renderLadder() {
  const body = $('#arena-body');
  body.innerHTML = '<p class="empty-note">Chargement du classement…</p>';
  try {
    const l = await api('/capsules/ladder');
    if (S.arenaTab !== 'ladder') return;
    const head = S.arena ? `<div class="ladder-head">${tierBadge(S.arena.season.tier)}<span>Saison ${S.arena.season.number} · fin dans ${daysLeft(S.arena.season.endsAt)}</span></div>` : '';
    if (!l.top.length) { body.innerHTML = `${head}<p class="empty-note">Personne n'a encore combattu cette saison : lance le premier combat !</p>`; return; }
    const meIn = l.me && l.top.some((e) => e.userId === l.me.userId);
    S.ladderLast = l.top.length >= 4 && l.top.length < 100 ? Math.max(...l.top.map((e) => e.rank)) : null;
    const pod = l.top.slice(0, 3);
    const podium = pod.length >= 3 ? `<div class="podium">${[pod[1], pod[0], pod[2]].map((e) => `<button type="button" class="pd p${e.rank}" data-profile="${e.userId}">
        ${e.rank === 1 ? '<svg class="crown" viewBox="0 0 24 24"><path d="M4 18h16M4 16 3 7l5 4 4-6 4 6 5-4-1 9z"/></svg>' : ''}
        <span class="pd-av" style="--tc:${TIER[tierOf(e.rating)].color}">${avatarInner(e)}</span><b>${esc(e.displayName)}</b><span class="pd-pts">${fmtInt(e.rating)}</span><i>${e.rank}</i></button>`).join('')}</div>` : '';
    const rest = podium ? l.top.slice(3) : l.top;
    body.innerHTML = `${head}${podium}<div class="ladder">${rest.map(ladderRow).join('')}${l.me && !meIn ? `<div class="lgap">···</div>${ladderRow(l.me)}` : ''}</div>`;
  } catch (e) { body.innerHTML = `<p class="empty-note">${esc(e.message)}</p>`; }
}

async function renderHistory() {
  const body = $('#arena-body');
  body.innerHTML = '<p class="empty-note">Chargement…</p>';
  try {
    const list = await api('/capsules/battles');
    if (S.arenaTab !== 'history') return;
    body.innerHTML = list.length ? `<div class="history">${list.map((h) => `
      <button class="hrow ${h.won ? 'win' : 'loss'}" data-battle="${h.id}" type="button">
        <span class="res">${h.won ? 'V' : 'D'}</span>
        <span class="who"><b>${h.attacked ? 'Attaque' : 'Défense'} · ${esc(h.opponentName)}</b><span>${ago(h.createdAt)}${h.essence ? ` · +${h.essence} essence` : ''}</span></span>
        <b class="delta ${h.ratingDelta >= 0 ? 'up' : 'down'}">${signed(h.ratingDelta)}</b>
        <svg class="play" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
      </button>`).join('')}</div>`
      : '<p class="empty-note">Aucun combat pour l\'instant. Tes attaques et tes défenses s\'afficheront ici.</p>';
  } catch (e) { body.innerHTML = `<p class="empty-note">${esc(e.message)}</p>`; }
}

// Aperçu : vis-à-vis poste par poste, contres et synergies, avant de lancer.
/** Un côté du vis-à-vis : portrait, champion, classe et adaptation au poste. */
function mxSide(u, them = false) {
  const fit = u.fitPercent ? `<em class="${u.fitPercent > 0 ? 'up' : 'down'}" title="${fitLabel(u.fitPercent)}">${signed(u.fitPercent)} %</em>` : '';
  return `<span class="mx-side${them ? ' them' : ''} r-${u.rarity}">
    <span class="mx-pic">${unitImg(u)}${fit}</span>
    <span class="mx-txt"><b>${esc(u.champion)}</b><span>${u.classes.slice(0, 1).map((c) => `${clsIcon(c, 'sm')}${CLASS[c].label}`).join('')}</span></span>
  </span>`;
}

// Contre de classe en teamfight, lu face à toute la composition adverse : chaque camp a le sien. La barre penche du côté avantagé.
function matchupRow(role, a, b) {
  const d = a.counterPercent - b.counterPercent;
  const lean = Math.max(-1, Math.min(1, d / 15));
  return `<div class="mx ${d > 0 ? 'win' : d < 0 ? 'lose' : 'eq'}">
    ${mxSide(a)}
    <span class="mx-mid">${roleIcon(role)}<span class="mx-bar" style="--w:${Math.round(Math.abs(lean) * 50)}%"><i></i></span>
      <em>${d ? `${d > 0 ? 'Toi' : 'Lui'} +${Math.abs(d)} %` : 'Égal'}</em></span>
    ${mxSide(b, true)}
  </div>`;
}

// Tendance en crans (−2 à +2), jamais en pourcentage : l'aperçu dit où on est fort, pas si on gagne.
const TREND = {
  '-2': ['Gros désavantage', 'down'], '-1': ['Désavantage', 'down'], 0: ['Serré', 'eq'], 1: ['Avantage', 'up'], 2: ['Gros avantage', 'up'],
};
const RISK = [
  ['Stable', 'Peu de coups de poker : ton équipe gagne régulièrement, mais renverse rarement plus fort qu\'elle.'],
  ['Équilibrée', 'Deux coups de poker : un peu de place pour la surprise.'],
  ['Volatile', 'Beaucoup de coups de poker (attrape, résurrection, scaling, hypercarry) : ça passe ou ça casse.'],
];
const riskOf = (team) => RISK[Math.min(2, Math.max(0, (team.risk || 0) - 1))];
const riskHTML = (team) => { const [label, tip] = riskOf(team); return `<span class="risk r${RISK.indexOf(riskOf(team))}" title="${esc(tip)}">${label}</span>`; };

function trendRow(label, v) {
  const [text, cls] = TREND[v] || TREND[0];
  return `<div class="tr-row ${cls}"><span>${label}</span>
    <span class="tr-bar">${[-2, -1, 0, 1, 2].map((i) => `<i class="${i === v ? 'on' : ''}"></i>`).join('')}</span><em>${text}</em></div>`;
}

function forecastHTML(f, mine, theirs) {
  if (!f) return '';
  const keys = (list) => (list.length ? `<ul>${list.map((k) => `<li>${esc(k)}</li>`).join('')}</ul>` : '<p class="muted">Rien de marquant</p>');
  return `<div class="forecast">
    <div class="tr-big">${trendRow('Tendance du match', f.tendency)}</div>
    <div class="tr-list">
      ${trendRow('Lanes', f.lanes)}${trendRow('Objectifs', f.objectives)}${trendRow('1er teamfight', f.earlyFight)}${trendRow('Teamfights suivants', f.lateFight)}
    </div>
    <div class="vs-syn">
      <div><span class="kicker">Tes clés ${riskHTML(mine)}</span>${keys(f.keysA)}</div>
      <div><span class="kicker">Ses clés ${riskHTML(theirs)}</span>${keys(f.keysB)}</div>
    </div>
    <p class="fine">Tendance calculée sur des parties simulées : le hasard reste, un coup de poker peut tout renverser.</p>
  </div>`;
}

async function openFoe(id) {
  try {
    const p = await api(`/capsules/battles/preview/${id}`);
    const name = p.opponent.displayName;
    const st = duelStatus(p, name);
    const theirs = p.theirs.units.map(unitItem);
    openSheet(`<div class="preview">
      <div class="pv-head"><div><span class="kicker">Aperçu du duel</span><h2>Toi contre ${esc(name)}</h2></div>
        <button class="btn ghost small" type="button" data-profile="${id}">Profil</button></div>
      ${st.long ? `<p class="pv-status ${st.key}">${st.long}</p>` : ''}
      ${teamBannerHTML(theirs, { kicker: `Son équipe · ${fmtInt(p.rating)}`, name, power: p.theirs.power, side: 'them', vs: p.mine.power })}
      <div class="pv-duel" aria-label="Puissance : toi ${p.mine.power}, ${esc(name)} ${p.theirs.power}">
        <span class="pv-me">${S.user ? `<span class="vf-av me">${avatarInner(S.user)}</span>` : ''}<span><b>Toi</b><b class="num">${p.mine.power}</b></span></span>
        <span class="pv-them"><span><b>${esc(name)}</b><b class="num">${p.theirs.power}</b></span><span class="vf-av them">${avatarInner(p.opponent)}</span></span>
        <span class="pv-bar"><i style="width:${Math.round((p.mine.power / Math.max(1, p.mine.power + p.theirs.power)) * 100)}%"></i></span>
      </div>
      ${forecastHTML(p.forecast, p.mine, p.theirs)}
      <details class="vs-more mx-wrap"><summary>Vis-à-vis poste par poste</summary>
        <div class="mx-legend"><span class="me">Toi</span><span>Avantage de classe en teamfight</span><span class="them">${esc(name)}</span></div>
        <div class="mx-list">${ROLES.map((r, i) => matchupRow(i, p.mine.units[i], p.theirs.units[i])).join('')}</div>
        <div class="vs-syn"><div><span class="kicker">Tes bonus</span>${synergyHTML(p.mine.synergies)}</div>
          <div><span class="kicker">Ses bonus</span>${synergyHTML(p.theirs.synergies)}</div></div>
      </details>
      <details class="talents-vs"><summary>Talents en jeu</summary>
        <div><span class="kicker">Ton équipe</span>${p.mine.units.map((u) => `<div class="tv-row"><b>${esc(u.champion)}</b>${talentHTML(u.talent, true)}</div>`).join('')}</div>
        <div><span class="kicker">En face</span>${p.theirs.units.map((u) => `<div class="tv-row"><b>${esc(u.champion)}</b>${talentHTML(u.talent, true)}</div>`).join('')}</div>
      </details>
      <p class="hint">Ton équipe défend aussi : la changer pour contrer ${esc(name)} change aussi ta défense.</p>
      <button class="btn primary big block" id="attack-go" ${st.go ? '' : 'disabled'}>${st.go ? `${SWORD_ICON}${st.key === 'free' ? `Défier ${esc(name)}` : st.cta}` : `Attends sa riposte · ${st.cta}`}</button>
      <button class="btn ghost block" data-goto="collection">Ajuster mon équipe</button>
    </div>`);
    $('#attack-go').onclick = () => attack(id);
  } catch (e) { toast(e.message, true); }
}

async function attack(id) {
  const btn = $('#attack-go');
  btn.disabled = true; btn.textContent = 'Combat en cours…';
  try {
    const b = await api('/capsules/battles', { method: 'POST', body: { opponentId: id } });
    closeSheet();
    if (b.essence && S.wallet) { S.wallet.essence += b.essence; renderWallet(); saveSnapshot(); }
    await playBattle(b);
  } catch (e) { toast(e.message, true); btn.disabled = false; btn.textContent = 'Lancer le combat'; }
}

async function openBattle(id) {
  try { await playBattle(await api(`/capsules/battles/${id}`)); } catch (e) { toast(e.message, true); }
}

// Rejeu animé : carte vue de dessus, jetons des champions, effets et annonces façon jeu ; « Passer » saute à la fin.
const replay = { skip: false, wake: () => {}, battle: null, speed: 1, spectator: false };
const bpause = (ms) => (replay.skip ? Promise.resolve() : new Promise((r) => { const t = setTimeout(r, ms / replay.speed); replay.wake = () => { clearTimeout(t); r(); }; }));

// Coordonnées en % de la carte pour le camp « me » (base en bas à gauche) ; le camp adverse est le miroir (x, y) → (y, x).
const MAP = {
  base: [10, 90],
  fountain: [[8, 86], [12, 86], [10, 90], [14, 90], [10, 94]],
  rest: [[9, 32], [28, 66], [40, 60], [70, 91], [64, 88]],
  duel: { top: { 0: [9, 17] }, mid: { 2: [45, 55] }, bot: { 3: [82, 91], 4: [77, 87] } },
  gank: { top: [12, 24], mid: [41, 52], bot: [73, 89] },
  pit: { dragon: [64, 66], ancient: [31, 28] },
  pitSide: { dragon: [[0, 0], [58, 72], [0, 0], [0, 0], [55, 76]], ancient: [[0, 0], [25, 34], [0, 0], [0, 0], [22, 38]] },
  fight: { 'fight-dragon': [64, 66], 'fight-mid': [50, 50], 'fight-ancient': [31, 28] },
  cluster: [[-7, 3], [-3, 7], [-10, 9], [-5, 12], [-12, 14]],
  siege: [[-14, 4], [-10, 9], [-6, 13], [-17, 10], [-12, 16]],
  towers: [['top', [9, 36]], ['top', [9, 60]], ['mid', [38, 62]], ['mid', [26, 74]], ['bot', [64, 91]], ['bot', [40, 91]]],
  nexus: [16, 84],
};
const LANE_OF_ROLE = ['top', null, 'mid', 'bot', 'bot'];
const mirror = ([x, y]) => [y, x];
const P = (k, pt) => (k === 'me' ? pt : mirror(pt));
const add = ([x, y], [dx, dy]) => [x + dx, y + dy];
const champIcon = (u) => `${CD}v1/champion-icons/${u.kind === 'CHAMPION' ? u.itemId : Math.floor(u.itemId / 1000)}.png`;

// Particules de la carte (étincelles, ondes de choc, traits, débris).
const bfx = {
  c: null, ctx: null, parts: [], raf: 0, w: 0, h: 0,
  fit() {
    this.c = $('#b-fx'); this.ctx = this.c.getContext('2d');
    const r = $('#b-map').getBoundingClientRect(); const d = devicePixelRatio || 1;
    this.w = r.width; this.h = r.height; this.c.width = r.width * d; this.c.height = r.height * d; this.ctx.setTransform(d, 0, 0, d, 0, 0);
  },
  px([x, y]) { return [(x / 100) * this.w, (y / 100) * this.h]; },
  burst(pt, color, n = 26, power = 1) {
    if (replay.skip) return;
    const [x, y] = this.px(pt);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2; const v = (1 + Math.random() * 3.5) * power;
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, decay: 0.02 + Math.random() * 0.03, size: 1 + Math.random() * 2.4, color: Math.random() < 0.3 ? '#fff' : color });
    }
    this.parts.push({ ring: true, x, y, r: 4, life: 1, color, power });
    this.run();
  },
  slash(a, b, color) {
    if (replay.skip) return;
    const [x1, y1] = this.px(a); const [x2, y2] = this.px(b);
    this.parts.push({ line: true, x1, y1, x2, y2, life: 1, color });
    this.run();
  },
  debris(pt, color) {
    if (replay.skip) return;
    const [x, y] = this.px(pt);
    for (let i = 0; i < 22; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4; const v = 1 + Math.random() * 3;
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 0.12, life: 1, decay: 0.018, size: 1.5 + Math.random() * 2.5, color: Math.random() < 0.5 ? '#8a94a6' : color, square: true });
    }
    this.run();
  },
  run() { if (!this.raf) this.raf = requestAnimationFrame(() => this.loop()); },
  loop() {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.globalCompositeOperation = 'lighter';
    this.parts = this.parts.filter((p) => p.life > 0);
    for (const p of this.parts) {
      ctx.globalAlpha = Math.max(0, p.life);
      if (p.ring) {
        p.r += 2.2 * p.power; p.life -= 0.04;
        ctx.strokeStyle = p.color; ctx.lineWidth = 1 + 3 * p.life;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.stroke();
      } else if (p.line) {
        p.life -= 0.06;
        ctx.strokeStyle = p.color; ctx.lineWidth = 1 + 4 * p.life; ctx.shadowColor = p.color; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); ctx.stroke(); ctx.shadowBlur = 0;
      } else {
        p.vx *= 0.95; p.vy = p.vy * 0.95 + (p.g || 0); p.x += p.vx; p.y += p.vy; p.life -= p.decay;
        ctx.fillStyle = p.color;
        if (p.square) ctx.fillRect(p.x, p.y, p.size, p.size);
        else { ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.4 + p.life), 0, Math.PI * 2); ctx.fill(); }
      }
    }
    ctx.globalAlpha = 1;
    this.raf = this.parts.length ? requestAnimationFrame(() => this.loop()) : 0;
    if (!this.raf) ctx.clearRect(0, 0, this.w, this.h);
  },
};

const TEAM_COLOR = { me: '#6fb7ff', them: '#e5534b' };
const R = {};

function token(k, role) { return R.tok[k][role]; }
function at(k, role) { return R.pos[k][role]; }
function move(k, role, pt) {
  R.pos[k][role] = pt;
  const el = token(k, role);
  el.style.left = `${pt[0]}%`; el.style.top = `${pt[1]}%`;
}
function die(k, role, color) {
  if (!R.alive[k][role]) return;
  R.alive[k][role] = false;
  token(k, role).classList.add('dead');
  bfx.burst(at(k, role), color || TEAM_COLOR[k === 'me' ? 'them' : 'me'], 30, 1.1);
}
function revive(k, role, pt) {
  if (R.alive[k][role]) return;
  R.alive[k][role] = true;
  const el = token(k, role);
  el.classList.remove('dead');
  move(k, role, P(k, MAP.fountain[role]));
  if (pt) setTimeout(() => move(k, role, pt), 60);
}
function reviveAll(toRest = true) {
  for (const k of ['me', 'them']) for (let r = 0; r < 5; r++) revive(k, r, toRest ? P(k, MAP.rest[r]) : null);
}
function pulse(k, role, cls = 'cast') {
  const el = token(k, role); el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
}
function shake(strong = false) {
  if (replay.skip) return;
  const s = $('#b-stage'); s.classList.remove('shake', 'shake-hard'); void s.offsetWidth; s.classList.add(strong ? 'shake-hard' : 'shake');
}

function announce(title, sub = '', tone = 'me', ms = 1400) {
  if (replay.skip) return;
  const el = $('#b-announce');
  el.className = `announce ${tone}`; el.innerHTML = `<b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}`;
  el.hidden = false; void el.offsetWidth; el.classList.add('go');
  clearTimeout(R.announceT); R.announceT = setTimeout(() => { el.hidden = true; }, ms / replay.speed);
}

function callout(k, role, ev) {
  if (replay.skip) return;
  const u = R.units[k][role];
  const el = $('#b-callout');
  el.className = `callout ${k}`;
  el.innerHTML = `<span class="co-ico">${ev.icon ? `<img src="${esc(ev.icon)}" alt="">` : ''}</span>
    <span class="co-txt"><em>${esc(u.champion)}</em><b>${esc(u.talent?.spell || 'Talent')}</b></span>`;
  el.hidden = false; void el.offsetWidth; el.classList.add('go');
  clearTimeout(R.calloutT); R.calloutT = setTimeout(() => { el.hidden = true; }, 1300 / replay.speed);
}

function feed(html, k) {
  const li = document.createElement('li');
  li.className = `kf ${k}`; li.innerHTML = html;
  const list = $('#b-feed'); list.prepend(li);
  while (list.children.length > 4) list.lastChild.remove();
}
const face = (k, role) => `<img class="kf-face ${k}" src="${esc(champIcon(R.units[k][role]))}" alt="">`;
const KF_ICON = {
  kill: '<svg viewBox="0 0 24 24"><use href="#cls-FIGHTER"/></svg>', tower: '<svg viewBox="0 0 24 24"><use href="#ico-tower"/></svg>',
  dragon: '<svg viewBox="0 0 24 24"><use href="#cls-MAGE"/></svg>', fight: '<svg viewBox="0 0 24 24"><use href="#ico-arena"/></svg>',
};

/** Fait tomber les tours gagnées depuis l'événement précédent, de préférence dans la lane indiquée ; nexus à la fin. */
function updateTowers(ev, prev) {
  for (const side of ['A', 'B']) {
    const now = side === 'A' ? ev.towersA : ev.towersB;
    const before = side === 'A' ? prev.towersA : prev.towersB;
    const victim = (side === R.me) ? 'them' : 'me';
    for (let i = 0; i < now - before; i++) {
      const lane = ['top', 'mid', 'bot'].includes(ev.place) ? ev.place : null;
      const list = R.towers[victim];
      const t = list.find((x) => !x.down && x.lane === lane) || list.find((x) => !x.down);
      if (!t) break;
      t.down = true; t.el.classList.add('down');
      bfx.debris(t.pt, TEAM_COLOR[victim]);
      if (!replay.skip) audio.tone(120, 0.3, 'square', 0.05);
    }
  }
}

function scoreboard(ev) {
  const [km, kt, tm, tt, gm, gt] = R.me === 'A'
    ? [ev.killsA, ev.killsB, ev.towersA, ev.towersB, ev.goldA, ev.goldB] : [ev.killsB, ev.killsA, ev.towersB, ev.towersA, ev.goldB, ev.goldA];
  const bump = (sel, v) => { const n = $(sel); if (n.textContent !== String(v)) { n.textContent = v; n.classList.remove('bump'); void n.offsetWidth; n.classList.add('bump'); } };
  bump('#b-k-me', km); bump('#b-k-them', kt);
  $('#b-t-me').textContent = tm; $('#b-t-them').textContent = tt;
  $('#b-g-me').textContent = gm.toFixed(1); $('#b-g-them').textContent = gt.toFixed(1);
  $('#b-g-fill').style.width = `${gm + gt ? (gm / (gm + gt)) * 100 : 50}%`;
  $('#b-clock').textContent = `${String(ev.minute).padStart(2, '0')}:00`;
  R.score = { km, kt, tm, tt }; duelPanel();
}

/** Face-à-face des stats sous la carte : kills, tours, dragons, gardien ancien. */
function duelPanel() {
  const sc = R.score || { km: 0, kt: 0, tm: 0, tt: 0 }, o = R.obj || { me: { dragon: 0, ancient: 0 }, them: { dragon: 0, ancient: 0 } };
  const row = (label, a, b) => { const t = a + b || 1; return `<span class="dv">${a}</span><span class="dl">${label}</span><span class="dv r">${b}</span><i class="db"><b style="width:${(a / t) * 100}%"></b><b style="width:${(b / t) * 100}%"></b></i>`; };
  $('#b-duel').innerHTML = row('Kills', sc.km, sc.kt) + row('Tours', sc.tm, sc.tt) + row('Dragons', o.me.dragon, o.them.dragon) + row('Nashor', o.me.ancient, o.them.ancient);
}

/** Les deux équipes se regroupent autour du lieu du teamfight. */
async function enterFight(place) {
  R.fight = place;
  reviveAll(false);
  const c = MAP.fight[place] || [50, 50];
  for (const k of ['me', 'them']) for (let r = 0; r < 5; r++) {
    const off = MAP.cluster[r];
    move(k, r, P(k, add(c, off)));
  }
  await bpause(800);
}

async function stepEvent(ev, prev) {
  const k = ev.side === R.me ? 'me' : 'them';
  const o = k === 'me' ? 'them' : 'me';
  const place = ev.place;
  const color = TEAM_COLOR[k];
  const viewerWins = k === 'me';

  if (place?.startsWith('fight-')) { if (R.fight !== place) await enterFight(place); }
  else if (place) {
    if (R.fight) R.fight = null;
    reviveAll(true);
  }

  switch (ev.kind) {
    case 'GANK':
      if (ev.actor != null && MAP.gank[place]) { move(k, ev.actor, P(k, MAP.gank[place])); pulse(k, ev.actor, 'dash'); }
      await bpause(650);
      break;
    case 'KILL':
    case 'FIRST_BLOOD': {
      if (ev.actor == null) { await bpause(700); break; }
      const duel = MAP.duel[place] || {};
      for (const [role, pt] of Object.entries(duel)) { move('me', +role, pt); move('them', +role, mirror(pt)); }
      await bpause(500);
      const target = at(o, ev.target);
      const from = at(k, ev.actor);
      move(k, ev.actor, [from[0] + (target[0] - from[0]) * 0.6, from[1] + (target[1] - from[1]) * 0.6]);
      pulse(k, ev.actor, 'dash');
      await bpause(220);
      bfx.slash(at(k, ev.actor), target, color);
      die(o, ev.target, color);
      shake();
      if (!replay.skip) { audio.tone(viewerWins ? 700 : 220, 0.14, 'sawtooth', 0.08); buzz(30); }
      feed(`${face(k, ev.actor)}${ev.icon ? `<img class="kf-spell" src="${esc(ev.icon)}" alt="">` : KF_ICON.kill}${face(o, ev.target)}`, k);
      if (ev.kind === 'FIRST_BLOOD') announce('Premier sang', R.units[k][ev.actor].champion, k, 1500);
      await bpause(900);
      break;
    }
    case 'TALENT': {
      const actor = ev.actor;
      if (actor == null) { await bpause(800); break; }
      callout(k, actor, ev);
      pulse(k, actor, 'cast');
      bfx.burst(at(k, actor), '#ffc94d', 18, 0.7);
      if (!replay.skip) { audio.tone(880, 0.16, 'sine', 0.09); audio.tone(1320, 0.22, 'sine', 0.06, 0.08); }
      if (ev.target != null) {
        await bpause(350);
        bfx.slash(at(k, actor), at(o, ev.target), '#ffc94d');
        die(o, ev.target, '#ffc94d');
        feed(`${face(k, actor)}<img class="kf-spell" src="${esc(ev.icon || '')}" alt="">${face(o, ev.target)}`, k);
      } else if (MAP.gank[place]) {
        move(k, actor, P(k, MAP.gank[place]));
        feed(`${face(k, actor)}<img class="kf-spell" src="${esc(ev.icon || '')}" alt=""><span class="kf-txt">${esc(place)}</span>`, k);
      } else if (MAP.pit[place]) {
        await objective(k, place, actor, ev);
        break;
      } else {
        feed(`${face(k, actor)}<img class="kf-spell" src="${esc(ev.icon || '')}" alt=""><span class="kf-txt">${esc(R.units[k][actor].talent?.spell || '')}</span>`, k);
      }
      await bpause(1100);
      break;
    }
    case 'OBJECTIVE':
      await objective(k, place, ev.actor ?? 1, ev);
      break;
    case 'TOWER':
      if (ev.actor != null && MAP.gank[place]) move(k, ev.actor, P(k, MAP.gank[place]));
      feed(`${face(k, ev.actor ?? 0)}${KF_ICON.tower}<span class="kf-txt">${esc(place || '')}</span>`, k);
      await bpause(250);
      break;
    case 'FIGHT': {
      if (!replay.skip) { audio.burst(2); buzz([40, 30, 80]); }
      for (let i = 0; i < 3; i++) {
        const a = R.alive.me.findIndex(Boolean); const b = R.alive.them.findIndex(Boolean);
        if (a >= 0 && b >= 0) bfx.slash(at('me', a), at('them', b), i % 2 ? TEAM_COLOR.them : TEAM_COLOR.me);
        bfx.burst(MAP.fight[place] || [50, 50], i % 2 ? TEAM_COLOR.them : TEAM_COLOR.me, 20, 1.3);
        shake(i === 2);
        await bpause(240);
      }
      for (const r of ev.down || []) { die(o, r, color); await bpause(170); }
      for (const r of ev.lost || []) { die(k, r, TEAM_COLOR[o]); await bpause(170); }
      const won = (ev.down || []).length;
      announce(viewerWins ? 'Teamfight gagné' : 'Teamfight perdu', `${won} à ${(ev.lost || []).length}`, k, 1500);
      feed(`${KF_ICON.fight}<span class="kf-txt">Teamfight ${won}–${(ev.lost || []).length}</span>`, k);
      await bpause(1300);
      break;
    }
    case 'ACE':
      announce('Ace', viewerWins ? 'Toute l\'équipe adverse est à terre' : 'Toute ton équipe est à terre', k, 1500);
      shake(true);
      if (!replay.skip) audio.burst(3);
      await bpause(1200);
      break;
    case 'END': {
      R.fight = null;
      reviveAll(false);
      const enemyBase = P(o, MAP.base);
      for (let r = 0; r < 5; r++) if (R.alive[k][r]) move(k, r, P(k, add(mirror(MAP.base), MAP.siege[r])));
      await bpause(900);
      R.nexus[o].classList.add('down');
      bfx.burst(enemyBase, TEAM_COLOR[o], 90, 2.2);
      bfx.debris(enemyBase, TEAM_COLOR[o]);
      shake(true);
      if (!replay.skip) { audio.burst(5); buzz([80, 40, 160]); }
      await bpause(900);
      break;
    }
    default:
      await bpause(600);
  }
  updateTowers(ev, prev);
  scoreboard(ev);
}

/** Objectif neutre : les deux jungles (et supports) se ruent sur la fosse, le vainqueur l'emporte. */
async function objective(k, place, actor, ev) {
  const pit = MAP.pit[place] || MAP.pit.dragon;
  const sides = MAP.pitSide[place] || MAP.pitSide.dragon;
  for (const side of ['me', 'them']) for (const r of [1, 4]) move(side, r, P(side, sides[r]));
  const icon = $(place === 'ancient' ? '#b-ancient' : '#b-dragon');
  icon.classList.remove('taken', 'me', 'them'); icon.classList.add('contest');
  await bpause(700);
  if (actor !== 1 && actor !== 4) move(k, actor, add(P(k, sides[1]), [2, -2]));
  bfx.burst(pit, TEAM_COLOR[k], 50, 1.6);
  icon.classList.remove('contest'); icon.classList.add('taken', k);
  R.obj[k][place === 'ancient' ? 'ancient' : 'dragon']++; duelPanel();
  $(`#b-buffs-${k}`).insertAdjacentHTML('beforeend', `<img class="b-buff" src="https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-match-history/global/default/${place === 'ancient' ? 'baron' : 'dragon'}-100.png" alt="">`);
  shake();
  if (!replay.skip) audio.chime(3);
  if (ev.kind === 'TALENT') callout(k, actor, ev);
  announce(place === 'ancient' ? 'Gardien ancien' : 'Dragon', `${R.units[k][actor].champion} · ${k === 'me' ? (R.spectatorNames ? R.spectatorNames.me : 'ton équipe') : (R.spectatorNames ? R.spectatorNames.them : 'équipe adverse')}`, k, 1300);
  feed(`${face(k, actor)}${KF_ICON.dragon}<span class="kf-txt">${place === 'ancient' ? 'Gardien ancien' : 'Dragon'}</span>`, k);
  await bpause(1000);
}

function buildMap(mine, theirs) {
  R.units = { me: mine.units, them: theirs.units };
  R.tok = { me: [], them: [] }; R.pos = { me: [], them: [] }; R.alive = { me: [], them: [] };
  R.towers = { me: [], them: [] }; R.nexus = {}; R.fight = null;
  R.obj = { me: { dragon: 0, ancient: 0 }, them: { dragon: 0, ancient: 0 } }; R.score = null;
  $('#b-buffs-me').innerHTML = ''; $('#b-buffs-them').innerHTML = '';
  const towers = $('#b-towers'); const tokens = $('#b-tokens');
  towers.innerHTML = ''; tokens.innerHTML = '';
  for (const k of ['me', 'them']) {
    for (const [lane, pt0] of MAP.towers) {
      const pt = P(k, pt0);
      const el = document.createElement('span');
      el.className = `tower ${k}`; el.style.left = `${pt[0]}%`; el.style.top = `${pt[1]}%`;
      el.innerHTML = '<svg viewBox="0 0 24 24"><use href="#ico-tower"/></svg>';
      towers.append(el);
      R.towers[k].push({ el, lane, pt, down: false });
    }
    const n = P(k, MAP.nexus);
    const nexus = document.createElement('span');
    nexus.className = `nexus ${k}`; nexus.style.left = `${n[0]}%`; nexus.style.top = `${n[1]}%`;
    towers.append(nexus); R.nexus[k] = nexus;
    R.units[k].forEach((u, r) => {
      const el = document.createElement('span');
      el.className = `token ${k} r-${u.rarity}`;
      el.innerHTML = `<img src="${esc(champIcon(u))}" alt="${esc(u.champion)}"><i class="skull"></i>`;
      tokens.append(el);
      R.tok[k][r] = el; R.alive[k][r] = true;
      move(k, r, P(k, MAP.fountain[r]));
    });
  }
  $('#b-dragon').className = 'pit-icon dragon';
  $('#b-ancient').className = 'pit-icon ancient';
}

/** Rejoue un combat ; en spectateur (lien partagé), l'attaquant est à gauche et rien n'est « à toi ». */
/**
 * Rejoue un combat. live = partie contre le boss en cours ({ step }) : la partie s'arrête à chaque décision,
 * le choix part au serveur, puis la suite se joue ; à la fin, b devient le combat complet (score, XP).
 */
async function playBattle(b, { spectator = false, live = null } = {}) {
  replay.battle = b; replay.spectator = spectator;
  const mineA = spectator || b.attacker.userId === S.user?.id;
  R.me = mineA ? 'A' : 'B';
  let [mine, theirs] = mineA ? [b.a, b.b] : [b.b, b.a];
  const [pMe, pThem] = mineA ? [b.attacker, b.defender] : [b.defender, b.attacker];
  R.spectatorNames = spectator ? { me: pMe.displayName, them: pThem.displayName } : null;
  let won = mineA === b.attackerWon;
  const el = $('#battle');
  el.hidden = false; el.className = `battle${spectator ? ' spectator' : ''}`;
  $('#b-me-av').innerHTML = avatarInner(pMe); $('#b-them-av').innerHTML = avatarInner(pThem);
  setFrame($('#b-me-av'), pMe.frame, pMe.legend); setFrame($('#b-them-av'), pThem.frame, pThem.legend);
  $('#b-me-name').textContent = spectator ? pMe.displayName : mineA ? 'Toi' : 'Toi (défense)'; $('#b-them-name').textContent = pThem.displayName;
  $('#b-share').hidden = true; $('#b-feed').innerHTML = ''; $('#b-end').hidden = true;
  $('#b-announce').hidden = true; $('#b-callout').hidden = true; $('#b-tactic').hidden = true;
  $('#b-skip').hidden = false; $('#b-speed').hidden = false; $('#b-replay').hidden = true; $('#b-close').hidden = true;
  $('#b-speed').textContent = `×${replay.speed}`;
  buildMap(mine, theirs);
  bfx.fit(); bfx.parts = [];
  const zero = { minute: 0, killsA: 0, killsB: 0, towersA: 0, towersB: 0, goldA: 0, goldB: 0 };
  scoreboard(zero);
  replay.skip = false;

  await bpause(250);
  for (const k of ['me', 'them']) for (let r = 0; r < 5; r++) move(k, r, P(k, MAP.rest[r]));
  announce('Que le combat commence', `${pMe.displayName} contre ${pThem.displayName}`, 'neutral', 1500);
  await bpause(1400);

  let prev = zero;
  let i = 0;
  for (;;) {
    const events = live ? live.step.events : b.events;
    for (; i < events.length; i++) {
      if (el.hidden || replay.battle !== b) return;
      await stepEvent(events[i], prev);
      prev = events[i];
    }
    if (!live?.step.decision) break;
    // Décision : le combat attend le call du joueur (même en mode « Passer »).
    $('#b-announce').hidden = true; $('#b-callout').hidden = true;
    const choice = await askTactic(live.step.decision);
    if (el.hidden || replay.battle !== b) return;
    try {
      live.step = await api(`/capsules/boss/runs/${live.step.runId}/choose`, { method: 'POST', body: { choice } });
    } catch (e) { toast(e.message, true); continue; }
    const r = live.step.results[live.step.results.length - 1];
    replay.skip = false;
    announce(r.outcome > 0 ? 'Bien lu !' : r.outcome < 0 ? 'Contré' : 'Statu quo', r.text, r.outcome > 0 ? 'me' : r.outcome < 0 ? 'them' : 'neutral', 2000);
    if (r.outcome > 0) { audio.chime(3); buzz([30, 30, 60]); } else if (r.outcome < 0) buzz(80);
    await bpause(1900);
  }
  if (live) {
    // Fin de la partie contre le boss : le combat complet remplace la coquille.
    const results = live.step.results;
    b = { ...live.step.battle, tactics: results };
    replay.battle = b;
    [mine, theirs] = [b.a, b.b];
    won = b.attackerWon;
  }
  if (replay.battle !== b) return;
  if (replay.skip) { $('#b-announce').hidden = true; $('#b-callout').hidden = true; }

  // Écran de fin : résultat, gains et tableau des scores.
  const delta = pMe.ratingAfter - pMe.ratingBefore;
  const best = (units) => [...units].sort((x, y) => (y.kills * 2 - y.deaths) - (x.kills * 2 - x.deaths))[0];
  const winners = b.attackerWon ? b.a : b.b;
  const mvp = spectator ? best(winners.units) : best(mine.units);
  const rows = (units, k) => units.map((u, i) => `<div class="pg-row ${k}${u === mvp ? ' mvp' : ''}">
      <img src="${esc(champIcon(u))}" alt=""><span class="pg-name"><b>${esc(u.champion)}</b><em>${ROLES[i]}</em></span>
      ${u.talent?.icon ? `<img class="pg-talent" src="${esc(u.talent.icon)}" alt="" title="${esc(u.talent.spell)}">` : ''}
      <b class="pg-kd">${u.kills} / ${u.deaths}</b></div>`).join('');
  const title = spectator ? `Victoire de ${(b.attackerWon ? b.attacker : b.defender).displayName}`
    : b.boss ? (won ? 'Boss terrassé' : 'Le boss tient bon') : won ? 'Victoire' : 'Défaite';
  $('#b-end').innerHTML = `<div class="pg-title ${spectator || won ? 'win' : 'loss'}">${esc(title)}</div>
    <div class="end-chips">
      ${spectator ? `<span class="chip">${b.minutes} min</span>` : b.boss ? `<span class="chip gold">${fmtInt(b.bossScore)} dégâts${b.bossScore >= b.bossBest ? ' · record' : ''}</span>`
        : `<span class="chip ${delta >= 0 ? 'up' : 'down'}">${signed(delta)} pts · ${pMe.ratingAfter}</span>`}
      ${!spectator && mineA && b.essence ? `<span class="chip ess">+${b.essence} essence</span>` : ''}
      ${b.tactics?.length ? `<span class="chip">${b.tactics.filter((t) => t.outcome > 0).length} / ${b.tactics.length} calls réussis</span>` : ''}
</div>
    ${!spectator && mineA && b.passXp && S.arena?.pass ? (() => {
      const pa = S.arena.pass, xp = pa.xp + b.passXp, lvl = Math.min(pa.maxLevel, Math.floor(xp / pa.xpPerLevel)), into = lvl >= pa.maxLevel ? pa.xpPerLevel : xp - lvl * pa.xpPerLevel;
      return `<div class="pg-pass"><div class="pg-pass-head"><b>Pass · niveau ${lvl}${lvl > pa.level ? ' atteint' : ''}</b><span class="num">+${b.passXp} XP</span></div>
        <div class="pass-bar"><i style="width:${(into / pa.xpPerLevel) * 100}%"></i></div>
        ${(b.passRewards || []).map((r) => `<div class="pg-reward">${rewardIcon(r)}<div><b>Récompense débloquée</b><span>${rewardText(r)}</span></div></div>`).join('')}</div>`; })() : ''}
    <div class="pg-mvp">${unitImg(mvp)}<div><span class="kicker">Joueur du match</span><b>${esc(mvp.champion)}</b><span>${mvp.kills} kill${mvp.kills > 1 ? 's' : ''} · ${mvp.deaths} mort${mvp.deaths > 1 ? 's' : ''}</span></div></div>
    <div class="pg-board"><div class="pg-team me"><span class="kicker">${esc(spectator ? pMe.displayName : 'Ton équipe')}</span>${rows(mine.units, 'me')}</div>
      <div class="pg-team them"><span class="kicker">${esc(pThem.displayName)}</span>${rows(theirs.units, 'them')}</div></div>
    ${!spectator && mineA && won && !b.essence ? '<p class="muted">Essence du jour déjà empochée : la victoire compte pour la cote.</p>' : ''}
    ${!spectator && !won ? '<p class="muted">Regarde les vis-à-vis et les talents : un contre bien placé change tout.</p>' : ''}
    ${spectator && !S.token ? '<p class="muted">Ouvre des reliques, compose ton roster et défie tes amis.</p>' : ''}`;
  $('#b-end').hidden = false;
  el.classList.add(spectator || won ? 'won' : 'lost');
  if (spectator || won) { audio.chime(5); buzz([60, 40, 120]); } else { audio.tone(150, 0.6, 'sawtooth', 0.08); buzz(90); }
  $('#b-skip').hidden = true; $('#b-speed').hidden = true; $('#b-replay').hidden = false; $('#b-close').hidden = false;
  $('#b-close').textContent = spectator && !S.token ? 'Jouer aussi' : 'Continuer';
  $('#b-share').hidden = spectator || b.boss;
}

function closeBattle() {
  $('#battle').hidden = true;
  const ended = replay.battle;
  if (!replay.spectator && ended?.passRewards?.length && ended.attacker.userId === S.user?.id) showLevelUp(ended.passRewards);
  const wasSpectator = replay.spectator;
  replay.battle = null; replay.skip = true; replay.wake(); replay.spectator = false;
  if (new URLSearchParams(location.search).has('replay')) history.replaceState(null, '', location.pathname);
  if (wasSpectator && !S.token) { showAuth(); return; }
  if (S.view === 'arena') loadArena();
}

/** Lien public du combat : partage natif, sinon copie dans le presse-papiers. */
async function shareBattle() {
  const b = replay.battle; if (!b) return;
  try {
    const { code } = await api(`/capsules/battles/${b.id}/share`, { method: 'POST' });
    const url = `${location.origin}/reliques/?replay=${encodeURIComponent(code)}`;
    const title = `${b.attacker.displayName} contre ${b.defender.displayName}`;
    if (navigator.share) { try { await navigator.share({ title, text: `Regarde ce combat : ${title}`, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    await navigator.clipboard.writeText(url);
    toast('Lien du replay copié');
  } catch (e) { toast(e.message, true); }
}

/** Replay partagé (?replay=code) : visible sans compte. */
async function openSharedReplay(code) {
  try {
    if (!S.cat) await loadCatalog();
    const b = await api(`/replays/${encodeURIComponent(code)}`, { retry: true });
    const participant = S.user && (b.attacker.userId === S.user.id || b.defender.userId === S.user.id);
    await playBattle(b, { spectator: !participant });
  } catch (e) { toast(e.message, true); if (!S.token) showAuth(); }
}

function tierOf(rating) {
  const steps = [['CHALLENGER', 1850], ['GRANDMASTER', 1700], ['MASTER', 1550], ['DIAMOND', 1400], ['PLATINUM', 1250], ['GOLD', 1150], ['SILVER', 1050]];
  return (steps.find(([, min]) => rating >= min) || ['BRONZE'])[0];
}

/** Bilan de fin de saison : palier, rang et reliques reçues. */
function showSeasonEnd(r) {
  const rewards = [r.rewardStandard ? `+${r.rewardStandard} relique${r.rewardStandard > 1 ? 's' : ''}` : '', r.rewardPremium ? `+${r.rewardPremium} prestige` : '']
    .filter(Boolean).join(' · ');
  openSheet(`<div class="season-end" style="--tc:${TIER[r.tier].color}">
    <span class="kicker">Saison ${r.number} terminée</span>
    <div class="season-crest"><svg viewBox="0 0 64 64" aria-hidden="true"><use href="#emblem"/></svg><b class="season-tier">${TIER[r.tier].label}</b></div>
    <div class="facts"><div><b>#${r.rank}</b><span>Rang</span></div><div><b>${r.rating}</b><span>Cote finale</span></div><div><b>${r.wins} V · ${r.losses} D</b><span>Bilan</span></div></div>
    <p class="season-reward">${rewards ? `<b>${rewards}</b> ajoutées à ton stock` : `Joue au moins 5 combats dans une saison pour recevoir des reliques.`}</p>
    <p class="muted">Nouvelle saison : ta cote repart à mi-chemin de 1000, ton palier final devient ton cadre. À toi de grimper !</p>
    <button class="btn primary big block" id="season-ok">${rewards ? 'Récupérer' : 'C\'est parti'}</button>
    <button class="btn ghost block" id="season-share" type="button">Partager mon bilan</button>
  </div>`);
  $('#season-share').onclick = () => shareSeasonCard(r).catch((e) => toast(e.message, true));
  $('#season-ok').onclick = async () => {
    closeSheet();
    try {
      await api(`/capsules/seasons/${r.id}/seen`, { method: 'POST' });
      setWallet(await api('/capsules/state'));
      if (rewards) { audio.chime(5); buzz([60, 40, 120]); toast(`${rewards} : bonne ouverture !`); }
    } catch (e) { toast(e.message, true); }
  };
}

/** Image du bilan de saison (1080 × 1350) : partage natif avec fichier, sinon téléchargement. */
async function shareSeasonCard(r) {
  const W = 1080, H = 1350;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const tc = TIER[r.tier].color;
  const font = getComputedStyle(document.documentElement).getPropertyValue('--display').trim() || 'sans-serif';
  await document.fonts?.ready;
  const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#0d1222'); bg.addColorStop(1, '#05070c');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W / 2, 520, 30, W / 2, 520, 560); glow.addColorStop(0, `${tc}55`); glow.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = glow; g.fillRect(0, 0, W, H);
  g.textAlign = 'center';
  g.fillStyle = '#8b95a7'; g.font = `700 40px ${font}`; g.fillText(`RELIQUES · SAISON ${r.number}`, W / 2, 130);
  g.fillStyle = '#ffffff'; g.font = `700 84px ${font}`; g.fillText((S.user?.displayName || '').toUpperCase(), W / 2, 240, W - 120);
  g.save(); g.translate(W / 2, 540); g.scale(6, 6); g.translate(-32, -32);
  const shield = new Path2D('M32 4 56 14v18c0 14-10 24-24 28C18 56 8 46 8 32V14z');
  g.fillStyle = `${tc}26`; g.fill(shield); g.lineWidth = 1.1; g.strokeStyle = tc; g.stroke(shield); g.restore();
  g.fillStyle = tc; g.font = `700 96px ${font}`; g.fillText(TIER[r.tier].label.toUpperCase(), W / 2, 575, 300 * 2);
  const stats = [[`#${r.rank}${r.players ? ` / ${r.players}` : ''}`, 'RANG'], [String(r.rating), 'COTE FINALE'], [`${r.wins} V · ${r.losses} D`, 'BILAN'], [`NIV. ${r.passLevel ?? 0}`, 'PASS DE SAISON']];
  stats.forEach(([v, l], i) => {
    const x = i % 2 ? W * 0.72 : W * 0.28, y = 930 + Math.floor(i / 2) * 170;
    g.fillStyle = '#ffffff'; g.font = `700 76px ${font}`; g.fillText(v, x, y, W / 2 - 60);
    g.fillStyle = '#8b95a7'; g.font = `700 30px ${font}`; g.fillText(l, x, y + 48);
  });
  const quip = r.rank === 1 ? 'CHAMPION DE SAISON. INCLINEZ-VOUS.' : r.rank <= 3 ? 'SUR LE PODIUM. LES AUTRES REGARDENT.'
    : r.players && r.rank === r.players ? 'LANTERNE ROUGE. ÇA NE PEUT QUE MONTER.' : 'LA SAISON PROCHAINE, C\'EST LA BONNE.';
  g.fillStyle = tc; g.font = `700 38px ${font}`; g.fillText(quip, W / 2, H - 90, W - 100);
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  const file = new File([blob], `reliques-saison-${r.number}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: `Ma saison ${r.number}` }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('Image du bilan téléchargée');
}

function showUnitTalent(role) {
  const u = S.arena?.team?.units[role]; if (!u?.talent) return;
  openSheet(`<div class="unit-sheet"><span class="kicker">${ROLES[u.role]} · ${fitLabel(u.fitPercent).toLowerCase()}</span><h2>${esc(u.champion)}</h2>
    ${profileHTML(u.profile, true)}${talentHTML(u.talent, true)}</div>`);
}

// ---------- Tuto (stories) ----------
const TUTO = [
  { kicker: 'L\'arène', title: 'Ton roster part au combat', text: 'Tes 5 champions affrontent ceux d\'un autre joueur, poste contre poste. Son roster se défend même quand il dort.', art: () => tutoRoster() },
  { kicker: 'Règle 1', title: 'Chacun à sa place', text: 'Chaque champion a un poste principal, parfois un secondaire. Tous les postes restent ouverts, mais hors poste il perd de la puissance.', art: () => tutoRoles() },
  { kicker: 'Règle 2', title: 'Early, mid ou late', text: 'Un champion early écrase les lanes, un late gagne les derniers teamfights. Les solos gagnent leurs duels, les teamfights brillent à cinq.', art: () => tutoCurves() },
  { kicker: 'Règle 3', title: 'Une vraie compo', text: 'Une frontline, des dégâts, de quoi protéger. Les tireurs font fondre les tanks, les assassins plongent sur les carrys mal protégés.', art: () => tutoClasses() },
  { kicker: 'Règle 4', title: 'Les bonus s\'empilent', text: 'Skins d\'une même gamme, comp teamfight, rareté : tout ajoute de la puissance.', art: () => tutoSynergy() },
  { kicker: 'Règle 5', title: 'Chaque champion a son talent', text: 'Le sort qui fait son identité change la partie : Destinée rejoint une autre lane, Retour temporel renverse un combat, Grappin attrape une cible.', art: () => tutoTalents() },
  { kicker: 'Le match', title: 'Lanes, dragons, teamfights', text: 'Gagner ses lanes rapporte de l\'or. L\'or et les dragons font pencher les teamfights. Le premier à 2 l\'emporte.', art: () => tutoTimeline() },
  { kicker: 'Récompenses', title: 'Grimpe et remplis ta forge', text: '2 victoires = 1 relique, jusqu\'à 4 victoires payées par jour. Un seul défi par joueur jusqu\'à sa riposte (ou 24 h).', art: () => tutoRewards() },
  { kicker: 'Saisons', title: 'Deux semaines, un classement', text: 'Grimpe de Bronze à Challenger. En fin de saison, ton palier te rapporte des reliques et devient le cadre de ton icône, puis tout le monde repart.', art: () => tutoSeasons(), cta: 'Entrer dans l\'arène' },
];
const tuto = { i: 0, x: 0 };

function tutoRoster() {
  const arts = S.arena?.team?.units ? S.arena.team.units.map(unitItem) : S.roster.map((s) => S.cat && slotItem(s));
  return `<div class="ta-roster">${ROLES.map((r, i) => `<span class="ta-card${arts[i] ? ` r-${arts[i].rarity}` : ''}" style="--i:${i}">
    ${arts[i] ? `<img src="${esc(arts[i].art)}" alt="">` : ''}<em>${r}</em></span>`).join('')}</div>
    <div class="ta-vs">VS</div>`;
}

function tutoRoles() {
  const rows = [['Poste principal', 'Leona support', '+12 %', 'up'], ['Poste secondaire', 'Malphite support', '+8 %', 'up'], ['Hors poste', 'Sion support', '−10 %', 'down']];
  return `<div class="ta-roles">${rows.map(([r, ex, v, c], i) => `<div class="ta-role" style="--i:${i}"><b>${r}</b><span><span class="ta-cls">${ex}</span><span class="fit ${c}">${v}</span></span></div>`).join('')}</div>`;
}

function tutoCurves() {
  const rows = [['EARLY', 'Lanes'], ['MID', 'Dragons et 1er teamfight'], ['LATE', 'Derniers teamfights']];
  return `<div class="ta-roles">${rows.map(([c, when], i) => `<div class="ta-role" style="--i:${i}"><b style="color:${CURVE[c].color}">${CURVE[c].label}</b><span><span class="ta-cls">${when}</span></span></div>`).join('')}</div>`;
}

function tutoClasses() {
  const rows = [['TANK', 'Encaisse assassins et combattants'], ['MARKSMAN', 'Fait fondre la frontline'], ['ASSASSIN', 'Plonge sur les carrys'], ['SUPPORT', 'Protège des assassins']];
  return `<div class="ta-roles">${rows.map(([c, t], i) => `<div class="ta-role" style="--i:${i}"><span class="ta-cls">${clsIcon(c)}${CLASS[c].label}</span><span><span class="ta-cls">${t}</span></span></div>`).join('')}</div>`;
}

function tutoSynergy() {
  const rows = [['Gamme ×3', '+6 %', 'var(--violet)'], ['Comp teamfight', '+5 %', 'var(--green)'], ['Exalté', '+12 %', 'var(--yellow)']];
  return `<div class="ta-syn">${rows.map(([l, v, c], i) => `<div class="ta-chip" style="--i:${i};--c:${c}"><span>${l}</span><b>${v}</b></div>`).join('')}
    <div class="ta-power"><span class="kicker">Puissance</span><i><i></i></i></div></div>`;
}

function tutoTalents() {
  const picks = [4, 26, 53].map((id) => S.cat?.champ.get(id)).filter((c) => c?.talent);
  return `<div class="ta-talents">${picks.map((c, i) => `<div class="ta-talent" style="--i:${i}">
    <span class="ta-portrait"><img src="${esc(`${DD}/loading/${c.alias}_0.jpg`)}" alt=""></span>
    <div><b>${esc(c.name)}</b>${talentHTML(c.talent, true)}</div></div>`).join('')}</div>`;
}

function tutoSeasons() {
  return `<div class="ta-tiers">${Object.keys(TIER).map((t, i) => `<span class="ta-tier" style="--i:${i};--tc:${TIER[t].color};--h:${28 + i * 10}%">${TIER[t].label}</span>`).join('')}</div>`;
}

function tutoTimeline() {
  const steps = [['3\'', 'Lanes', 'Duels et ganks'], ['12\'', 'Dragons', 'Bonus d\'équipe'], ['20\'', 'Teamfights', 'Premier à 2']];
  return `<div class="ta-time">${steps.map(([t, l, s], i) => `<div class="ta-step" style="--i:${i}"><span class="dot">${t}</span><b>${l}</b><span>${s}</span></div>`).join('')}</div>`;
}

function tutoRewards() {
  return `<div class="ta-rew">
    <div class="ta-eq"><span class="ta-win">V</span><span class="op">+</span><span class="ta-win">V</span><span class="op">=</span>
      <svg viewBox="0 0 64 64"><use href="#capsule-mini"/></svg></div>
    <div class="ta-elo"><span class="kicker">Cote</span><b>1000 → 1016</b></div>
    <div class="ta-podium"><i style="--h:60%"></i><i style="--h:90%"></i><i style="--h:40%"></i></div></div>`;
}

function showTuto() {
  tuto.i = 0;
  store.set(NEWS_KEY, '1');
  closeSheet();
  $('#tuto-track').innerHTML = TUTO.map((t, i) => `<section class="tuto-slide" data-slide="${i}">
    <div class="tuto-art">${t.art()}</div>
    <div class="tuto-copy"><span class="kicker">${t.kicker}</span><h2>${t.title}</h2><p>${t.text}</p></div></section>`).join('');
  $('#tuto-bars').innerHTML = TUTO.map(() => '<i><i></i></i>').join('');
  $('#tuto').hidden = false;
  tutoGo(0);
}

function tutoGo(i) {
  if (i >= TUTO.length) { closeTuto(); return; }
  tuto.i = Math.max(0, i);
  $$('.tuto-slide').forEach((s, k) => { s.classList.toggle('on', k === tuto.i); s.classList.toggle('past', k < tuto.i); });
  $$('#tuto-bars > i').forEach((b, k) => { b.className = k < tuto.i ? 'done' : k === tuto.i ? 'cur' : ''; });
  $('#tuto-prev').disabled = tuto.i === 0;
  $('#tuto-next').textContent = TUTO[tuto.i].cta || 'Suivant';
  buzz(10);
}

function closeTuto() {
  $('#tuto').hidden = true;
  store.set(TUTO_KEY, '1');
}

function bindArena() {
  $$('[data-arena]').forEach((b) => (b.onclick = () => { S.arenaTab = b.dataset.arena; renderArenaBody(); }));
  $('#tuto-btn').onclick = showTuto;
  $('#tuto-menu').onclick = () => showTuto();
  $('#tuto-next').onclick = () => tutoGo(tuto.i + 1);
  $('#tuto-prev').onclick = () => tutoGo(tuto.i - 1);
  $('#tuto-x').onclick = closeTuto;
  // Toucher à droite avance, à gauche recule ; balayage horizontal.
  const track = $('#tuto-track');
  track.addEventListener('click', (e) => tutoGo(tuto.i + (e.clientX > innerWidth / 3 ? 1 : -1)));
  track.addEventListener('touchstart', (e) => { tuto.x = e.touches[0].clientX; }, { passive: true });
  track.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - tuto.x;
    if (Math.abs(dx) > 50) { e.preventDefault(); tutoGo(tuto.i + (dx < 0 ? 1 : -1)); }
  });
  addEventListener('keydown', (e) => {
    if ($('#tuto').hidden) return;
    if (e.key === 'ArrowRight') tutoGo(tuto.i + 1);
    else if (e.key === 'ArrowLeft') tutoGo(tuto.i - 1);
    else if (e.key === 'Escape') closeTuto();
  });
  $('#b-skip').onclick = () => { replay.skip = true; replay.wake(); };
  $('#b-speed').onclick = () => { replay.speed = replay.speed === 1 ? 2 : 1; $('#b-speed').textContent = `×${replay.speed}`; };
  addEventListener('resize', () => { if (!$('#battle').hidden) bfx.fit(); });
  $('#b-replay').onclick = () => replay.battle && playBattle(replay.battle);
  $('#b-close').onclick = closeBattle;
  $('#b-share').onclick = shareBattle;
  $('#arena-team').addEventListener('click', (e) => { const u = e.target.closest('[data-unit]'); if (u) showUnitTalent(+u.dataset.unit); });
  $('#view-arena').addEventListener('click', (e) => {
    const go = e.target.closest('[data-arena-go]');
    if (go) { S.arenaTab = go.dataset.arenaGo; renderArenaBody(); $('.arena-tabs').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (e.target.closest('[data-meta-open]')) showMeta();
  });
}

// ---------- Navigation ----------
// ---------- Mise en scène commune : titre, fond teinté par l'art, entrée animée ----------
const VIEW_TITLE = { open: 'Reliques', collection: 'Collection', arena: 'Arène', friends: 'Club', profile: 'Profil' };
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Fond d'ambiance : l'illustration mise en avant, très floue, en haut de l'écran (ou une couleur). */
function setAmbient(src, color) {
  const el = $('#amb'); if (!el) return;
  el.style.backgroundImage = src ? `url('${src}')` : color ? `radial-gradient(circle at 30% 30%, ${color}, transparent 60%)` : 'none';
}

/** Skin mis en avant par écran : dernier tirage, plus rare possédé, gros tirage d'un pote, signature. */
function ambientFor(v) {
  const best = () => [...S.owned.keys()].map(fromKey).filter((it) => it?.kind === 'SKIN').sort((a, b) => rank(b.rarity) - rank(a.rarity))[0];
  if (v === 'open') { const d = S.recent?.[0]; const it = d && item(d.kind, d.itemId); return setAmbient(it?.splash); }
  if (v === 'collection') return setAmbient(best()?.splash);
  if (v === 'arena') return setAmbient(null, S.arena ? TIER[S.arena.season.tier].color : '#c8a96a');
  if (v === 'friends') { const f = (S.feed || []).find((x) => x.kind === 'DROP'); const it = f && item(f.itemKind, f.itemId); return setAmbient(it?.splash || best()?.splash); }
  if (v === 'profile') { const sig = S.myStats?.signature && item(S.myStats.signature.kind, S.myStats.signature.itemId); return setAmbient(sig?.splash || best()?.splash); }
}

/** Les chiffres défilent jusqu'à leur valeur, les barres se remplissent. */
function animateIn(root) {
  if (!root || reduceMotion()) return;
  $$('.num, .me-stats b, .stock-big b', root).forEach((el) => {
    if (el.children.length) return;
    const m = el.textContent.trim().match(/^([+\u2212-]?)(\d[\d\s\u00a0\u202f]*)(\s?%?)$/);
    if (!m) return;
    const to = +m[2].replace(/\D/g, ''); if (!to) return;
    const t0 = performance.now(), dur = 700 + Math.min(to, 2000) * 0.15;
    const step = (t) => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = m[1] + fmtInt(Math.round(to * e)) + m[3]; if (k < 1 && el.isConnected) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
  $$('.tier-bar i, .meter i, .pass-bar i', root).forEach((i) => {
    const w = i.style.width; if (!w) return;
    i.style.transition = 'none'; i.style.width = '0'; void i.offsetWidth; i.style.transition = ''; i.style.width = w;
  });
}

function enterView(v) {
  const el = $(`#view-${v}`); if (!el) return;
  $('#view-title').textContent = VIEW_TITLE[v] || 'Reliques';
  ambientFor(v);
  el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter');
  setTimeout(() => animateIn(el), 60);
}

function setView(v, { friend = false } = {}) {
  // Quitter la collection d'un ami : retour à la sienne.
  if (!friend) S.friend = null;
  S.view = v;
  $('#view-open').hidden = v !== 'open';
  $('#view-collection').hidden = v !== 'collection';
  $('#view-friends').hidden = v !== 'friends';
  $('#view-arena').hidden = v !== 'arena';
  $('#view-profile').hidden = v !== 'profile';
  if (v === 'profile') { renderMe(); if (S.user) api(`/capsules/players/${S.user.id}/stats`).then((st) => { S.myStats = st; renderMe(); }).catch(() => {}); }
  const tab = friend ? 'friends' : v;
  $$('[data-view]').forEach((b) => (b.dataset.view === tab ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  if (v === 'collection') {
    $('#owner-bar').hidden = !S.friend;
    if (S.friend) { $('#owner-name').textContent = S.friend.name; $('#owner-follow').hidden = S.friend.added; }
    renderRoster();
    renderCollection();
  }
  if (v === 'friends') loadFriends();
  if (v === 'arena') {
    if (S.arena) { renderArenaHead(); renderArenaTeam(); renderArenaBody(); }
    // Tuto à la première visite, une fois le roster connu (ses cartes illustrent la première story).
    loadArena().then(() => { if (!store.get(TUTO_KEY) && S.view === 'arena' && $('#tuto').hidden) showTuto(); });
  }
  scrollTo({ top: 0 });
  enterView(v);
}

// ---------- PWA : installation et notifications ----------
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let installEvent = null;

const isMobile = matchMedia('(pointer: coarse)').matches || innerWidth < 760;

// Entrée « Installer l'app » du menu (masquée une fois installée) et popup au premier lancement sur mobile.
function setupInstall() {
  $('#install-menu').hidden = standalone;
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; });
  addEventListener('appinstalled', () => { installEvent = null; $('#install-menu').hidden = true; closeSheet(); toast('App installée !'); });
  $('#install-menu').onclick = () => showInstall();
}

const NEWS_KEY = 'capsules.news.v4-redesign';

/**
 * Note de patch de la refonte : écran plein, une seule fois. Le cristal tombe et éclate, puis le titre
 * sur un défilé de splash arts, et les nouveautés arrivent une à une.
 */
async function maybeShowNews() {
  if (store.get(NEWS_KEY) || !$('#tuto').hidden) return;
  // Nouveau joueur : rien à « mettre à jour », la note de patch ne le concerne pas.
  if (!(S.wallet?.totalOpened > 0)) { store.set(NEWS_KEY, '1'); return; }
  store.set(NEWS_KEY, '1');
  const MAP_IMG = 'https://ddragon.leagueoflegends.com/cdn/16.22.1/img/map/map11.png';
  const splashes = ['Ahri_1', 'Jinx_1', 'Leona_1', 'Yasuo_1', 'Kaisa_1', 'Lux_1'].map((a) => `${DD}/splash/${a}.jpg`);
  const feats = [
    ['Ouvrir devient un rituel', 'Le cristal monte de rareté sous une colonne de lumière, éclate, et la carte se révèle en silhouette. Puis on te dit si le skin renforce ton équipe.', '<svg viewBox="0 0 100 100" class="nf-crys"><use href="#crystal"/></svg>'],
    ['Tes matchs sur la vraie carte', 'Dragon, Nashor, tours, sorts des champions : chaque combat se rejoue sur la Faille.', `<img src="${MAP_IMG}" alt="">`],
    ['Le Club', 'Les gros tirages et les combats de tes potes, ta bête noire et la revanche en un geste.', '<svg viewBox="0 0 24 24" class="nf-ico"><circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.5 2.7-5.5 6-5.5s6 2 6 5.5"/><circle cx="17" cy="9" r="2.6"/><path d="M16.5 14.6c2.7 0 4.5 1.8 4.5 5.4"/></svg>'],
    ['Ta collection en étagères', 'Une étagère par gamme, les manquants en ombre, et la puissance réelle de chaque skin dans ta fiche.', '<svg viewBox="0 0 24 24" class="nf-ico"><rect x="4" y="4" width="7" height="9" rx="2"/><rect x="13" y="4" width="7" height="5" rx="2"/><rect x="4" y="15" width="7" height="5" rx="2"/><rect x="13" y="11" width="7" height="9" rx="2"/></svg>'],
    ['Et Ahri, plus kawaii que jamais', 'Partout où elle apparaît, la reine a ses oreilles, son sticker et ses cœurs.', `<span class="nf-fox">${FOX_SVG}</span>`],
  ];
  const el = document.createElement('div');
  el.className = 'news2'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Nouveautés');
  el.innerHTML = `<div class="nf-bg">${splashes.map((u, i) => `<i style="background-image:url('${u}');animation-delay:${i * 3}s"></i>`).join('')}</div>
    <div class="nf-shade"></div>
    <svg class="nf-drop" viewBox="0 0 100 100" aria-hidden="true"><use href="#crystal"/></svg><div class="nf-flash"></div>
    <div class="nf-body">
      <span class="kicker">Note de patch</span>
      <h2>Reliques fait peau neuve</h2>
      <div class="nf-list">${feats.map(([t, d, v], i) => `<div class="nf-item" style="animation-delay:${1.6 + i * 0.35}s"><span class="nf-vis">${v}</span><div><b>${t}</b><span>${d}</span></div></div>`).join('')}</div>
      <button class="btn primary big block" type="button" id="news-go" style="animation-delay:${1.6 + feats.length * 0.35}s">C'est parti</button>
    </div>`;
  document.body.appendChild(el);
  audio.chime(5); buzz([40, 30, 80]);
  await new Promise((resolve) => { $('#news-go').onclick = () => { el.classList.add('out'); setTimeout(() => { el.remove(); resolve(); }, 300); setView('open'); }; });
}

// ---------- Méta de la semaine ----------
const META_KEY = 'reliques.meta.seen';

async function loadMeta() {
  try { S.meta = await api('/capsules/meta'); renderRoster(); } catch { /* le patch attendra le prochain lancement */ }
}

/** Notes du patch à la première visite après sa sortie. */
async function maybeShowMeta() {
  if (!S.meta?.changes.length || store.get(META_KEY) === S.meta.id || !$('#tuto').hidden) return;
  store.set(META_KEY, S.meta.id);
  showMeta();
  while (!$('#sheet').hidden) await sleep(300);
}

function showMeta() {
  const m = S.meta;
  const day = (d) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  const row = (c) => {
    const champ = c.target === 'CHAMPION' && S.cat?.champ.get(c.championId);
    return `<div class="meta-row ${c.percent > 0 ? 'up' : 'down'}">
      <span class="meta-pic">${champ ? `<img loading="lazy" src="${DD}/loading/${esc(champ.alias)}_0.jpg" alt="">` : `<b>${esc(c.name.slice(0, 2))}</b>`}</span>
      <span class="meta-txt"><b>${esc(c.name)}</b><span>${c.target === 'CLASS' ? 'Classe · ' : ''}${esc(c.reason)}</span></span>
      <span class="meta-pct">${c.percent > 0 ? '▲' : '▼'} ${signed(c.percent)} %</span></div>`;
  };
  const buffs = m.changes.filter((c) => c.percent > 0), nerfs = m.changes.filter((c) => c.percent < 0);
  const mine = rosterItems(S.roster).filter(Boolean).filter((it) => metaOf(it.champ) < 0);
  openSheet(`<div class="meta-notes">
    <span class="kicker">Patch ${m.number} · du ${day(m.startsAt)} au ${day(new Date(m.endsAt) - 1)}</span>
    <h2>Notes de patch</h2>
    <p class="muted">Chaque lundi, les champions les plus joués sont nerfés et des champions oubliés reviennent en force. Adapte ton roster !</p>
    ${mine.length ? `<p class="meta-warn">Ton roster est touché : ${mine.map((it) => esc(it.champ.name)).join(', ')}.</p>` : ''}
    ${buffs.length ? `<section><h3 class="up">Buffs</h3>${buffs.map(row).join('')}</section>` : ''}
    ${nerfs.length ? `<section><h3 class="down">Nerfs</h3>${nerfs.map(row).join('')}</section>` : ''}
    <button class="btn primary block" type="button" data-meta-go>${mine.length ? 'Revoir mon roster' : 'Compris'}</button>
  </div>`);
  $('[data-meta-go]').onclick = () => { closeSheet(); if (mine.length) setView('collection'); };
}

// ---------- Guide des règles (miroir chiffré de BattleRules, Talents, Meta et BattleService) ----------
const GUIDE_TALENTS = [
  ['Domination', '×1,25 en lane, +2 % par teamfight.'],
  ['Gank', 'Gank plus fréquent (50 % au lieu de 35 %), duel de jungle ×1,6 et gank ×1,35.'],
  ['Global', 'Rejoint une autre lane pendant la phase de lanes, avec 40 % de sa puissance.'],
  ['Objectif', 'Dragons et gardien ancien disputés ×1,2.'],
  ['Engage', '+10 % au premier teamfight.'],
  ['Teamfight', '+5 % à chaque teamfight.'],
  ['Attrape', '25 % de chances avant chaque teamfight d\'éliminer un adversaire, qui rate le combat.'],
  ['Protection', '+3 % en teamfight, une élimination de moins subie par combat.'],
  ['Résurrection', 'Une fois par partie, 18 % de chances de retourner un teamfight perdu.'],
  ['Scaling', '−7 % en lane, puis +12 %, +24 %, +36 % aux teamfights 1, 2 et 3.'],
  ['Exécution', '+4 % en teamfight et une élimination bonus.'],
  ['Split-push', '+1 tour à chaque teamfight, +5 % au troisième.'],
  ['Poke', '+1 tour si l\'équipe gagne une lane.'],
  ['Soin', '+4 % en teamfight, le retard en or compte moitié moins.'],
  ['Hypercarry', '+3 % en teamfight, +10 % si l\'équipe a gagné le précédent ; une élimination bonus.'],
  ['Vol', 'Copie le talent de l\'adversaire le plus puissant.'],
];

function showGuide() {
  const pct = (v) => `<b class="g-num ${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${signed(v)} %</b>`;
  const rows = (list) => `<div class="g-rows">${list.map(([l, v]) => `<div class="g-row"><span>${l}</span>${typeof v === 'number' ? pct(v) : `<b class="g-num">${v}</b>`}</div>`).join('')}</div>`;
  const sec = (title, body, open = false) => `<details class="g-sec"${open ? ' open' : ''}><summary>${title}</summary><div class="g-body">${body}</div></details>`;
  openSheet(`<div class="guide">
    <span class="kicker">Arène</span>
    <h2>Guide des règles</h2>
    <p class="muted">Tous les chiffres du moteur de combat, pour monter la meilleure équipe.</p>
    ${sec('1. La puissance d\'un champion', `<p>Chaque champion part de <b>100</b>, multiplié par ses bonus :</p>
      <p class="g-formula">100 × rareté × poste × gamme × méta</p>
      <p>La puissance de l'équipe est la somme des 5. Elle pèse dans chaque duel, objectif et teamfight.</p>`, true)}
    ${sec('2. Le poste', `${rows([['Poste principal', FIT.main], ['Poste secondaire', FIT.secondary], ['Hors poste', FIT.off]])}
      <p>Tous les postes sont ouverts. Le badge en % sur chaque case de ton roster montre le bonus.</p>`)}
    ${sec('3. La rareté', `${rows(RARITIES.map((r) => [LABEL[r], rank(r) * 2]))}
      <p><b>Un champion de base compte comme Exalté</b> (+12 %). Un skin prend la rareté du skin, mais peut apporter un bonus de gamme.</p>`)}
    ${sec('4. Gammes et doublons', `${rows([['Gamme commune ×2', 3], ['Gamme commune ×3', 6], ['Gamme commune ×4', 9], ['Gamme commune ×5', 12], ['Champion en double', -10]])}
      <p>Seule ta gamme la plus représentée compte : +3 % par skin au-delà du premier, pour toute l'équipe.</p>`)}
    ${sec('5. La méta de la semaine', `<p>Chaque lundi (heure de Paris), un patch est figé à partir des rosters du moment :</p>
      ${rows([['Les 4 champions les plus joués', -8], ['4 champions peu joués', 8], ['Classe principale la plus jouée', -4], ['Classe principale la moins jouée', 4]])}
      <p>Le bonus d'un champion et celui de sa classe se cumulent (ex. un tireur nerfé : −8 % puis −4 %).</p>
      ${S.meta?.changes.length ? '<button class="btn ghost small" type="button" data-guide-meta>Voir le patch de la semaine</button>' : ''}`)}
    ${sec('6. Courbe et style', `<p>Multiplicateur de la courbe selon la phase :</p>
      <div class="g-table"><span></span><b>Lanes</b><b>1er TF</b><b>TF 2-3</b>
        ${Object.entries({ EARLY: [1.18, 1.02, 0.88], MID: [0.98, 1.08, 0.98], LATE: [0.88, 0.98, 1.18] }).map(([c, v]) => `<b style="color:${CURVE[c].color}">${CURVE[c].label}</b>${v.map((x) => `<span>×${x.toFixed(2).replace('.', ',')}</span>`).join('')}`).join('')}</div>
      <p>Le style s'ajoute : <b>Solo</b> ×1,10 en lane et ×0,97 en teamfight ; <b>Teamfight</b> ×0,95 en lane et ×1,04 en teamfight.</p>
      <p>Les teamfights décident la partie : les champions late et teamfight y sont les plus forts.</p>`)}
    ${sec('7. La compo', `${rows([['Pas de frontline (tank ou combattant)', -10], ['Pas de dégâts (tireur, mage ou assassin)', -10], ['Ni support ni tank', -5], ['3 champions teamfight ou plus', 5], ['2 champions solo ou plus', '+1 tour / TF']])}
      <p>Ces bonus et malus s'appliquent en teamfight. La classe principale est la première listée sur le champion.</p>`)}
    ${sec('8. Les contres de classe', `<p>En teamfight, chaque champion gagne un bonus selon la compo adverse (classe principale, plafond +12 %) :</p>
      ${rows([['Tireur', '+4 % par tank ou combattant'], ['Assassin', '+4 % par carry adverse non protégé'], ['Tank', '+3 % par assassin ou combattant'], ['Combattant', '+3 % par mage ou assassin'], ['Support', '+4 % par assassin, +2 % par combattant'], ['Mage', '+8 % face à 3 mêlées ou plus']])}`)}
    ${sec('9. Les talents', `<p>Chaque champion a un talent, nommé d'après un de ses sorts :</p>${rows(GUIDE_TALENTS)}`)}
    ${sec('10. Le déroulé d\'un match', `<ul class="g-list">
      <li><b>Lanes</b> : top, mid et bot (tireur + support) en duel, poste contre poste. Le jungler adverse peut ganker (35 % de chances).</li>
      <li><b>Dragons</b> : disputés par le jungler et le support. Chaque dragon donne +4 % à l'équipe, le gardien ancien +8 % avant le 3e teamfight.</li>
      <li><b>Or</b> : kills, tours et objectifs donnent de l'or. L'avance en or vaut au plus ±15 % de puissance.</li>
      <li><b>Teamfights</b> : au meilleur des 3. Le premier se joue en milieu de partie, les suivants en fin de partie.</li>
      <li>Une part de hasard reste : à puissance égale, c'est du 50/50.</li>
      <li><b>Aperçu</b> : la tendance (de « Gros désavantage » à « Gros avantage ») vient de parties simulées avec les talents, courbes et contres. Elle indique où chaque équipe est forte, pas qui gagne.</li>
      <li><b>Coups de poker</b> : Attrape, Résurrection, Scaling et Hypercarry peuvent tout renverser comme ne rien faire. Avec 3 ou plus, ton équipe est <b>Volatile</b> : ça passe ou ça casse.</li></ul>`)}
    ${sec('11. Cote, récompenses et saisons', `<ul class="g-list">
      <li><b>Cote</b> : Elo de facteur 32. À cote égale, ±16. Un défenseur battu perd les trois quarts du gain de l'attaquant.</li>
      <li><b>Essence</b> : 2 victoires en attaque = 1 relique, jusqu'à 4 victoires payées par jour.</li>
      <li><b>Revanche</b> : un seul défi par joueur jusqu'à sa riposte, ou 24 h.</li>
      <li><b>Pass de saison</b> : victoire en attaque +30 XP, défaite +15, défense tenue +10, boss +20 ; 80 XP par niveau, 15 niveaux payés tout de suite. Le dernier donne le cadre animé Légende.</li>
      <li><b>Boss de la semaine</b> : 3 tentatives par jour, sans effet sur la cote. 100 par kill, 250 par tour, 3 000 si tu le bats.
        Tu fais les calls (plan de jeu, objectifs, chaque teamfight) : contrer l'intention du boss donne +20 % sur la phase et +300 points, te faire contrer −15 %. Le lundi : 1er +3 prestige, 2e +2, 3e +1, les autres +1 relique.</li>
      <li><b>Week-ends</b> : du samedi au lundi minuit, en rotation : double essence, double XP de pass, méta folle (une classe +15 %, une autre −10 %).</li>
      <li><b>Saisons</b> : deux semaines, du lundi au lundi. Argent 1050, Or 1150, Platine 1250, Diamant 1400, Maître 1550, Grand maître 1700, Challenger 1850. Récompense de palier dès 5 combats, ton palier final devient le cadre de ton icône pour la saison suivante, puis la cote revient à mi-chemin de 1000.</li></ul>`)}
    ${sec('Check-list pour maximiser ton équipe', `<ul class="g-list check">
      <li>Chaque champion à son poste principal (+12 %).</li>
      <li>Une frontline, des dégâts, un support ou un tank.</li>
      <li>Au moins 3 champions teamfight, et plutôt mid ou late.</li>
      <li>3 skins ou plus de la même gamme, sinon des champions de base (Exalté).</li>
      <li>Évite les nerfs de la semaine, profite des buffs.</li>
      <li>Des talents de teamfight : Engage, Teamfight, Hypercarry, Attrape, Résurrection.</li></ul>`, true)}
  </div>`);
  $('[data-guide-meta]')?.addEventListener('click', showMeta);
}

async function maybePromptInstall() {
  if (standalone || !isMobile || store.get('capsules.installPrompted')) return;
  // Laisse au navigateur le temps d'annoncer l'installation possible (Android).
  for (let i = 0; i < 20 && !installEvent && !isIOS; i++) await sleep(100);
  store.set('capsules.installPrompted', '1');
  showInstall(true);
}

async function installNow() {
  if (!installEvent) return;
  installEvent.prompt();
  const { outcome } = await installEvent.userChoice;
  installEvent = null;
  if (outcome === 'accepted') closeSheet();
}

function showInstall(firstLaunch = false) {
  const steps = isIOS
    ? `<ol class="install-steps"><li>Ouvre cette page dans <b>Safari</b>.</li><li>Touche <b>Partager</b> (carré avec une flèche).</li>
        <li>Choisis <b>« Sur l'écran d'accueil »</b>, puis <b>Ajouter</b>.</li></ol>`
    : `<ol class="install-steps"><li>Ouvre le menu du navigateur <b>⋮</b>.</li><li>Choisis <b>« Installer l'application »</b> ou <b>« Ajouter à l'écran d'accueil »</b>.</li></ol>`;
  openSheet(`<div class="install-sheet">
    <div class="install-icon"><img src="icons/icon-192.png" alt=""></div>
    <h2>${firstLaunch ? 'Installe Reliques' : 'Installer l\'app'}</h2>
    <p class="muted">Ouvre tes reliques en un geste depuis l'écran d'accueil, en plein écran.</p>
    <ul class="install-perks"><li>Notification quand ton stock est plein</li><li>Compteur de reliques sur l'icône</li><li>Chargement instantané</li></ul>
    ${installEvent ? '<button class="btn primary big block" id="install-now">Installer</button>' : steps}
    <button class="btn ghost block" data-close>${firstLaunch ? 'Plus tard' : 'Fermer'}</button>
  </div>`);
  $('#install-now')?.addEventListener('click', installNow);
}

const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function currentSub() {
  if (!pushSupported) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function setupNotify() {
  const card = $('#notify-card');
  try { S.pushKey = (await api('/capsules/push/key')).publicKey; } catch { S.pushKey = null; }
  const n = S.wallet?.notifyAt ?? 10;
  $('#notify-text').textContent = `Notification quand tu as ${n} reliques en stock.`;
  if (!S.pushKey) { card.hidden = true; return; }
  if (isIOS && !standalone) {
    card.hidden = false; $('#notify-text').textContent = 'Installe l\'app sur l\'écran d\'accueil pour être prévenu.';
    $('#notify-btn').textContent = 'Installer'; $('#notify-btn').onclick = () => showInstall(); return;
  }
  if (!pushSupported || Notification.permission === 'denied') { card.hidden = true; return; }
  const sub = Notification.permission === 'granted' ? await currentSub() : null;
  if (sub) { card.hidden = true; await sendSub(sub).catch(() => {}); return; }
  card.hidden = false;
  $('#notify-btn').onclick = enableNotify;
}

async function sendSub(sub) {
  const j = sub.toJSON();
  await api('/capsules/push/subscribe', { method: 'POST', body: { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth } });
}

async function enableNotify() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Notifications refusées. Tu peux les réactiver dans les réglages du navigateur.', true); return; }
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(S.pushKey) });
    await sendSub(sub);
    $('#notify-card').hidden = true;
    toast(`C'est noté : on te prévient à ${S.wallet.notifyAt} reliques.`);
  } catch (e) { toast(`Activation impossible : ${e.message}`, true); }
}

// ---------- Debug (local uniquement) ----------
async function debugCall(path, body) {
  try {
    setWallet(await api(`/capsules/debug/${path}`, { method: 'POST', body }));
    if (path === 'reset') { S.owned.clear(); S.recent = []; S.roster = [null, null, null, null, null]; renderRecent(); renderRoster(); renderCollection(); }
  } catch (e) { toast(e.message, true); }
}

/** Debug : rejoue la révélation d'un champion à thème sur son skin le plus rare, sans rien ajouter à la collection. */
function debugReveal(alias) {
  const c = S.cat?.champions.find((x) => x.alias === alias);
  if (!c || S.busy) return;
  const best = (S.cat.byChamp.get(c.id) || []).map((id) => item('SKIN', id)).filter(Boolean).sort((a, b) => rank(b.rarity) - rank(a.rarity))[0];
  if (!best) return;
  S.busy = true;
  const reveal = $('#reveal');
  reveal.hidden = false; $('#reveal-multi').hidden = true; $('#reveal-capsule').hidden = true;
  skipper.on = false; S.queenReveal = true;
  showSingle({ kind: 'SKIN', itemId: best.id, rarity: best.rarity, isNew: true, count: 1, essence: 0, guaranteed: false });
}

// ---------- Authentification ----------
let registering = false;
function showAuth() {
  $('#app').hidden = true; $('#auth').hidden = false;
  $('#name-field').hidden = !registering;
  $('#auth-submit').textContent = registering ? 'Créer mon compte' : 'Se connecter';
  $('#auth-toggle').textContent = registering ? 'Déjà un compte ? Se connecter' : 'Pas encore de compte ? Créer un compte';
  $('[name=password]').autocomplete = registering ? 'new-password' : 'current-password';
}

async function submitAuth(e) {
  e.preventDefault();
  const f = new FormData(e.target);
  const body = { email: f.get('email'), password: f.get('password'), ...(registering ? { displayName: f.get('displayName') } : {}) };
  $('#auth-error').textContent = ''; $('#auth-submit').disabled = true;
  try {
    const res = await api(`/auth/${registering ? 'register' : 'login'}`, { method: 'POST', body, retry: !registering });
    S.token = res.token; S.user = res.user;
    store.set('capsules.token', res.token); store.set('capsules.user', JSON.stringify(res.user));
    await start();
  } catch (err) { $('#auth-error').textContent = err.message; }
  finally { $('#auth-submit').disabled = false; }
}

async function logout() {
  try { const sub = await currentSub(); if (sub && S.token) await fetch(`${API}/capsules/push/unsubscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${S.token}` }, body: JSON.stringify({ endpoint: sub.endpoint }) }); } catch { /* best effort */ }
  store.del(snapKey());
  S.token = null; S.user = null; S.owned.clear(); S.recent = []; S.friend = null;
  store.del('capsules.token'); store.del('capsules.user');
  showAuth();
}

const snapKey = () => `capsules.snapshot.${S.user?.id}`;

function saveSnapshot() {
  if (!S.wallet || !S.user) return;
  const { nextAtMs, ...wallet } = S.wallet;
  store.set(snapKey(), JSON.stringify({ wallet: { ...wallet, nextAt: nextAtMs ? new Date(nextAtMs).toISOString() : null, serverTime: new Date(now()).toISOString() },
    items: [...S.owned.values()], recent: S.recent.slice(0, 30), roster: S.roster }));
}

function applyCollection(coll) {
  S.owned = new Map(coll.items.map((i) => [`${i.kind}:${i.itemId}`, i]));
  S.recent = coll.recent;
  S.roster = coll.roster;
  S.teams = coll.teams || [];
  S.activeTeam = coll.activeTeam || 0;
  S.rotation = coll.rotation || null;
}

function renderAll() {
  renderRecent();
  renderOdds();
  if (S.view === 'collection') { renderRoster(); renderCollection(); }
}

async function start() {
  $('#auth').hidden = true; $('#app').hidden = false;
  if (S.user) setUser(S.user);
  // Dernier état connu (et catalogue en cache) affichés tout de suite ; ouvertures bloquées jusqu'à la réponse du serveur.
  S.online = false;
  const snap = JSON.parse(store.get(snapKey()) || 'null');
  const cached = JSON.parse(store.get(CATALOG_KEY) || 'null');
  if (snap && cached) {
    S.cat ||= indexCatalog(cached.data);
    applyCollection(snap);
    setWallet(snap.wallet);
    renderAll();
  }
  try {
    const [state, coll, me] = await Promise.all([api('/capsules/state', { retry: true }), api('/capsules/collection', { retry: true }),
      api('/me', { retry: true }), loadCatalog()]);
    S.online = true;
    setUser(me);
    applyCollection(coll);
    setWallet(state);
    renderAll();
    saveSnapshot();
    if (S.view !== 'arena') loadArena({ quiet: true });
    await loadMeta();
  } catch (e) {
    toast(e.message, true);
    // Nouvelle tentative au prochain retour sur l'app.
    S.retryStart = true;
  }
  setupNotify();
  // Pas encore d'icône : choix imposé avant tout autre popup.
  if (S.online && S.cat && !S.user?.avatarChampionId) await showAvatarPicker(true);
  await maybeShowNews();
  await maybeShowEvent();
  await maybeShowMeta();
  if (S.openPassAfter) { S.openPassAfter = false; while (!S.arena) await sleep(200); showPass(); while (!$('#sheet').hidden) await sleep(300); }
  maybePromptInstall();
}

// ---------- Événements ----------
function bind() {
  $('#auth-form').addEventListener('submit', submitAuth);
  $('#auth-toggle').onclick = () => { registering = !registering; $('#auth-error').textContent = ''; showAuth(); };
  $$('[data-view]').forEach((b) => (b.onclick = () => setView(b.dataset.view)));
  $('#capsule').onclick = () => openCapsules(1);
  $('#open-one').onclick = () => openCapsules(1);
  $('#open-all').onclick = () => openCapsules(Math.min(stockOf(), 10));
  const buy = async (type) => {
    try {
      setWallet(await api('/capsules/buy', { method: 'POST', body: { type } }));
      audio.chime(type === 'PREMIUM' ? 4 : 2);
      toast(type === 'PREMIUM' ? 'Relique prestige forgée !' : 'Relique forgée !');
      setType(type);
    } catch (e) { toast(e.message, true); }
  };
  $('#buy-std').onclick = () => buy('STANDARD');
  $('#buy-prem').onclick = () => buy('PREMIUM');
  $$('.type-switch [data-type]').forEach((b) => (b.onclick = () => setType(b.dataset.type)));
  $('#reveal-close').onclick = closeReveal;
  $('#reveal-skip').onclick = revealAll;
  $('#reveal-again').onclick = () => openNext(10);
  $('#reveal-capsule').addEventListener('click', skipAnimation);
  $('#multi-grid').addEventListener('click', (e) => { const f = e.target.closest('.flip'); if (f) flipCard(f); });

  const soundLabel = () => { $('#sound-toggle span').textContent = `Son : ${S.sound ? 'activé' : 'coupé'}`; };
  $('#sound-toggle').onclick = () => { S.sound = !S.sound; store.set('capsules.sound', S.sound ? 'on' : 'off'); soundLabel(); };
  soundLabel();
  $('#odds-btn').onclick = () => { if (S.cat) showOdds(); };
  $('#odds-row').onclick = () => { if (S.cat) showOdds(); };
  $('#profile-menu').onclick = () => { if (S.user) showProfile(S.user.id); };
  $('#guide-menu').onclick = () => showGuide();
  $('#logout-btn').onclick = logout;

  // Cartes cliquables partout (collection, derniers tirages, fiches).
  document.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-pick]');
    if (pick) { setSlot(+pick.dataset.slotIndex, pick.dataset.pick); return; }
    const clear = e.target.closest('[data-pick-clear]');
    if (clear) { setSlot(+clear.dataset.pickClear, null); return; }
    if (e.target.closest('[data-pass]')) { showPass(); return; }
    if (e.target.closest('[data-event]')) { showEvent(S.arena?.event || S.meta?.event); return; }
    const team = e.target.closest('[data-team]');
    if (team) { selectTeam(+team.dataset.team); return; }
    const comp = e.target.closest('[data-compose]');
    if (comp) { showComposer(+comp.dataset.compose); return; }
    const slot = e.target.closest('[data-slot]');
    if (slot) { showSlotPicker(+slot.dataset.slot); return; }
    if (e.target.closest('#coach-meta')) { showMeta(); return; }
    if (e.target.closest('#coach-guide')) { showGuide(); return; }
    const foe = e.target.closest('[data-foe]');
    if (foe) { openFoe(foe.dataset.foe); return; }
    const fight = e.target.closest('[data-battle]');
    if (fight) { openBattle(fight.dataset.battle); return; }
    const go = e.target.closest('[data-goto]');
    if (go) { closeSheet(); setView(go.dataset.goto); return; }
    const prof = e.target.closest('[data-profile]');
    if (prof) { showProfile(prof.dataset.profile); return; }
    const player = e.target.closest('[data-player]');
    if (player) { openPlayer(player.dataset.player); return; }
    const unfriend = e.target.closest('[data-unfriend]');
    if (unfriend) { api(`/capsules/friends/${unfriend.dataset.unfriend}`, { method: 'DELETE' }).then(loadFriends).catch((err) => toast(err.message, true)); return; }
    const befriend = e.target.closest('[data-befriend]');
    if (befriend) { addFriend({ userId: befriend.dataset.befriend }); return; }
    const eqs = e.target.closest('[data-equip-sheet]');
    if (eqs) { setSlot(+eqs.dataset.equipSheet, eqs.dataset.key).then(() => toast('Équipé.')); return; }
    const av = e.target.closest('[data-avatar-champ]');
    if (av) { api('/capsules/avatar', { method: 'PUT', body: { championId: +av.dataset.avatarChamp } }).then((u) => { setUser(u); toast('Avatar changé.'); }).catch((err) => toast(err.message, true)); return; }
    const card = e.target.closest('button.card');
    if (card) { showItem(card.dataset.key); return; }
    const champ = e.target.closest('[data-champ]');
    if (champ) { showChampion(+champ.dataset.champ); return; }
    const goto = e.target.closest('[data-goto-line]');
    if (goto) {
      closeSheet(); const id = +goto.dataset.gotoLine;
      S.coll.group = 'line'; S.coll.open.add(id); S.coll.q = S.cat.line.get(id)?.name || ''; $('#search').value = S.coll.q;
      syncSegmented(); setView('collection');
    }
  });
  $('#friend-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#friend-query');
    if (await addFriend({ query: input.value })) input.value = '';
  });
  $('#owner-back').onclick = () => setView('friends');
  bindArena();
  $('#owner-follow').onclick = async () => {
    const p = await addFriend({ userId: S.friend.userId });
    if (p) { S.friend.added = true; $('#owner-follow').hidden = true; }
  };
  $('#sheet').addEventListener('click', (e) => { if (e.target.closest('[data-close]') && !$('#sheet').classList.contains('locked')) closeSheet(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#tuto').hidden && !$('#sheet').classList.contains('locked')) closeSheet(); });
  $('#avatar-menu').onclick = () => { if (S.cat) showAvatarPicker(); };

  $$('.coll-controls .segmented button').forEach((b) => (b.onclick = () => { S.coll.group = b.dataset.group; if (b.dataset.group !== 'rarity') S.coll.rarity = null; syncSegmented(); renderCollection(); }));
  let t;
  $('#search').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { S.coll.q = e.target.value; renderCollection(); }, 150); });
  $('#show-missing').addEventListener('change', (e) => { S.coll.missing = e.target.checked; renderCollection(); });
  $('#role-chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-role-filter]'); if (!b) return;
    S.coll.role = b.dataset.roleFilter === '' ? null : +b.dataset.roleFilter;
    $$('#role-chips button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderCollection();
  });
  $('#rarity-bars').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rarity]'); if (!b) return;
    S.coll.rarity = S.coll.rarity === b.dataset.rarity ? null : b.dataset.rarity; S.coll.group = 'rarity'; syncSegmented(); renderCollection();
  });
  $('#coll-body').addEventListener('click', (e) => {
    const line = e.target.closest('[data-line]');
    if (line) { const id = +line.dataset.line; S.coll.open.has(id) ? S.coll.open.delete(id) : S.coll.open.add(id); renderCollection(); return; }
    const more = e.target.closest('[data-more]');
    if (more) { const k = more.dataset.more; S.coll.limits[k] = (S.coll.limits[k] || (k === 'lines' ? 30 : 60)) + (k === 'lines' ? 30 : 120); renderCollection(); }
  });

  $('#debug').addEventListener('click', (e) => {
    const b = e.target.closest('[data-debug]'); if (!b) return;
    const [kind, n] = b.dataset.debug.split(':');
    if (kind === 'reset') { if (confirm('Vider collection, historique et stock ?')) debugCall('reset'); }
    else if (kind === 'show') debugReveal(n);
    else debugCall('grant', { count: kind === 'cap' ? +n : 0, essence: kind === 'ess' ? +n : 0, premium: kind === 'prem' ? +n : 0 });
  });

  $('#update-go').onclick = applyUpdate;
  addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    checkVersion();
    if (!S.token) return;
    if (S.retryStart) { S.retryStart = false; start(); return; }
    api('/capsules/state', { retry: true }).then((w) => { S.online = true; setWallet(w); saveSnapshot(); }).catch(() => {});
    // Un événement a pu commencer pendant que l'app dormait.
    loadMeta().then(maybeShowEvent);
  });
}

/** Compositeur d'équipe : écran plein, un poste à la fois en grand, avec ce qu'il apporte et l'analyse de l'équipe. */
const COMP = { i: 0 };
function showComposer(start = 0) {
  COMP.i = start;
  let el = $('#composer');
  if (!el) {
    el = document.createElement('div'); el.id = 'composer'; el.className = 'composer2'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Composer mon équipe');
    document.body.appendChild(el);
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-cp-close]')) { el.hidden = true; return; }
      const r = e.target.closest('[data-cp]'); if (r) { COMP.i = +r.dataset.cp; drawComposer(); return; }
      const t = e.target.closest('[data-cp-team]'); if (t) { selectTeam(+t.dataset.cpTeam); return; }
      if (e.target.closest('.cp-side.l')) { COMP.i = (COMP.i + 4) % 5; drawComposer(); return; }
      if (e.target.closest('.cp-side.r')) { COMP.i = (COMP.i + 1) % 5; drawComposer(); return; }
      const ch = e.target.closest('[data-cp-change]'); if (ch) showSlotPicker(COMP.i);
    });
    let x0 = null;
    el.addEventListener('touchstart', (e) => { if (e.target.closest('.cp-stage')) x0 = e.touches[0].clientX; }, { passive: true });
    el.addEventListener('touchend', (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 40) { COMP.i = (COMP.i + (dx < 0 ? 1 : 4)) % 5; drawComposer(); } });
  }
  el.hidden = false;
  drawComposer();
}

function drawComposer() {
  const el = $('#composer'); if (!el || el.hidden) return;
  const i = COMP.i;
  const its = rosterItems(fullSlots(S.roster));
  const it = its[i], prev = its[(i + 4) % 5], next = its[(i + 1) % 5];
  const side = (x, cls) => `<div class="cp-side ${cls}${x ? ` r-${x.rarity}` : ''}">${x ? `<img src="${esc(x.art)}" ${x.fb ? `data-fb="${esc(x.fb)}"` : ''} alt="">` : ''}</div>`;
  const fit = it ? fitOf(it.champ, i) : 0, meta = it ? metaOf(it.champ) : 0;
  const p = it?.champ.profile;
  const chips = it ? [
    p ? `<span class="tchip ${fit > 0 ? 'p' : 'm'}">${fit === FIT.main ? 'Poste principal' : fit === FIT.secondary ? 'Poste secondaire' : 'Hors poste'} ${signed(fit)} %</span>` : '',
    `<span class="tchip ${meta > 0 ? 'p' : meta < 0 ? 'm' : 'z'}">Méta ${signed(meta)} %</span>`,
    p ? `<span class="tchip z">${CURVE[p.curve].label} · ${STYLE[p.style].label}</span>` : '',
  ].join('') : '';
  const team = S.teams?.[S.activeTeam];
  const risk = S.arena?.team ? riskOf(S.arena.team)[0] : null;
  el.innerHTML = `<div class="cp-amb" style="${it ? `background-image:url('${esc(it.splash)}')` : ''}"></div>
    <div class="cp-top"><button class="icon-btn" type="button" data-cp-close aria-label="Fermer"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" fill="none"/></svg></button>
      <div class="cp-teams">${(S.teams || []).map((t, k) => `<button type="button" data-cp-team="${k}" aria-pressed="${k === S.activeTeam}">${esc(t.name)}</button>`).join('')}</div>
      <b class="num cp-pow">${teamPower(its)}</b></div>
    <div class="cp-stage">${side(prev, 'l')}${side(next, 'r')}
      <div class="cp-main${it ? ` r-${it.rarity}` : ' empty'}" data-cp-change role="button" tabindex="0" aria-label="Changer le ${ROLES[i]}">
        ${it ? `<img src="${esc(it.art)}" ${it.fb ? `data-fb="${esc(it.fb)}"` : ''} alt=""><div class="cp-cap"><div class="cp-role">${roleIcon(i)}<span>${ROLES[i]}</span><b class="num">${unitPower(it, i)}</b></div><b>${esc(it.name)}</b><span>${esc(CLASS[primaryClass(it.champ)?.toUpperCase()]?.label || '')}${it.champ.talent ? ` · Talent ${esc(it.champ.talent.spell)}` : ''}</span></div>`
          : `<div class="cp-empty"><b>+</b><span>${ROLES[i]} libre</span></div>`}
      </div></div>
    <div class="cp-roles">${ROLES.map((r, k) => `<button type="button" data-cp="${k}" aria-pressed="${k === i}" aria-label="${r}">${roleIcon(k)}</button>`).join('')}</div>
    <div class="cp-chips">${chips}</div>
    <div class="cp-card">${notesHTML(teamNotes(its))}${risk ? `<div class="tnote"><span class="muted">Risque de l'équipe</span><b class="cp-risk">${risk}</b></div>` : ''}
      <div class="tnote"><span class="muted">${curveVerdict(its)}</span></div></div>
    <button class="btn primary block cp-go" type="button" data-cp-change>${it ? `Changer ${esc(it.champ.name)}` : `Choisir un ${ROLES[i]}`}</button>`;
  if (team) $$('[data-cp-team]', el).forEach((b) => (b.title = +b.dataset.cpTeam === S.activeTeam ? 'Équipe active (touche pour renommer)' : 'Jouer avec cette équipe'));
}

function syncSegmented() { $$('.coll-controls .segmented button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.group === S.coll.group))); }

// ---------- Champions à thème : Ahri la reine (kawaii), Tryndamere la rage (sanglant) ----------
// Un seul mécanisme : chaque thème décore les avatars ronds, les cartes et anime quelques particules sur les cartes visibles.
const HEART_SVG = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 21s-7.5-4.6-9.6-9.2C.9 8.5 3 5 6.4 5c2.1 0 3.6 1.2 4.6 2.6C12 6.2 13.5 5 15.6 5 19 5 21.1 8.5 19.6 11.8 17.5 16.4 12 21 12 21z"/></svg>';
const FOX_SVG = '<svg viewBox="0 0 40 40"><path d="M6 19 9 3l9 9z" fill="#ff8ad8"/><path d="M34 19 31 3l-9 9z" fill="#ff8ad8"/><path d="M9.5 13 10.5 6.5l4.5 4.5z" fill="#ffe1f3"/><path d="M30.5 13 29.5 6.5 25 11z" fill="#ffe1f3"/><path d="M5 21c0-9 8-11.5 15-11.5S35 12 35 21c0 9-7.5 14-15 14S5 30 5 21z" fill="#fff4fa" stroke="#ff8ad8" stroke-width="1.6"/><path d="M11 22q3-4 6 0M23 22q3-4 6 0" stroke="#5a2a45" stroke-width="2" fill="none" stroke-linecap="round"/><ellipse cx="11" cy="27" rx="3" ry="1.8" fill="#ff9fd6" opacity=".85"/><ellipse cx="29" cy="27" rx="3" ry="1.8" fill="#ff9fd6" opacity=".85"/><path d="M17 27.5q1.5 2 3 0 1.5 2 3 0" stroke="#5a2a45" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>';
/** Griffure : trois entailles rouge sombre. */
const CLAW_SVG = '<svg viewBox="0 0 40 40"><g fill="#c3161c"><path d="M8 4c3 9 9 20 20 31-6-4-14-14-20-31z"/><path d="M16 2c3 9 9 20 19 30-6-4-13-13-19-30z" fill="#e0302a"/><path d="M2 12c4 8 10 17 19 26-7-3-14-11-19-26z" fill="#8e0f14"/></g></svg>';
/** Épée de la rage, en sticker. */
const SWORD_SVG = '<svg viewBox="0 0 40 40"><g transform="rotate(45 20 20)"><path d="M18 2h4l1 24h-6z" fill="#e8ecf2" stroke="#3a0507" stroke-width="1"/><path d="M20 3v22" stroke="#9aa4b1" stroke-width="1"/><path d="M19 8l1 10 1-10z" fill="#c3161c"/><path d="M11 26h18v3H11z" fill="#c8a96a" stroke="#3a0507" stroke-width="1"/><path d="M18.5 29h3v7h-3z" fill="#5a1a14"/><circle cx="20" cy="37" r="2" fill="#c8a96a"/></g></svg>';
const DROP_SVG = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2s7 8.2 7 13a7 7 0 0 1-14 0c0-4.8 7-13 7-13z"/></svg>';

const THEMES = {
  Ahri: {
    key: 'ahri', round: 'ahri-av', card: 'ahri-card',
    roundHTML: () => `<span class="ear l"></span><span class="ear r"></span><span class="mini-heart">${HEART_SVG}</span>`,
    cardHTML: () => `<span class="fox-sticker">${FOX_SVG}</span>`,
    // Petits cœurs qui sautent de la carte.
    particle(c) {
      const h = document.createElement('span'); h.className = 'kheart'; h.innerHTML = HEART_SVG;
      h.style.left = `${15 + Math.random() * 70}%`; h.style.top = `${45 + Math.random() * 35}%`;
      h.style.setProperty('--x', `${(Math.random() - 0.5) * 30}px`); h.style.setProperty('--sz', `${10 + Math.random() * 7}px`);
      return h;
    },
  },
  Tryndamere: {
    key: 'tryn', round: 'tryn-av', card: 'tryn-card',
    roundHTML: () => `<span class="claw">${CLAW_SVG}</span><span class="drop"></span>`,
    cardHTML: () => `<span class="tryn-slash">${CLAW_SVG}</span><span class="fox-sticker tryn-sticker">${SWORD_SVG}</span>`,
    // Une goutte qui coule du haut de la carte.
    particle() {
      const d = document.createElement('span'); d.className = 'tdrip'; d.style.left = `${12 + Math.random() * 76}%`;
      return d;
    },
  },
};
const champIdOf = (alias) => S.cat?.champions?.find((c) => c.alias === alias)?.id;
/** Thème d'une image (écran de chargement, splash ou icône de champion), ou null. */
function themeOfSrc(src) {
  const m = src.match(/\/champion\/(?:loading|splash)\/([A-Za-z]+)_\d+\./);
  if (m) return THEMES[m[1]] || null;
  const icon = src.match(/\/champion-icons\/(\d+)\.png$/);
  if (!icon) return null;
  return Object.entries(THEMES).find(([alias]) => champIdOf(alias) === +icon[1])?.[1] || null;
}
const themeOfItem = (it) => THEMES[it?.champ?.alias] || null;
const isAhriItem = (it) => themeOfItem(it)?.key === 'ahri';
const ROUND = '.avatar, .sring, .fc-av, .vf-av, .pd-av, .token, .kf-face-wrap';
const CARDS = '.card, .tport, .tb-p, .pk-art, .cp-main, .cp-side, .unit-art, .pg-mvp, .me-sig, .pf-champ, .mx-pic';
const ALL_THEMES = Object.values(THEMES);

function themify(root = document) {
  if (!root.querySelectorAll) return;
  root.querySelectorAll('img').forEach((img) => {
    if (img.dataset.theme) return;
    const t = themeOfSrc(img.getAttribute('src') || '');
    if (!t) return;
    img.dataset.theme = t.key;
    const round = img.closest(ROUND);
    if (round) {
      if (!ALL_THEMES.some((x) => round.classList.contains(x.round))) {
        round.classList.add(t.round);
        round.insertAdjacentHTML('beforeend', t.roundHTML());
      }
      return;
    }
    const card = img.closest(CARDS);
    if (card && !ALL_THEMES.some((x) => card.classList.contains(x.card))) {
      card.classList.add(t.card);
      card.insertAdjacentHTML('beforeend', t.cardHTML());
    }
  });
}

/** Quelques particules sur les cartes à thème visibles (cœurs d'Ahri, gouttes de Tryndamere). */
function themeParticles() {
  if (reduceMotion() || document.hidden) return;
  for (const t of ALL_THEMES) {
    const vis = $$(`.${t.card}`).filter((c) => { const r = c.getBoundingClientRect(); return r.width > 40 && r.bottom > 0 && r.top < innerHeight; }).slice(0, 4);
    vis.forEach((c) => {
      if (Math.random() < 0.4) return;
      const p = t.particle(c);
      c.appendChild(p); setTimeout(() => p.remove(), 2600);
    });
  }
}

/**
 * Entrée de Tryndamere avant sa carte (environ 1,3 s) : vignette rouge qui bat, jauge de Rage qui se remplit,
 * trois entailles d'épée, éclaboussure graphique. Rien en mode animations réduites.
 */
function rageIntro() {
  const host = $('#reveal');
  host.querySelector('.rage-fx')?.remove();
  if (reduceMotion()) return 0;
  host.insertAdjacentHTML('beforeend', `<div class="rage-fx" aria-hidden="true"><div class="rf-vign"></div>
    <span class="rf-slash s1"></span><span class="rf-slash s2"></span><span class="rf-slash s3"></span>
    <span class="rf-splat">${CLAW_SVG}</span>
    <div class="rf-meter"><span class="kicker"><span>Rage</span><b class="num">0</b></span><span class="rf-bar"><i></i></span></div></div>`);
  const fx = host.querySelector('.rage-fx'), n = fx.querySelector('.rf-meter b'), t0 = performance.now();
  const tick = () => { const p = Math.min(1, (performance.now() - t0) / 1100); n.textContent = Math.round(100 * p * p); if (p < 1 && fx.isConnected) requestAnimationFrame(tick); };
  tick();
  [0, 500, 900].forEach((t) => setTimeout(() => audio.tone(90 + t / 10, 0.18, 'sawtooth', 0.08), t));
  setTimeout(() => { fx.classList.add('cut'); restart(host, 'rage-shake'); audio.burst(4); buzz([40, 30, 90]); }, 1100);
  setTimeout(() => fx.classList.add('out'), 1700);
  setTimeout(() => fx.remove(), 2600);
  return 1300;
}

new MutationObserver((ms) => { for (const m of ms) m.addedNodes.forEach((n) => { if (n.nodeType === 1) themify(n.parentElement || n); }); })
  .observe(document.body, { childList: true, subtree: true });
setInterval(themeParticles, 1300);

// ---------- Démarrage ----------
fetch('/health', { cache: 'no-store' }).catch(() => {});
checkVersion();
fx.init();
bind();
setupInstall();
setInterval(tick, 1000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
const params = new URLSearchParams(location.search);
const startView = params.get('view');
if (['collection', 'arena', 'friends', 'profile'].includes(startView)) S.view = startView;
if (['foes', 'ladder', 'boss'].includes(params.get('tab'))) S.arenaTab = params.get('tab');
if (S.token) { start(); setView(S.view); } else showAuth();
if (params.get('replay')) openSharedReplay(params.get('replay'));
