/**
 * ╔══════════════════════════════════════════════════╗
 * ║        SERVIDOR - Organizador Escolar            ║
 * ║  Banco de dados em arquivo JSON (sem instalar    ║
 * ║  nada extra — só Node.js puro)                   ║
 * ╚══════════════════════════════════════════════════╝
 *
 * COMO RODAR:
 *   node server.js
 *
 * COMO HOSPEDAR GRATUITAMENTE:
 *   1. Crie conta em https://render.com
 *   2. New > Web Service > conecte seu GitHub
 *   3. Suba estes arquivos (server.js + package.json)
 *   4. Build Command: (vazio)
 *      Start Command: node server.js
 *   5. Copie a URL gerada (ex: https://organizador-xyz.onrender.com)
 *   6. Cole no arquivo organizador_escolar.html na variável API_BASE
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

const PORT    = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

// ─── BANCO DE DADOS (arquivo JSON) ───────────────────────────────────
function dbRead() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    return { groups: {} };
  }
}

function dbWrite(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Garante que o arquivo existe
if (!fs.existsSync(DB_FILE)) dbWrite({ groups: {} });

// ─── HELPERS ─────────────────────────────────────────────────────────
function body(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch (e) { resolve({}); }
    });
    req.on('error', reject);
  });
}

function send(res, status, obj) {
  const json = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(json);
}

function purgeExpired(activities) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return activities.filter(a => {
    if (!a.date) return true;
    return new Date(a.date + 'T00:00:00') >= today;
  });
}

// ─── SERVIDOR ────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const method   = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    send(res, 200, {});
    return;
  }

  // Rota: GET /group/:code — busca atividades do grupo
  const matchGet = pathname.match(/^\/group\/([A-Z0-9]{4,12})$/i);
  if (method === 'GET' && matchGet) {
    const code = matchGet[1].toUpperCase();
    const db   = dbRead();
    const activities = purgeExpired(db.groups[code] || []);
    // salva já purgado
    if (db.groups[code] && db.groups[code].length !== activities.length) {
      db.groups[code] = activities;
      dbWrite(db);
    }
    send(res, 200, { code, activities });
    return;
  }

  // Rota: POST /group/:code — salva atividades do grupo
  const matchPost = pathname.match(/^\/group\/([A-Z0-9]{4,12})$/i);
  if (method === 'POST' && matchPost) {
    const code = matchPost[1].toUpperCase();
    const data = await body(req);
    const activities = Array.isArray(data.activities) ? data.activities : [];
    const db = dbRead();
    db.groups[code] = activities;
    dbWrite(db);
    send(res, 200, { ok: true, code, count: activities.length });
    return;
  }

  // Rota: DELETE /group/:code — apaga grupo inteiro
  const matchDel = pathname.match(/^\/group\/([A-Z0-9]{4,12})$/i);
  if (method === 'DELETE' && matchDel) {
    const code = matchDel[1].toUpperCase();
    const db   = dbRead();
    delete db.groups[code];
    dbWrite(db);
    send(res, 200, { ok: true });
    return;
  }

  // Rota: GET /health — status do servidor
  if (method === 'GET' && pathname === '/health') {
    const db     = dbRead();
    const groups = Object.keys(db.groups).length;
    const total  = Object.values(db.groups).reduce((s, a) => s + a.length, 0);
    send(res, 200, { status: 'ok', groups, totalActivities: total });
    return;
  }

  // 404
  send(res, 404, { error: 'Rota não encontrada' });
});

server.listen(PORT, () => {
  console.log(`✅ Servidor rodando em http://localhost:${PORT}`);
  console.log(`📂 Banco de dados: ${DB_FILE}`);
  console.log(`🔍 Verifique status: http://localhost:${PORT}/health`);
});
