
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 4000;
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'admin123';

// Paths & storage
const DATA_FILE = path.join(__dirname, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname || '');
    cb(null, 'proof-' + unique + ext);
  }
});
const upload = multer({ storage });

app.use(express.json());
app.use(express.static(PUBLIC_DIR));
app.use('/uploads', express.static(UPLOAD_DIR));

// --- DB helpers ---
function readDB() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = {
      settings: { totalTickets: 1000 },
      tickets: Array.from({length: 1000}, (_, i) => ({ id: i, status: 'free' })),
      purchases: [] // {id, name, email, tickets: [ids], status, proof, createdAt}
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    // fallback to defaults
    const initial = {
      settings: { totalTickets: 1000 },
      tickets: Array.from({length: 1000}, (_, i) => ({ id: i, status: 'free' })),
      purchases: []
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
}
function writeDB(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

// --- Admin auth middleware ---
function requireAdmin(req, res, next) {
  if (req.headers['x-admin-secret'] !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  next();
}

// --- Public API ---

// List all tickets
app.get('/api/tickets', (req, res) => {
  const db = readDB();
  res.json(db.tickets.slice(0, db.settings.totalTickets));
});

// Create purchase (multipart with proof)
app.post('/api/tickets/buy', upload.single('proof'), (req, res) => {
  const db = readDB();
  try {
    const name = req.body.name;
    const email = req.body.email;
    const phone = req.body.phone;
    const ticketsRaw = req.body.tickets; // expecting JSON string e.g. "[1,2,3]"
    const tickets = Array.isArray(ticketsRaw) ? ticketsRaw.map(Number) : JSON.parse(ticketsRaw || "[]");
    const proof = req.file ? ('/uploads/' + req.file.filename) : null;
    const reference = req.body.reference;

    if (!name || !email || !phone || !reference || !Array.isArray(tickets) || tickets.length === 0) {
      return res.status(400).json({ error: 'Datos inválidos' });
    }
    // Validate tickets availability
    if (tickets.some(id => id < 0 || id >= db.settings.totalTickets)) {
      return res.status(400).json({ error: 'Ticket fuera de rango' });
    }
    const notFree = tickets.filter(id => db.tickets[id].status !== 'free');
    if (notFree.length > 0) {
      return res.status(409).json({ error: 'Algunos tickets no están disponibles', tickets: notFree });
    }

    const purchase = {
      id: Date.now(),
      name, email, phone,
      tickets,
      status: 'pending',
      proof, reference,
      createdAt: new Date().toISOString()
    };
    db.purchases.push(purchase);
    tickets.forEach(id => { db.tickets[id].status = 'reserved'; });
    writeDB(db);
    res.json({ success: true, purchaseId: purchase.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al procesar la compra' });
  }
});

// --- Admin APIs ---

// Settings
app.get('/api/admin/settings', requireAdmin, (req, res) => {
  const db = readDB();
  res.json({ totalTickets: db.settings.totalTickets });
});

app.post('/api/admin/settings/tickets', requireAdmin, (req, res) => {
  const db = readDB();
  let { totalTickets } = req.body;
  totalTickets = parseInt(totalTickets);
  if (isNaN(totalTickets) || totalTickets <= 0) {
    return res.status(400).json({ error: 'Cantidad de tickets inválida' });
  }
  // find highest used ticket (reserved or approved)
  const used = db.tickets
    .filter(t => t.status !== 'free')
    .map(t => t.id);
  const maxUsed = used.length ? Math.max(...used) : -1;
  if (totalTickets <= maxUsed) {
    return res.status(400).json({ error: `No puedes bajar a ${totalTickets}. Hay tickets activos hasta el #${maxUsed}.` });
  }

  const current = db.settings.totalTickets;
  if (totalTickets > current) {
    for (let i = current; i < totalTickets; i++) {
      db.tickets[i] = { id: i, status: 'free' };
    }
  } else if (totalTickets < current) {
    // only allow if none of the to-be-removed are used (checked above)
    db.tickets = db.tickets.slice(0, totalTickets);
  }
  db.settings.totalTickets = totalTickets;
  writeDB(db);
  res.json({ success: true, totalTickets });
});

// Purchases list
app.get('/api/admin/purchases', requireAdmin, (req, res) => {
  const db = readDB();
  const status = req.query.status;
  let list = db.purchases.slice().sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt));
  if (status && status !== 'all') list = list.filter(p => p.status === status);
  res.json(list);
});

// Purchase details
app.get('/api/admin/purchases/:id', requireAdmin, (req, res) => {
  const db = readDB();
  const p = db.purchases.find(p => String(p.id) === String(req.params.id));
  if (!p) return res.status(404).json({ error: 'No existe' });
  res.json(p);
});

// Approve purchase
app.post('/api/admin/purchases/:id/approve', requireAdmin, (req, res) => {
  const db = readDB();
  const p = db.purchases.find(p => String(p.id) === String(req.params.id));
  if (!p) return res.status(404).json({ error: 'No existe' });
  p.status = 'approved';
  p.tickets.forEach(id => { if (db.tickets[id]) db.tickets[id].status = 'approved'; });
  writeDB(db);
  res.json({ success: true });
});

// Reject purchase
app.post('/api/admin/purchases/:id/reject', requireAdmin, (req, res) => {
  const db = readDB();
  const p = db.purchases.find(p => String(p.id) === String(req.params.id));
  if (!p) return res.status(404).json({ error: 'No existe' });
  p.status = 'rejected';
  p.tickets.forEach(id => { if (db.tickets[id]) db.tickets[id].status = 'free'; });
  writeDB(db);
  res.json({ success: true });
});

// Update participant
app.put('/api/admin/purchases/:id', requireAdmin, (req, res) => {
  const db = readDB();
  const p = db.purchases.find(p => String(p.id) === String(req.params.id));
  if (!p) return res.status(404).json({ error: 'No existe' });
  const { name, email } = req.body;
  if (name) p.name = name;
  if (email) p.email = email;
  writeDB(db);
  res.json({ success: true });
});

// Delete participant
app.delete('/api/admin/purchases/:id', requireAdmin, (req, res) => {
  const db = readDB();
  const idx = db.purchases.findIndex(p => String(p.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'No existe' });
  const purchase = db.purchases[idx];
  purchase.tickets.forEach(id => { if (db.tickets[id]) db.tickets[id].status = 'free'; });
  db.purchases.splice(idx, 1);
  writeDB(db);
  res.json({ success: true });
});

// Routes to serve pages
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

app.listen(PORT, () => console.log(`Servidor en http://localhost:${PORT}`));








// Descargar DB (solo admin)
app.get('/api/admin/db/download', requireAdmin, (req, res) => {
  if (!fs.existsSync(DATA_FILE)) {
    return res.status(404).json({ error: 'db.json no encontrado' });
  }
  res.download(DATA_FILE, 'db.json', (err) => {
    if (err) {
      console.error('Error al enviar db.json:', err);
      if (!res.headersSent) res.status(500).end();
    }
  });
});








// Subir DB (sobrescribir archivo) - solo admin
app.post('/api/admin/db/upload', requireAdmin, (req, res) => {
  try {
    if (!req.body) return res.status(400).json({ error: 'No se recibió contenido' });

    // Guardamos el JSON recibido directamente
    fs.writeFileSync(DATA_FILE, JSON.stringify(req.body, null, 2), 'utf8');

    res.json({ success: true, message: 'Base de datos actualizada correctamente' });
  } catch (err) {
    console.error('Error al subir DB:', err);
    res.status(500).json({ error: 'No se pudo actualizar la base de datos' });
  }
});


