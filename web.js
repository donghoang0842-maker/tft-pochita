require('dotenv').config();

const http = require('http');
const mongoose = require('mongoose');
const { URL } = require('url');

const PORT = process.env.PORT || 10000;

const dataSchema = new mongoose.Schema(
  {
    players: { type: Array, default: [] },
    queue: { type: Array, default: [] },
    matches: { type: Array, default: [] },
    nextMatchId: { type: Number, default: 1 },
  },
  {
    collection: 'datas',
    versionKey: false,
    strict: false,
  }
);

const Data = mongoose.models.Data || mongoose.model('Data', dataSchema);

function defaultData() {
  return {
    players: [],
    queue: [],
    matches: [],
    nextMatchId: 1,
  };
}

async function ensureMongo() {
  if (!process.env.MONGO_URI) {
    throw new Error('Thiếu MONGO_URI trong file .env / Render Environment');
  }

  if (mongoose.connection.readyState === 1) {
    return;
  }
  console.log('WEB MONGO_URI prefix:', String(process.env.MONGO_URI || '').slice(0, 20));
  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 15000,
  });
}

async function loadMongoData() {
  const doc = await Data.findOne().lean();
  if (!doc) return defaultData();

  return {
    players: Array.isArray(doc.players) ? doc.players : [],
    queue: Array.isArray(doc.queue) ? doc.queue : [],
    matches: Array.isArray(doc.matches) ? doc.matches : [],
    nextMatchId: Number.isInteger(doc.nextMatchId) ? doc.nextMatchId : 1,
  };
}

function getPlayerByDiscordId(data, id) {
  return data.players.find((p) => p.discordId === id);
}

function getQueuePlayers(data) {
  return data.queue
    .map((id) => getPlayerByDiscordId(data, id))
    .filter(Boolean);
}

function createPlacementCounter() {
  return {
    top1: 0,
    top2: 0,
    top3: 0,
    top4: 0,
    top5: 0,
    top6: 0,
    top7: 0,
    top8: 0,
  };
}

function countPlacements(matches, playerName) {
  const result = createPlacementCounter();

  for (const match of matches) {
    if (match.status !== 'COMPLETED') continue;

    const player = (match.players || []).find(
      (p) => String(p.name).toLowerCase() === String(playerName).toLowerCase()
    );

    if (!player || !Number.isInteger(player.placement)) continue;

    const key = `top${player.placement}`;
    if (result[key] !== undefined) {
      result[key] += 1;
    }
  }

  return result;
}

function getRankedPlayers(data) {
  const completedMatches = data.matches.filter((m) => m.status === 'COMPLETED');

  return data.players
    .map((player) => {
      const placements = countPlacements(completedMatches, player.name);
      return {
        ...player,
        top1: placements.top1,
        top2: placements.top2,
        top3: placements.top3,
        top4: placements.top4,
        top5: placements.top5,
        top6: placements.top6,
        top7: placements.top7,
        top8: placements.top8,
        matchesPlayed: Number(player.matchesPlayed ?? 0) || 0,
        points: Number(player.points ?? 0) || 0,
      };
    })
    .sort((a, b) => {
      if ((b.points || 0) !== (a.points || 0)) return (b.points || 0) - (a.points || 0);
      if ((b.top1 || 0) !== (a.top1 || 0)) return (b.top1 || 0) - (a.top1 || 0);
      if ((b.top2 || 0) !== (a.top2 || 0)) return (b.top2 || 0) - (a.top2 || 0);
      if ((b.top3 || 0) !== (a.top3 || 0)) return (b.top3 || 0) - (a.top3 || 0);
      if ((b.top4 || 0) !== (a.top4 || 0)) return (b.top4 || 0) - (a.top4 || 0);
      if ((b.top5 || 0) !== (a.top5 || 0)) return (b.top5 || 0) - (a.top5 || 0);
      if ((b.top6 || 0) !== (a.top6 || 0)) return (b.top6 || 0) - (a.top6 || 0);
      if ((b.top7 || 0) !== (a.top7 || 0)) return (b.top7 || 0) - (a.top7 || 0);
      if ((b.top8 || 0) !== (a.top8 || 0)) return (b.top8 || 0) - (a.top8 || 0);
      if ((a.matchesPlayed || 0) !== (b.matchesPlayed || 0)) {
        return (a.matchesPlayed || 0) - (b.matchesPlayed || 0);
      }
      return String(a.name || '').localeCompare(String(b.name || ''), 'vi');
    });
}

