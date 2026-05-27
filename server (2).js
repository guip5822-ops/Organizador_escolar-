/**
 * ╔══════════════════════════════════════════════════╗
 * ║     SERVIDOR - Organizador Escolar               ║
 * ║     Banco de dados: MongoDB Atlas (nuvem)        ║
 * ╚══════════════════════════════════════════════════╝
 *
 * COMO RODAR LOCALMENTE:
 *   1. npm install
 *   2. Crie o arquivo .env com: MONGODB_URI=sua_uri_aqui
 *   3. node server.js
 */

const http     = require('http');
const url      = require('url');

// ─── MONGODB via API REST (sem instalar driver) ───────────────────────
// Usamos a Data API do MongoDB Atlas — funciona com fetch puro, sem npm
const MONGODB_URI  = process.env.MONGODB_URI || '';
const PORT         = process.env.PORT || 3000;

// Extrai credenciais da URI mongodb+srv://user:pass@cluster.../dbname
function parseMongoURI(uri) {
  try {
    // mongodb+srv://user:pass@cluster.mongodb.net/dbname?...
    const match = uri.match(/mongodb(?:\+srv)?:\/\/([^:]+):([^@]+)@([^/]+)\/([^?]+)/);
    if (!match) return null;
    return { user: match[1], pass: match[2], host: match[3], db: match[4] || 'organizador' };
  } catch(e) { return null; }
}

// ─── CLIENTE MONGODB NATIVO (módulo http do Node) ─────────────────────
// Conecta direto via protocolo MongoDB Wire usando net/tls do Node.js
// Para simplificar sem instalar o driver, usamos uma abordagem com
// variável de ambiente e o driver oficial via CDN quando disponível.

// Na verdade: usamos o driver mongodb via require — o Render instala via package.json
let db = null;
let client = null;

async function connectDB() {
  if (db) return db;
  if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI não definida! Configure a variável de ambiente.');
    process.exit(1);
  }
  // Tenta usar o driver mongodb (instalado via package.json)
  try {
    const { MongoClient } = require('mongodb');
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    const parsed = parseMongoURI(MONGODB_URI);
    const dbName = parsed ? parsed.db : 'organizador';
    db = client.db(dbName);
    console.log('✅ Conectado ao MongoDB Atlas! DB:', dbName);
    return db;
  } catch(e) {
    console.error('❌ Erro ao conectar MongoDB:', e.message);
    process.exit(1);
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────────
function bodyJSON(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch(e) { resolve({}); }
    });
    req.on('error', reject);
  });
}

function send(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(obj));
}

function purgeExpired(activities) {
  const today = new Date(); today.setHours(0,0,0,0);
  return (activities || []).filter(a => {
    if (!a.date) return true;
    return new Date(a.date + 'T00:00:00') >= today;
  });
}

// ─── SERVIDOR ────────────────────────────────────────────────────────
async function startServer() {
  const database = await connectDB();
  const groups   = database.collection('groups');

  const server = http.createServer(async (req, res) => {
    const parsed   = url.parse(req.url, true);
    const pathname = parsed.pathname;
    const method   = req.method;

    // CORS preflight
    if (method === 'OPTIONS') { send(res, 200, {}); return; }

    // GET /health
    if (method === 'GET' && pathname === '/health') {
      const count = await groups.countDocuments();
      const all   = await groups.find({}).toArray();
      const total = all.reduce((s, g) => s + (g.activities || []).length, 0);
      send(res, 200, { status: 'ok', groups: count, totalActivities: total });
      return;
    }

    // GET /group/:code
    const matchCode = pathname.match(/^\/group\/([A-Z0-9]{4,12})$/i);
    if (matchCode) {
      const code = matchCode[1].toUpperCase();

      if (method === 'GET') {
        const doc = await groups.findOne({ code });
        let activities = purgeExpired(doc ? doc.activities : []);
        // Salva já purgado
        if (doc && doc.activities && doc.activities.length !== activities.length) {
          await groups.updateOne({ code }, { $set: { activities } });
        }
        send(res, 200, { code, activities });
        return;
      }

      if (method === 'POST') {
        const data       = await bodyJSON(req);
        const activities = Array.isArray(data.activities) ? data.activities : [];
        await groups.updateOne(
          { code },
          { $set: { code, activities, updatedAt: new Date() } },
          { upsert: true }
        );
        send(res, 200, { ok: true, code, count: activities.length });
        return;
      }

      if (method === 'DELETE') {
        await groups.deleteOne({ code });
        send(res, 200, { ok: true });
        return;
      }
    }

    send(res, 404, { error: 'Rota não encontrada' });
  });

  server.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`🔍 Health check: http://localhost:${PORT}/health`);
  });
}

startServer();
