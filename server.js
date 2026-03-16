require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const jwt       = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const path      = require('path');
const { createClient } = require('@supabase/supabase-js');

// ══ SUPABASE INIT ══
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lwwesclzkzaebwsaqibw.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_KEY) {
  console.error('⛔  SUPABASE_SERVICE_KEY not found in .env');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY || 'MISSING_KEY');

// ══ EXPRESS SETUP ══
const app  = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '15mb' }));

// Request Logger
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  next();
});

const generalLimiter = rateLimit({ windowMs: 60 * 1000,      max: 120, message: { error: 'Too many requests' } });
const loginLimiter   = rateLimit({ windowMs: 15 * 60 * 1000, max: 10,  message: { error: 'Too many login attempts' } });
app.use('/api/', generalLimiter);

// Serve frontend HTML files
app.use(express.static(path.join(__dirname, '..')));

// ══ AUTH MIDDLEWARE ══
const requireAuth = (req, res, next) => {
  const header = req.headers['authorization'];
  if (!header) return res.status(403).json({ error: 'No token provided' });
  const token = header.split(' ')[1];
  jwt.verify(token, process.env.JWT_SECRET, (err) => {
    if (err) return res.status(401).json({ error: 'Unauthorized' });
    next();
  });
};

// ══ INPUT VALIDATION ══
const ALLOWED_PRODUCT_KEYS = new Set([
  'name','name_en','price','stock','barcode','company',
  'active_ingredient','description','cat','badge','icon','image',
  'createdAt','updatedAt',
]);

function sanitizeProduct(data = {}) {
  const out = {};
  for (const k of Object.keys(data)) {
    if (ALLOWED_PRODUCT_KEYS.has(k)) out[k] = data[k];
  }
  if (!out.name || String(out.name).trim().length < 1) throw new Error('Product name is required');
  out.price = parseFloat(out.price) || 0;
  return out;
}

function validateOrder(data = {}) {
  if (!data.name  || String(data.name).trim().length  < 2) throw new Error('Invalid name');
  if (!data.phone || String(data.phone).trim().length < 7) throw new Error('Invalid phone');
  return true;
}

// ══ SUPABASE HELPERS ══
async function dbGetAll(table) {
  const { data, error } = await supabase.from(table).select('*').order('createdAt', { ascending: false });
  if (error) throw error;
  return data;
}

async function dbCreate(table, data) {
  const { id, ...rest } = data;
  const row = { ...rest, createdAt: Date.now() };
  if (id) row.id = String(id);
  const { data: result, error } = await supabase.from(table).insert(row).select().single();
  if (error) throw error;
  return result.id;
}

async function dbUpdate(table, id, data) {
  const { error } = await supabase.from(table).update({ ...data, updatedAt: Date.now() }).eq('id', id);
  if (error) throw error;
}

async function dbDelete(table, id) {
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw error;
}

// ══ Convert rows to REST shape (same as before so frontend stays unchanged) ══
function toRESTShape(rows) {
  return {
    documents: rows.map(row => {
      const fields = {};
      for (const [k, v] of Object.entries(row)) {
        if (k === 'id') continue;
        if (v === null || v === undefined)  fields[k] = { nullValue: null };
        else if (typeof v === 'number')     fields[k] = { doubleValue: v };
        else if (typeof v === 'boolean')    fields[k] = { booleanValue: v };
        else                                fields[k] = { stringValue: String(v) };
      }
      return { name: `projects/pharmacy/databases/(default)/documents/x/${row.id}`, fields };
    })
  };
}

function fromFields(fields = {}) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = v.stringValue ?? v.doubleValue ?? v.integerValue ?? v.booleanValue ?? v.nullValue ?? null;
  }
  return out;
}

// ══════════════════════════════════════
// PUBLIC ROUTES
// ══════════════════════════════════════

app.get('/api/products', async (_req, res) => {
  try {
    const rows = await dbGetAll('products');
    res.json(toRESTShape(rows));
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const raw = req.body.fields ? fromFields(req.body.fields) : req.body;
    validateOrder(raw);
    const id = await dbCreate('orders', raw);
    res.json({ name: `orders/${id}` });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Failed to create order' });
  }
});

app.get('/api/config/ticker', async (_req, res) => {
  try {
    const { data, error } = await supabase.from('settings').select('*').eq('id', 'ticker').single();
    if (error || !data) return res.json({ messages: [] });
    // In Supabase, if messages is stored as jsonb, it comes as an object/array
    const messages = typeof data.messages === 'string' ? JSON.parse(data.messages) : data.messages;
    res.json({ messages: messages || [] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch ticker' });
  }
});

// ══════════════════════════════════════
// ADMIN AUTH
// ══════════════════════════════════════

app.post('/api/admin/login', loginLimiter, (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });

  if (password === process.env.ADMIN_PASSWORD) {
    const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '12h' });
    res.json({ token, success: true });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

app.get('/api/admin/verify', requireAuth, (_req, res) => {
  res.json({ ok: true });
});

// ══════════════════════════════════════
// ADMIN PRODUCTS
// ══════════════════════════════════════

app.get('/api/admin/products', requireAuth, async (_req, res) => {
  try {
    const rows = await dbGetAll('products');
    res.json(toRESTShape(rows));
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

app.post('/api/admin/products', requireAuth, async (req, res) => {
  try {
    const raw  = req.body.fields ? fromFields(req.body.fields) : req.body;
    const data = sanitizeProduct(raw);
    const id   = await dbCreate('products', data);
    res.json({ name: `products/${id}` });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Failed to create product' });
  }
});

app.patch('/api/admin/products/:id', requireAuth, async (req, res) => {
  try {
    const raw  = req.body.fields ? fromFields(req.body.fields) : req.body;
    const data = sanitizeProduct({ name: raw.name || '_tmp', ...raw });
    delete data.name;
    if (raw.name) data.name = raw.name;
    await dbUpdate('products', req.params.id, data);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to update product' });
  }
});

app.delete('/api/admin/products/:id', requireAuth, async (req, res) => {
  try {
    await dbDelete('products', req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// ══════════════════════════════════════
// ADMIN ORDERS
// ══════════════════════════════════════

app.get('/api/admin/orders', requireAuth, async (_req, res) => {
  try {
    const rows = await dbGetAll('orders');
    res.json(toRESTShape(rows));
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

app.patch('/api/admin/orders/:id', requireAuth, async (req, res) => {
  try {
    const raw = req.body.fields ? fromFields(req.body.fields) : req.body;
    await dbUpdate('orders', req.params.id, raw);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to update order' });
  }
});

app.delete('/api/admin/orders/:id', requireAuth, async (req, res) => {
  try {
    await dbDelete('orders', req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete order' });
  }
});

// ══════════════════════════════════════
// ADMIN SETTINGS
// ══════════════════════════════════════

app.post('/api/admin/config/ticker', requireAuth, async (req, res) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages)) throw new Error('Invalid messages format');
    const { error } = await supabase.from('settings').upsert({
      id: 'ticker',
      messages: JSON.stringify(messages),
      updatedAt: Date.now()
    });
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Failed to update ticker' });
  }
});

// ══ START ══
app.listen(PORT, () =>
  console.log(`✅ Pharmacy Backend (Supabase) running on http://localhost:${PORT}`)
);