function formatMatch(match) {
  const players = [...(match.players || [])].sort((a, b) => {
    const pa = Number.isInteger(a.placement) ? a.placement : 999;
    const pb = Number.isInteger(b.placement) ? b.placement : 999;
    return pa - pb;
  });

  return {
    id: match.id,
    status: match.status,
    reportedAt: match.reportedAt,
    players,
  };
}

function buildHtml() {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TFT Leaderboard</title>
  <style>
    * { box-sizing: border-box; }

    :root {
      --bg: #071126;
      --card: rgba(16, 27, 56, 0.88);
      --card2: rgba(16, 24, 48, 0.95);
      --line: rgba(255,255,255,0.08);
      --text: #eef4ff;
      --muted: #9aa7c7;
      --gold: #ffd76a;
      --green: #4ade80;
      --red: #f87171;
      --shadow: 0 12px 35px rgba(0,0,0,0.35);
      --radius: 18px;
    }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, Arial, sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(79, 130, 255, 0.18), transparent 24%),
        radial-gradient(circle at top right, rgba(57, 160, 255, 0.12), transparent 20%),
        linear-gradient(180deg, #071126 0%, #04102a 100%);
    }

    .container {
      width: min(1240px, calc(100% - 32px));
      margin: 0 auto;
      padding: 24px 0 40px;
    }

    .hero {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      padding: 22px 24px;
      border: 1px solid var(--line);
      border-radius: 24px;
      background: linear-gradient(135deg, rgba(72, 121, 255, 0.18), rgba(55, 150, 255, 0.08));
      box-shadow: var(--shadow);
      margin-bottom: 18px;
      backdrop-filter: blur(12px);
    }

    .hero h1 {
      margin: 0 0 8px;
      font-size: 34px;
      line-height: 1.1;
    }

    .hero p {
      margin: 0;
      color: var(--muted);
      font-size: 14px;
    }

    .refresh {
      white-space: nowrap;
      padding: 10px 14px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.05);
      color: var(--text);
      font-size: 13px;
    }

    .layout {
      display: grid;
      grid-template-columns: 2fr 1.18fr;
      gap: 16px;
    }

    .stack {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      overflow: hidden;
      backdrop-filter: blur(10px);
    }

    .card-header {
      padding: 16px 18px 12px;
      border-bottom: 1px solid var(--line);
    }

    .card-title {
      margin: 0 0 3px;
      font-size: 18px;
      font-weight: 800;
    }

    .card-sub {
      color: var(--muted);
      font-size: 13px;
    }

    .card-body {
      padding: 16px 18px 18px;
    }

    .table-wrap {
      overflow-x: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 1180px;
    }

    th, td {
      padding: 14px 12px;
      text-align: left;
      border-bottom: 1px solid var(--line);
      font-size: 14px;
    }

    th {
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
    }

    tbody tr:hover {
      background: rgba(255,255,255,0.03);
    }

    .rank-pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 42px;
      height: 32px;
      border-radius: 999px;
      background: var(--gold);
      color: #111827;
      font-weight: 900;
      padding: 0 12px;
    }

    .name { font-weight: 700; }
    .points { font-weight: 800; }

    .queue-list,
    .history-list,
    .match-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .queue-item,
    .history-item,
    .match-box {
      border: 1px solid var(--line);
      background: var(--card2);
      border-radius: 14px;
      padding: 14px;
    }

    .queue-item {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .queue-badge,
    .place-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      border-radius: 999px;
      background: rgba(255,255,255,0.06);
      border: 1px solid var(--line);
      font-size: 12px;
      font-weight: 800;
      flex-shrink: 0;
    }

    .queue-name { font-weight: 700; }

    .match-head,
    .history-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 10px;
    }

    .match-id {
      font-weight: 800;
      font-size: 18px;
    }

    .match-status {
      padding: 7px 10px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: rgba(79,130,255,0.12);
      font-size: 12px;
    }

    .row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      padding: 10px 0;
      border-bottom: 1px solid var(--line);
    }

    .row:last-child { border-bottom: none; }

    .row-left {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }

    .delta.plus { color: var(--green); font-weight: 800; }
    .delta.minus { color: var(--red); font-weight: 800; }
    .muted { color: var(--muted); font-size: 14px; }
    .history-date { color: var(--muted); font-size: 13px; }

    @media (max-width: 980px) {
      .layout { grid-template-columns: 1fr; }
    }

    @media (max-width: 640px) {
      .container {
        width: min(100% - 20px, 1240px);
        padding-top: 16px;
      }

      .hero {
        flex-direction: column;
        align-items: flex-start;
        padding: 18px;
      }

      .hero h1 { font-size: 28px; }

      .card-header,
      .card-body {
        padding-left: 14px;
        padding-right: 14px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <section class="hero">
      <div>
        <h1>TFT Leaderboard</h1>
        <p>Theo dõi bảng điểm, hàng chờ, match hiện tại và lịch sử match theo thời gian thực.</p>
      </div>
      <div class="refresh" id="lastRefresh">Đang tải...</div>
    </section>

    <section class="layout">
      <div class="stack">
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">Bảng xếp hạng</h2>
            <div class="card-sub">Xếp hạng theo điểm, hiển thị đầy đủ 1 đến 8</div>
          </div>
          <div class="card-body">
            <div id="leaderboard"></div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h2 class="card-title">Lịch sử match</h2>
            <div class="card-sub">5 match hoàn thành gần nhất</div>
          </div>
          <div class="card-body">
            <div id="history"></div>
          </div>
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">Queue</h2>
            <div class="card-sub">Danh sách người đang chờ</div>
          </div>
          <div class="card-body">
            <div id="queue"></div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h2 class="card-title">Match hiện tại</h2>
            <div class="card-sub">Match đang mở</div>
          </div>
          <div class="card-body">
            <div id="match"></div>
          </div>
        </div>
      </div>
    </section>
  </div>

  <script>
    async function fetchJson(url) {
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Request failed');
      return data;
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function renderLeaderboard(players) {
      const el = document.getElementById('leaderboard');

      if (!players.length) {
        el.innerHTML = '<div class="muted">Chưa có người chơi nào.</div>';
        return;
      }

      let rows = '';
      for (let i = 0; i < players.length; i++) {
        const p = players[i];
        const rankHtml = i === 0 ? '<span class="rank-pill">#1</span>' : '#' + (i + 1);

        rows += '<tr>' +
          '<td>' + rankHtml + '</td>' +
          '<td><span class="name">' + escapeHtml(p.name) + '</span></td>' +
          '<td class="points">' + (p.points || 0) + '</td>' +
          '<td>' + (p.matchesPlayed || 0) + '</td>' +
          '<td>' + (p.top1 || 0) + '</td>' +
          '<td>' + (p.top2 || 0) + '</td>' +
          '<td>' + (p.top3 || 0) + '</td>' +
          '<td>' + (p.top4 || 0) + '</td>' +
          '<td>' + (p.top5 || 0) + '</td>' +
          '<td>' + (p.top6 || 0) + '</td>' +
          '<td>' + (p.top7 || 0) + '</td>' +
          '<td>' + (p.top8 || 0) + '</td>' +
        '</tr>';
      }

      el.innerHTML =
        '<div class="table-wrap">' +
          '<table>' +
            '<thead>' +
              '<tr>' +
                '<th>Hạng</th>' +
                '<th>Tên</th>' +
                '<th>Điểm</th>' +
                '<th>Trận</th>' +
                '<th>1</th>' +
                '<th>2</th>' +
                '<th>3</th>' +
                '<th>4</th>' +
                '<th>5</th>' +
                '<th>6</th>' +
                '<th>7</th>' +
                '<th>8</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>';
    }

    function renderQueue(queue) {
      const el = document.getElementById('queue');

      if (!queue.length) {
        el.innerHTML = '<div class="muted">Queue đang trống.</div>';
        return;
      }

      let html = '<div class="queue-list">';
      for (let i = 0; i < queue.length; i++) {
        const p = queue[i];
        html += '<div class="queue-item">' +
          '<span class="queue-badge">' + (i + 1) + '</span>' +
          '<span class="queue-name">' + escapeHtml(p.name) + '</span>' +
        '</div>';
      }
      html += '</div>';

      el.innerHTML = html;
    }

    function renderCurrentMatch(match) {
      const el = document.getElementById('match');

      if (!match) {
        el.innerHTML = '<div class="muted">Hiện không có match nào đang mở.</div>';
        return;
      }

      let playersHtml = '';
      for (let i = 0; i < match.players.length; i++) {
        const p = match.players[i];
        playersHtml += '<div class="row">' +
          '<div class="row-left">' +
            '<span class="place-badge">' + (p.placement || (i + 1)) + '</span>' +
            '<span>' + escapeHtml(p.name) + '</span>' +
          '</div>' +
        '</div>';
      }

      el.innerHTML =
        '<div class="match-box">' +
          '<div class="match-head">' +
            '<div class="match-id">Match #' + match.id + '</div>' +
            '<div class="match-status">' + escapeHtml(match.status) + '</div>' +
          '</div>' +
          '<div class="match-list">' + playersHtml + '</div>' +
        '</div>';
    }

    function renderHistory(history) {
      const el = document.getElementById('history');

      if (!history.length) {
        el.innerHTML = '<div class="muted">Chưa có match nào hoàn thành.</div>';
        return;
      }

      let html = '<div class="history-list">';

      for (let i = 0; i < history.length; i++) {
        const match = history[i];
        html += '<div class="history-item">' +
          '<div class="history-head">' +
            '<strong>Match #' + match.id + '</strong>' +
            '<span class="history-date">' +
              (match.reportedAt ? new Date(match.reportedAt).toLocaleString('vi-VN') : '') +
            '</span>' +
          '</div>';

        for (let j = 0; j < match.players.length; j++) {
          const p = match.players[j];
          const delta = Number(p.pointsChange || 0);
          const deltaClass = delta >= 0 ? 'plus' : 'minus';
          const deltaText = delta >= 0 ? '+' + delta : String(delta);

          html += '<div class="row">' +
            '<div class="row-left">' +
              '<span class="place-badge">' + (p.placement || '-') + '</span>' +
              '<span>' + escapeHtml(p.name) + '</span>' +
            '</div>' +
            '<span class="delta ' + deltaClass + '">' + deltaText + '</span>' +
          '</div>';
        }

        html += '</div>';
      }

      html += '</div>';
      el.innerHTML = html;
    }

    async function load() {
      const data = await fetchJson('/api');
      renderLeaderboard(data.players || []);
      renderQueue(data.queue || []);
      renderCurrentMatch(data.currentMatch);
      renderHistory(data.history || []);
      document.getElementById('lastRefresh').textContent =
        'Cập nhật: ' + new Date().toLocaleTimeString('vi-VN');
    }

    load();
    setInterval(load, 5000);
  </script>
</body>
</html>`;
}

async function requestHandler(req, res) {
  const url = new URL(req.url, 'http://' + req.headers.host);

  if (url.pathname === '/api') {
    try {
      const data = await loadMongoData();
      const players = getRankedPlayers(data);
      const queue = getQueuePlayers(data);
      const currentMatch = data.matches.find((m) => m.status === 'OPEN');
      const history = data.matches
        .filter((m) => m.status === 'COMPLETED')
        .slice(-5)
        .reverse()
        .map(formatMatch);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        players,
        queue,
        currentMatch: currentMatch ? formatMatch(currentMatch) : null,
        history,
      }));
      return;
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ message: error.message }));
      return;
    }
  }

  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(buildHtml());
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
}

let serverStarted = false;

async function startWeb() {
  if (serverStarted) return;

  const server = http.createServer((req, res) => {
    requestHandler(req, res).catch((err) => {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ message: err.message }));
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log('WEB RUN ' + PORT);
  });

  serverStarted = true;

  await ensureMongo();
  console.log('WEB MongoDB connected');
}

module.exports = { startWeb };

if (require.main === module) {
  startWeb().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}