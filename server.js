const express = require('express'), http = require('http'), crypto = require('crypto');
const fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ADMIN_ID = String(process.env.ADMIN_ID || '618124780');
const DATA_FILE = path.join(process.env.DATA_DIR || __dirname, 'data.json');
const COUNTDOWN = 10000, CLOSE = 1000, RUN_MS = 9800, RESULT_MS = 4500;
const COLORS = ['#b733df', '#2769ec', '#28a6e8', '#ef4b9a', '#ff9c2c', '#08c980', '#f05245', '#704ee8'];
const r3 = x => Math.round(x * 1000) / 1000;

let users = {};
try { users = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) {}
let saveT = null;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { try { fs.writeFileSync(DATA_FILE, JSON.stringify(users)); } catch (e) { console.error(e); } }, 300);
}

function checkInit(initData) {
  if (!BOT_TOKEN || !initData) return null;
  const p = new URLSearchParams(initData), hash = p.get('hash');
  if (!hash) return null;
  p.delete('hash');
  const str = [...p.entries()].map(([k, v]) => k + '=' + v).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const h = crypto.createHmac('sha256', secret).update(str).digest('hex');
  if (h !== hash) return null;
  if (Date.now() / 1000 - Number(p.get('auth_date')) > 86400) return null;
  try { return JSON.parse(p.get('user')); } catch (e) { return null; }
}

// ---------- раунд ----------
let round, timer;
function newRound() { return { id: Date.now(), status: 'waiting', players: [], endsAt: 0, startAt: 0, seed: 0, winnerId: null }; }
round = newRound();

function spot() {
  let best = [50, 50], bd = -1;
  for (let k = 0; k < 40; k++) {
    const x = 10 + Math.random() * 80, y = 10 + Math.random() * 80;
    const d = round.players.reduce((m, o) => Math.min(m, (o.sx - x) ** 2 + (o.sy - y) ** 2), 1e9);
    if (d > bd) { bd = d; best = [x, y]; }
  }
  return best;
}

function bet(u, amt) {
  amt = r3(Number(amt));
  if (!(amt >= 0.01)) return 'Минимальная ставка 0.01 TON';
  if (amt > u.balance) return 'Недостаточно средств на балансе';
  if (round.status === 'running' || round.status === 'result') return 'Раунд уже идёт';
  if (round.status === 'countdown' && Date.now() > round.endsAt - CLOSE) return 'Приём ставок закрыт';
  u.balance = r3(u.balance - amt);
  let p = round.players.find(x => x.id === u.id);
  if (!p) {
    const [sx, sy] = spot();
    p = { id: u.id, name: u.name, photo: u.photo, stake: 0, color: COLORS[round.players.length % COLORS.length], sx, sy };
    round.players.push(p);
  }
  p.stake = r3(p.stake + amt);
  if (round.status === 'waiting' && round.players.length >= 2) {
    round.status = 'countdown';
    round.endsAt = Date.now() + COUNTDOWN;
    timer = setTimeout(startRun, COUNTDOWN);
  }
  save(); sendMe(u.id); broadcast();
  return null;
}

function startRun() {
  const pool = r3(round.players.reduce((s, p) => s + p.stake, 0));
  let x = Math.random() * pool, w = round.players[0];
  for (const p of round.players) { if (x < p.stake) { w = p; break; } x -= p.stake; }
  round.status = 'running';
  round.winnerId = w.id;
  round.seed = Math.floor(Math.random() * 2 ** 31);
  round.startAt = Date.now() + 500;
  broadcast();
  timer = setTimeout(finish, RUN_MS);
}

function finish() {
  const pool = r3(round.players.reduce((s, p) => s + p.stake, 0));
  const w = users[round.winnerId];
  if (w) w.balance = r3(w.balance + pool);
  round.status = 'result';
  save(); broadcast();
  round.players.forEach(p => sendMe(p.id));
  timer = setTimeout(() => { round = newRound(); broadcast(); }, RESULT_MS);
}

// ---------- сеть ----------
const app = express();
app.use(express.static(path.join(__dirname, 'public'), { etag: false, lastModified: false, setHeaders: r => r.setHeader('Cache-Control', 'no-store') }));
app.get('/health', (_, res) => res.send('ok'));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const clients = new Map(); // ws -> userId

const send = (ws, m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
function stateMsg() {
  return { t: 'state', now: Date.now(), online: clients.size, id: round.id, status: round.status, endsAt: round.endsAt,
    startAt: round.startAt, seed: round.seed, winnerId: round.winnerId,
    players: round.players.map(p => ({ id: p.id, name: p.name, photo: p.photo, stake: p.stake, color: p.color, sx: p.sx, sy: p.sy })) };
}
function broadcast() { const m = stateMsg(); for (const ws of clients.keys()) send(ws, m); }
function meMsg(id) { const u = users[id]; return { t: 'me', admin: id === ADMIN_ID, user: { id: u.id, name: u.name, photo: u.photo, balance: u.balance } }; }
function sendMe(id) { for (const [ws, uid] of clients) if (uid === id) send(ws, meMsg(id)); }
const userList = () => Object.values(users).map(u => ({ id: u.id, name: u.name, balance: u.balance }));

wss.on('connection', ws => {
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.t === 'auth') {
      const tu = checkInit(m.initData);
      if (!tu) return send(ws, { t: 'err', fatal: true, msg: 'Откройте приложение через Telegram' });
      const id = String(tu.id);
      const name = [tu.first_name, tu.last_name].filter(Boolean).join(' ') || tu.username || id;
      const u = users[id] || (users[id] = { id, balance: 0 });
      u.name = name; u.photo = tu.photo_url || ''; save();
      clients.set(ws, id);
      send(ws, meMsg(id)); broadcast();
      return;
    }
    const id = clients.get(ws); if (!id) return;
    const u = users[id];
    if (m.t === 'bet') { const e = bet(u, m.amount); if (e) send(ws, { t: 'err', msg: e }); }
    else if (id === ADMIN_ID && m.t === 'admin_users') send(ws, { t: 'users', list: userList() });
    else if (id === ADMIN_ID && m.t === 'admin_give') {
      const target = users[String(m.userId).trim()], amt = r3(Number(m.amount));
      if (!target) return send(ws, { t: 'err', msg: 'Пользователь не найден (он должен хотя бы раз открыть приложение)' });
      if (!Number.isFinite(amt) || amt === 0) return send(ws, { t: 'err', msg: 'Неверная сумма' });
      target.balance = Math.max(0, r3(target.balance + amt));
      save(); sendMe(target.id);
      send(ws, { t: 'ok', msg: `${target.name}: баланс ${target.balance} TON` });
      send(ws, { t: 'users', list: userList() });
    }
  });
  ws.on('close', () => { clients.delete(ws); broadcast(); });
});

server.listen(process.env.PORT || 3000, () => console.log('Ice Arena on', process.env.PORT || 3000));
