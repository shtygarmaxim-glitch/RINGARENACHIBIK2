(function () {
  const tg = window.Telegram && Telegram.WebApp;
  if (tg) {
    tg.ready();
    tg.expand && tg.expand();
    try { tg.disableVerticalSwipes && tg.disableVerticalSwipes(); } catch (e) {}
    try { tg.setHeaderColor && tg.setHeaderColor('#0a0a0a'); tg.setBackgroundColor && tg.setBackgroundColor('#0a0a0a'); } catch (e) {}
  }
  const $ = id => document.getElementById(id);
  const arena = $('iceArena'), puck = $('icePuck'), puckImg = puck.querySelector('.puck-img'), arrow = puck.querySelector('.ice-arrow'), ripple = puck.querySelector('.puck-ripple'), zoneMap = $('iceZoneMap'), legend = $('iceLegend'), winnerEl = $('iceWinner');
  const APPEAR = 2000, SPIN = 3400, HOLD = 700, INTRO = SPIN + HOLD, FLIGHT = 7000, CLOSE = 1000, PUCK = 24, S = 100, N = FLIGHT / 1000 * 60;
  let W = arena.clientWidth || 358, me = null, isAdmin = false, ws, skew = 0;
  let st = { status: 'waiting', players: [], online: 0 }, L = [];
  let plan = null, planFor = null, finished = false, phase = '', cam = null;

  const fmt = v => String(+Number(v).toFixed(3));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2600); }
  function place(x, y) { puck.style.transform = `translate3d(${(x * W / 100 - PUCK / 2).toFixed(2)}px,${(y * W / 100 - PUCK / 2).toFixed(2)}px,0)`; }
  window.addEventListener('resize', () => { W = arena.clientWidth || W; });
  place(50, 50); puck.style.visibility = 'hidden';

  // ---------- аватарка ----------
  function avatar(p, cls, size) {
    const el = document.createElement(p.photo ? 'img' : 'div');
    el.className = cls; el.style.width = el.style.height = size + 'px';
    const initial = () => { const d = document.createElement('div'); d.className = cls; d.style.cssText = `width:${size}px;height:${size}px;background:${p.color};font-size:${size * .45}px`; d.textContent = (p.name || '?')[0].toUpperCase(); return d; };
    if (p.photo) { el.src = p.photo; el.referrerPolicy = 'no-referrer'; el.onerror = () => el.replaceWith(initial()); return el; }
    return initial();
  }

  // ---------- геометрия зон ----------
  function clip(poly, a, b, c) { const out = []; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length], dp = a * p[0] + b * p[1] - c, dq = a * q[0] + b * q[1] - c; if (dp <= 0) out.push(p); if (dp * dq < 0) { const t = dp / (dp - dq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); } } return out; }
  function cells() { return L.map(p => { let poly = [[0, 0], [S, 0], [S, S], [0, S]]; for (const o of L) { if (o === p || !poly.length) continue; poly = clip(poly, 2 * (o.sx - p.sx), 2 * (o.sy - p.sy), o.sx * o.sx + o.sy * o.sy - p.sx * p.sx - p.sy * p.sy + p.w - o.w); } return poly; }); }
  function info(poly) { let A = 0, cx = 0, cy = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length], f = p[0] * q[1] - q[0] * p[1]; A += f; cx += (p[0] + q[0]) * f; cy += (p[1] + q[1]) * f; } A /= 2; return A > 1e-9 ? { A, cx: cx / (6 * A), cy: cy / (6 * A) } : { A: 0, cx: 50, cy: 50 }; }
  function inr(poly, cx, cy) { let m = 1e9; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length], dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy); if (l > 1e-6) m = Math.min(m, Math.abs(dx * (cy - p[1]) - dy * (cx - p[0])) / l); } return m; }
  function solve() {
    const sum = L.reduce((s, p) => s + p.stake, 0);
    for (let it = 0; it < 400; it++) {
      const inf = cells().map(info);
      L.forEach((p, i) => { const e = p.stake / sum * S * S - inf[i].A, d = Math.sign(e); p.step = Math.min(3000, Math.max(.02, p.step * (d === p.dir ? 1.25 : .5))); p.dir = d; p.w += d * Math.min(p.step, Math.abs(e) * 3); if (it < 25 && inf[i].A > 0) { p.sx += (inf[i].cx - p.sx) * .3; p.sy += (inf[i].cy - p.sy) * .3; } });
      const m = L.reduce((s, p) => s + p.w, 0) / L.length; L.forEach(p => p.w -= m);
    }
  }
  function layout() { L = st.players.map(p => ({ id: p.id, stake: p.stake, sx: p.sx, sy: p.sy, w: 0, step: 200, dir: 0 })); if (L.length) solve(); }
  function getWinner(x, y) { let best = L[0], bv = Infinity; for (const p of L) { const v = (x - p.sx) ** 2 + (y - p.sy) ** 2 - p.w; if (v < bv) { bv = v; best = p; } } return best; }

  // ---------- отрисовка ----------
  function render() {
    zoneMap.innerHTML = ''; legend.innerHTML = '';
    const sum = L.reduce((s, p) => s + p.stake, 0), cs = L.length ? cells() : [];
    st.players.map((p, i) => i).sort((a, b) => (st.players[a].id === (me && me.id) ? 1 : 0) - (st.players[b].id === (me && me.id) ? 1 : 0)).forEach(i => {
      const p = st.players[i], poly = cs[i], inf = info(poly), r = inr(poly, inf.cx, inf.cy);
      const el = document.createElement('div'); el.className = 'zone-item' + (me && p.id === me.id ? ' mine' : '');
      el.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points="${poly.map(v => v[0].toFixed(2) + ',' + v[1].toFixed(2)).join(' ')}" fill="${p.color}"/></svg>`;
      const d = Math.min(46, r * W / 100 * 1.4);
      if (d >= 14) { const a = avatar(p, 'zone-av', Math.round(d)); a.style.left = inf.cx + '%'; a.style.top = inf.cy + '%'; el.append(a); }
      zoneMap.append(el); p.zone = el;
    });
    st.players.forEach(p => {
      const it = document.createElement('div'); it.className = 'ice-player';
      it.append(avatar(p, 'lg-av', 20));
      it.insertAdjacentHTML('beforeend', `<span>${esc(p.name)}</span><b>${fmt(p.stake)} · ${(p.stake / sum * 100).toFixed(1)}%</b>`);
      legend.append(it);
    });
    $('icePool').textContent = fmt(sum);
    if (finished) applyResult();
    ui();
  }
  function applyResult() {
    st.players.forEach(p => p.zone && p.zone.classList.add(p.id === st.winnerId ? 'winner-zone' : 'loser'));
    const w = st.players.find(p => p.id === st.winnerId); if (!w) return;
    const pool = st.players.reduce((s, p) => s + p.stake, 0);
    winnerEl.innerHTML = `<div><b>${esc(w.name)}</b><small>Победитель · +${fmt(pool)} ⭐</small></div>`;
    winnerEl.classList.add('show');
  }
  function ui() {
    const now = Date.now() + skew; let txt = '', can = false;
    if (st.status === 'waiting') { txt = st.players.length ? 'Ждём 2-го игрока' : 'Набор игроков'; can = true; }
    else if (st.status === 'countdown') { const left = st.endsAt - now; if (left > CLOSE) { txt = 'Начало через 00:' + String(Math.ceil(left / 1000)).padStart(2, '0'); can = true; } else txt = 'Ставки закрыты'; }
    else if (st.status === 'running') txt = phase === 'rushing' ? 'Шайба на льду' : 'Раунд начинается';
    else txt = 'Раунд завершён';
    $('iceStatus').textContent = txt;
    $('iceJoinBtn').disabled = !can || !me;
    const mine = me && st.players.find(p => p.id === me.id);
    $('stakeInfo').textContent = mine ? 'Ваша: ' + fmt(mine.stake) : '';
  }
  setInterval(ui, 200);

  // ---------- детерминированная физика шайбы ----------
  function rng(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function sim(x, y, ang, spd) {
    let vx = Math.cos(ang) * spd, vy = Math.sin(ang) * spd; const dt = 1 / 60, decay = 4.5 / (FLIGHT / 1000), pts = [[x, y]];
    for (let i = 1; i <= N; i++) {
      const boost = 1 + 3 * Math.exp(-((i - 1) * dt) / .4); x += vx * dt * boost; y += vy * dt * boost;
      let bx = false, by = false;
      if (x < 0) { x = 0; if (vx < 0) { vx = Math.abs(vx) * .78; bx = true; } } else if (x > 100) { x = 100; if (vx > 0) { vx = -Math.abs(vx) * .78; bx = true; } }
      if (y < 0) { y = 0; if (vy < 0) { vy = Math.abs(vy) * .78; by = true; } } else if (y > 100) { y = 100; if (vy > 0) { vy = -Math.abs(vy) * .78; by = true; } }
      if (bx || by) {
        const s = Math.hypot(vx, vy) || 1, m = .37 * s, ax = bx ? (x < 50 ? 1 : -1) : 0, ay = by ? (y < 50 ? 1 : -1) : 0; let nx = vx, ny = vy;
        if (ax && ax * nx < m) { nx = ax * m; ny = (Math.sign(ny) || 1) * Math.sqrt(Math.max(0, s * s - nx * nx)); }
        if (ay && ay * ny < m) { ny = ay * m; nx = (Math.sign(nx) || 1) * Math.sqrt(Math.max(0, s * s - ny * ny)); }
        vx = nx; vy = ny;
      }
      if ((x < 12 || x > 88) && (y < 12 || y > 88)) { const s0 = Math.hypot(vx, vy); vx += (50 - x) * .02 * s0 * dt; vy += (50 - y) * .02 * s0 * dt; const s1 = Math.hypot(vx, vy) || 1; vx *= s0 / s1; vy *= s0 / s1; }
      const f = Math.exp(-decay * dt); vx *= f; vy *= f; pts.push([x, y]);
    }
    return pts;
  }
  // Победитель определён сервером; подбираем траекторию (по общему seed), которая приводит шайбу в его зону.
  function buildPlan() {
    let best = null;
    for (let k = 0; k < 4000; k++) {
      const r = rng((st.seed + k * 7919) >>> 0);
      const sx = 12 + r() * 76, sy = 14 + r() * 72, q = Math.floor(r() * 4), ang = (q * 90 + 24 + r() * 42) * Math.PI / 180, spd = 750 + r() * 160, sa = r() * 360;
      const pts = sim(sx, sy, ang, spd); best = { sp: [sx, sy], pts, ang, sa };
      const e = pts[N]; if (getWinner(e[0], e[1]).id === st.winnerId) break;
    }
    const fa = best.ang * 180 / Math.PI + 90;
    best.fa = fa; best.ea = best.sa + 720 + ((((fa - best.sa) % 360) + 360) % 360); // 2 оборота и остановка ровно по направлению полёта
    return best;
  }
  function setPhase(p) {
    if (p === phase) return; phase = p;
    puck.classList.toggle('choosing', p === 'choosing'); puck.classList.toggle('aiming', p === 'aiming'); puck.classList.toggle('rushing', p === 'rushing');
  }
  const clamp01 = x => Math.max(0, Math.min(1, x));
  const easeOut = x => 1 - Math.pow(1 - x, 3);
  // появление шайбы: плавный рост без затемнения, расходящееся кольцо, стрелка крутится вокруг шайбы и замирает по направлению броска
  function fx(t) {
    const e = easeOut(clamp01(t / APPEAR)), s = .45 + .55 * e;
    puckImg.style.opacity = e.toFixed(3);
    puckImg.style.transform = `scale(${s.toFixed(3)})`;
    const r = clamp01(t / 800);
    ripple.style.opacity = (.7 * (1 - r) * (1 - r)).toFixed(3);
    ripple.style.transform = `translate(-50%,-50%) scale(${(.7 + 1.6 * easeOut(r)).toFixed(3)})`;
    const ang = plan.sa + (plan.ea - plan.sa) * easeOut(clamp01(t / SPIN));
    const pop = 1 + .25 * Math.sin(Math.PI * clamp01((t - SPIN) / 350));
    arrow.style.opacity = (clamp01(t / 150) * (1 - clamp01((t - INTRO) / 250))).toFixed(3);
    arrow.style.transform = `rotate(${ang.toFixed(2)}deg) scale(${(s * pop).toFixed(3)})`;
  }
  function frame(t) {
    if (t < 0) { puck.style.visibility = 'hidden'; place(plan.sp[0], plan.sp[1]); fx(0); return; }
    puck.style.visibility = 'visible';
    fx(t);
    if (t < INTRO) { setPhase(t < SPIN ? 'choosing' : 'aiming'); place(plan.sp[0], plan.sp[1]); return; }
    setPhase('rushing');
    const ft = Math.min(t - INTRO, FLIGHT), idx = ft / 1000 * 60, i = Math.min(N - 1, Math.floor(idx)), f = idx - i;
    const a = plan.pts[i], b = plan.pts[i + 1], x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f;
    place(x, y);
    const zt = Math.max(0, Math.min(1, (ft - (FLIGHT - 3000)) / 3000));
    if (zt > 0) {
      if (!cam) { cam = { x, y }; arena.style.transition = 'none'; }
      cam.x += (x - cam.x) * .12; cam.y += (y - cam.y) * .12;
      const e = zt * zt * (3 - 2 * zt), sc = 1 + .32 * e, lim = (sc - 1) * 50;
      const tx = Math.max(-lim, Math.min(lim, (50 - cam.x) * sc)), ty = Math.max(-lim, Math.min(lim, (50 - cam.y) * sc));
      arena.style.transform = `translate(${tx}%,${ty}%) scale(${sc})`;
    }
    if (ft >= FLIGHT && !finished) { finished = true; applyResult(); }
  }
  function loop() {
    requestAnimationFrame(loop);
    if ((st.status !== 'running' && st.status !== 'result') || !st.startAt || !L.length) return;
    if (planFor !== st.id) { plan = buildPlan(); planFor = st.id; finished = false; cam = null; }
    frame(Date.now() + skew - st.startAt);
  }
  requestAnimationFrame(loop);
  function resetVisual() {
    if (!plan && !finished) return;
    plan = null; planFor = null; finished = false; cam = null; phase = '';
    arena.style.transition = ''; arena.style.transform = 'scale(1)';
    puck.classList.remove('choosing', 'aiming', 'rushing'); winnerEl.classList.remove('show'); winnerEl.innerHTML = '';
    W = arena.clientWidth || W; place(50, 50); puck.style.visibility = 'hidden';
  }

  // ---------- сеть ----------
  const send = m => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
  function connect() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    ws.onopen = () => send({ t: 'auth', initData: tg ? tg.initData : '' });
    ws.onclose = () => setTimeout(connect, 1500);
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.t === 'me') { me = m.user; isAdmin = m.admin; $('bal').textContent = fmt(me.balance); $('adminBtn').style.visibility = isAdmin ? 'visible' : 'hidden'; ui(); }
      else if (m.t === 'state') {
        skew = m.now - Date.now(); st = m;
        if (st.status === 'waiting' || st.status === 'countdown') resetVisual();
        layout(); render();
      }
      else if (m.t === 'users') renderUsers(m.list);
      else if (m.t === 'history') renderHistory(m);
      else if (m.t === 'ok') toast(m.msg);
      else if (m.t === 'err') { toast(m.msg); if (m.fatal) $('iceStatus').textContent = 'Нужен Telegram'; }
    };
  }
  connect();

  // ---------- ставки ----------
  $('iceJoinBtn').addEventListener('click', () => send({ t: 'bet', amount: Number($('betAmt').value) }));
  document.querySelectorAll('.ice-stakes button').forEach(b => b.addEventListener('click', () => { $('betAmt').value = b.dataset.v; }));

  // ---------- история игр ----------
  let hData = { top: null, last: null, list: [] }, curGame = null;
  const GEM = '<svg class="gem" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.2 3h11.6l4.2 6.2L12 21.5 2 9.2z"/><path d="M2 9.2h20M9 3l-2.2 6.2L12 21.5M15 3l2.2 6.2L12 21.5" fill="none" stroke="#0b0b0b" stroke-opacity=".35" stroke-width="1"/></svg>';
  const gp = g => ({ name: g.name || '?', photo: g.photo, color: g.color || '#ffc61a' });
  function fillCard(el, g) {
    if (!g) { el.innerHTML = '<span class="hd-empty">Пока нет игр</span>'; return; }
    el.innerHTML = ''; el.append(avatar(gp(g), 'lg-av', 22));
    el.insertAdjacentHTML('beforeend', `<span class="hd-name">${esc(g.name)}</span><b class="hd-win">+${fmt(g.pool)}${GEM}</b>`);
  }
  function renderHistory(h) {
    hData = h;
    fillCard($('topGame'), h.top); fillCard($('lastGame'), h.last);
    const list = $('histList'); list.innerHTML = '';
    if (!h.list.length) { list.innerHTML = '<p class="ice-hint">Игр пока не было</p>'; return; }
    h.list.forEach(g => {
      const row = document.createElement('div'); row.className = 'hist-row'; row.append(avatar(gp(g), 'lg-av', 30));
      const when = new Date(g.ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      row.insertAdjacentHTML('beforeend', `<span style="flex:1;min-width:0"><span class="hd-name">${esc(g.name)}</span><small>${g.players.length} игр. · ${when}</small></span><b class="hd-win">+${fmt(g.pool)}${GEM}</b>`);
      row.addEventListener('click', () => openGame(g));
      list.append(row);
    });
  }
  $('topGame').addEventListener('click', () => hData.top && openGame(hData.top));
  $('lastGame').addEventListener('click', () => hData.last && openGame(hData.last));

  // ---------- детали игры + legit check ----------
  const shortHex = s => s.length > 10 ? s.slice(0, 4) + '…' + s.slice(-4) : s;
  function openGame(g) {
    curGame = g;
    $('gmId').textContent = g.id;
    const d = new Date(g.ts);
    $('gmDate').textContent = d.toLocaleDateString('ru-RU') + ' · ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    $('gmHash').textContent = shortHex(g.hash);
    $('gmSeed').textContent = shortHex(String(g.seed));
    const pool = g.players.reduce((s, p) => s + p.stake, 0);
    const ordered = [...g.players].sort((a, b) => b.stake - a.stake);
    $('gmPlayers').innerHTML = '';
    ordered.forEach(p => {
      const isWin = p.id === g.winnerId;
      const row = document.createElement('div'); row.className = 'gm-p' + (isWin ? ' win' : '');
      row.append(avatar(p, 'lg-av', 32));
      row.insertAdjacentHTML('beforeend', `<span class="gm-p-name"><b>${esc(p.name)}${isWin ? '<span class="gm-win-badge">Победитель</span>' : ''}</b><small>${(p.stake / pool * 100).toFixed(2)}%</small></span><b class="gm-p-amt">${isWin ? '+' : ''}${fmt(isWin ? pool : p.stake)}${GEM}</b>`);
      $('gmPlayers').append(row);
    });
    $('gmVerdict').textContent = ''; $('gmVerdict').className = 'gm-verdict';
    $('gameModal').classList.add('show');
  }
  $('gmClose').addEventListener('click', () => $('gameModal').classList.remove('show'));
  $('gameModal').addEventListener('click', e => { if (e.target === $('gameModal')) $('gameModal').classList.remove('show'); });
  document.querySelectorAll('.gm-copy').forEach(b => b.addEventListener('click', () => {
    if (!curGame) return;
    const v = b.dataset.t === 'hash' ? curGame.hash : String(curGame.seed);
    (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(() => toast('Скопировано')).catch(() => toast('Не удалось скопировать'));
  }));
  $('gmCheckBtn').addEventListener('click', async () => {
    if (!curGame) return;
    const v = $('gmVerdict');
    v.textContent = 'Проверяем…'; v.className = 'gm-verdict';
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(curGame.seed)));
      const hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
      const hashOk = hex === curGame.hash;
      const pool = curGame.players.reduce((s, p) => s + p.stake, 0);
      let x = rng(curGame.seed)() * pool, w = curGame.players[0];
      for (const p of curGame.players) { if (x < p.stake) { w = p; break; } x -= p.stake; }
      const pickOk = w.id === curGame.winnerId;
      if (hashOk && pickOk) { v.textContent = '✅ Проверено — сид совпадает с хешем, победитель посчитан честно'; v.className = 'gm-verdict ok'; }
      else { v.textContent = '❌ Проверка не пройдена'; v.className = 'gm-verdict bad'; }
    } catch (e) { v.textContent = 'Не удалось проверить в этом браузере'; v.className = 'gm-verdict bad'; }
  });
  $('histBtn').addEventListener('click', () => $('histModal').classList.add('show'));
  $('histClose').addEventListener('click', () => $('histModal').classList.remove('show'));
  $('histModal').addEventListener('click', e => { if (e.target === $('histModal')) $('histModal').classList.remove('show'); });

  // ---------- админка ----------
  function renderUsers(list) {
    $('adminList').innerHTML = list.map(u => `<div class="adm-row" data-id="${u.id}"><span>${esc(u.name)}<small>${u.id}</small></span><b>${fmt(u.balance)}</b></div>`).join('') || '<p class="ice-hint">Пока никто не заходил</p>';
    document.querySelectorAll('.adm-row').forEach(r => r.addEventListener('click', () => { $('admId').value = r.dataset.id; $('admAmt').focus(); }));
  }
  $('adminBtn').addEventListener('click', () => { $('adminModal').classList.add('show'); send({ t: 'admin_users' }); });
  $('adminClose').addEventListener('click', () => $('adminModal').classList.remove('show'));
  $('adminModal').addEventListener('click', e => { if (e.target === $('adminModal')) $('adminModal').classList.remove('show'); });
  $('admGive').addEventListener('click', () => send({ t: 'admin_give', userId: $('admId').value, amount: Number($('admAmt').value) }));
})();
