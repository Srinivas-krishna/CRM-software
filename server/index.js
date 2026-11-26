import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import pg from 'pg';
import nodemailer from 'nodemailer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { partSchema, billSchema, materialStatuses, statuses, daysUntil } from './validation.js';
import { erpRouter } from './erp.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json({ limit: '1mb' }));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
app.use('/api/erp', erpRouter(pool));

const handle = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const idOf = raw => { const n = Number(raw); return Number.isSafeInteger(n) && n > 0 ? n : null; };
function validate(schema, input, res) {
  const result = schema.safeParse(input);
  if (!result.success) { res.status(400).json({ error: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') }); return null; }
  return result.data;
}
async function loadParts() {
  const [partResult, materialResult] = await Promise.all([
    pool.query('SELECT * FROM parts ORDER BY created_at DESC, id DESC'),
    pool.query('SELECT * FROM materials ORDER BY id')
  ]);
  const byPart = new Map();
  for (const material of materialResult.rows) {
    const key = String(material.part_id);
    if (!byPart.has(key)) byPart.set(key, []);
    byPart.get(key).push(material);
  }
  return partResult.rows.map(part => ({ ...part, materials: byPart.get(String(part.id)) || [] }));
}
async function insertMaterials(client, partId, materials) {
  for (const material of materials) await client.query(
    'INSERT INTO materials (part_id,name,supplier,quantity,unit,status) VALUES ($1,$2,$3,$4,$5,$6)',
    [partId, material.name, material.supplier, material.quantity, material.unit, material.status]
  );
}
async function withTransaction(fn) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

app.get('/api/health', handle(async (_req, res) => { await pool.query('SELECT 1'); res.json({ ok: true }); }));
app.get('/api/parts', handle(async (_req, res) => res.json(await loadParts())));
app.get('/api/parts/:id', handle(async (req, res) => {
  const part = (await loadParts()).find(p => String(p.id) === String(req.params.id));
  if (!part) return res.status(404).json({ error: 'Part not found' });
  res.json(part);
}));
app.post('/api/parts', handle(async (req, res) => {
  const data = validate(partSchema, req.body, res); if (!data) return;
  const id = await withTransaction(async client => {
    const result = await client.query(
      'INSERT INTO parts (part_code,name,customer,quantity,due_date,status,unit_price,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
      [data.partCode,data.name,data.customer,data.quantity,data.dueDate,data.status,data.unitPrice,data.notes]
    );
    await insertMaterials(client, result.rows[0].id, data.materials);
    return result.rows[0].id;
  });
  res.status(201).json({ id });
}));
app.put('/api/parts/:id', handle(async (req, res) => {
  const id = idOf(req.params.id); if (!id) return res.status(400).json({ error: 'Invalid part ID' });
  const data = validate(partSchema, req.body, res); if (!data) return;
  const updated = await withTransaction(async client => {
    const result = await client.query(
      'UPDATE parts SET part_code=$1,name=$2,customer=$3,quantity=$4,due_date=$5,status=$6,unit_price=$7,notes=$8,updated_at=now() WHERE id=$9 RETURNING id',
      [data.partCode,data.name,data.customer,data.quantity,data.dueDate,data.status,data.unitPrice,data.notes,id]
    );
    if (!result.rowCount) return false;
    await client.query('DELETE FROM materials WHERE part_id=$1', [id]);
    await insertMaterials(client, id, data.materials);
    return true;
  });
  if (!updated) return res.status(404).json({ error: 'Part not found' });
  res.json({ id });
}));
app.delete('/api/parts/:id', handle(async (req, res) => {
  const id = idOf(req.params.id); if (!id) return res.status(400).json({ error: 'Invalid part ID' });
  const result = await pool.query('DELETE FROM parts WHERE id=$1 RETURNING id', [id]);
  if (!result.rowCount) return res.status(404).json({ error: 'Part not found or already billed' });
  res.status(204).end();
}));
app.patch('/api/parts/:partId/materials/:materialId', handle(async (req, res) => {
  const partId = idOf(req.params.partId), materialId = idOf(req.params.materialId);
  if (!partId || !materialId || !materialStatuses.includes(req.body.status)) return res.status(400).json({ error: 'Invalid material or status' });
  const result = await pool.query('UPDATE materials SET status=$1 WHERE id=$2 AND part_id=$3 RETURNING *', [req.body.status, materialId, partId]);
  if (!result.rowCount) return res.status(404).json({ error: 'Material not found' });
  res.json(result.rows[0]);
}));
app.patch('/api/parts/:id/status', handle(async (req, res) => {
  const id = idOf(req.params.id);
  if (!id || !statuses.includes(req.body.status)) return res.status(400).json({ error: 'Invalid status' });
  const result = await pool.query('UPDATE parts SET status=$1,updated_at=now() WHERE id=$2 RETURNING *', [req.body.status,id]);
  if (!result.rowCount) return res.status(404).json({ error: 'Part not found' });
  res.json(result.rows[0]);
}));
app.get('/api/bills', handle(async (_req, res) => {
  const result = await pool.query('SELECT * FROM bills ORDER BY created_at DESC');
  res.json(result.rows);
}));
app.post('/api/parts/:id/bills', handle(async (req, res) => {
  const id = idOf(req.params.id); if (!id) return res.status(400).json({ error: 'Invalid part ID' });
  const data = validate(billSchema, req.body, res); if (!data) return;
  const bill = await withTransaction(async client => {
    const part = await client.query('SELECT id,part_code,name,customer,quantity FROM parts WHERE id=$1', [id]);
    if (!part.rowCount) return null;
    const snapshot = part.rows[0];
    const result = await client.query('INSERT INTO bills (part_id,part_code,name,customer,quantity,unit_price,tax_rate) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [id,snapshot.part_code,snapshot.name,snapshot.customer,snapshot.quantity,data.unitPrice,data.taxRate]);
    const row = result.rows[0];
    const billNumber = `INV-${new Date().getUTCFullYear()}-${String(row.id).padStart(5,'0')}`;
    await client.query('UPDATE bills SET bill_number=$1 WHERE id=$2', [billNumber,row.id]);
    return { ...row, bill_number: billNumber };
  });
  if (!bill) return res.status(404).json({ error: 'Part not found' });
  res.status(201).json(bill);
}));
app.get('/api/alerts', handle(async (_req, res) => {
  const [parts, sent] = await Promise.all([
    pool.query("SELECT id,part_code,name,customer,due_date,status FROM parts WHERE status <> 'Delivered' ORDER BY due_date ASC"),
    pool.query('SELECT a.*,p.part_code FROM alerts a JOIN parts p ON p.id=a.part_id ORDER BY a.created_at DESC LIMIT 30')
  ]);
  const upcoming = parts.rows.map(p => ({ ...p, daysRemaining: daysUntil(p.due_date.toISOString().slice(0,10)) }))
    .filter(p => p.daysRemaining <= 7);
  res.json({ upcoming, sent: sent.rows });
}));
app.post('/api/parts/:id/alerts', handle(async (req, res) => {
  const id = idOf(req.params.id); if (!id) return res.status(400).json({ error: 'Invalid part ID' });
  const result = await pool.query('SELECT * FROM parts WHERE id=$1', [id]);
  if (!result.rowCount) return res.status(404).json({ error: 'Part not found' });
  const part = result.rows[0];
  const days = daysUntil(part.due_date.toISOString().slice(0,10));
  const when = days < 0 ? `${Math.abs(days)} day(s) overdue` : days === 0 ? 'due today' : `due in ${days} day(s)`;
  const message = `${part.part_code} · ${part.name} for ${part.customer} is ${when}.`;
  const channel = req.body?.channel === 'email' ? 'email' : 'in-app';
  if (channel === 'email') {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, ALERT_EMAIL } = process.env;
    if (!SMTP_HOST || !SMTP_FROM || !ALERT_EMAIL) return res.status(400).json({ error: 'Email is not configured. Set SMTP_HOST, SMTP_FROM and ALERT_EMAIL in .env.' });
    const transporter = nodemailer.createTransport({ host: SMTP_HOST, port: Number(SMTP_PORT || 587), secure: Number(SMTP_PORT) === 465,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASSWORD } : undefined });
    await transporter.sendMail({ from: SMTP_FROM, to: ALERT_EMAIL, subject: `Delivery alert: ${part.part_code}`, text: message });
  }
  const saved = await pool.query('INSERT INTO alerts (part_id,message,channel) VALUES ($1,$2,$3) RETURNING *', [id,message,channel]);
  res.status(201).json(saved.rows[0]);
}));

app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found' }));
app.use(express.static(path.join(root, 'dist')));
app.get('*', (_req, res) => res.sendFile(path.join(root, 'dist/index.html')));
app.use((error, _req, res, _next) => {
  console.error(error);
  if (error.code === '23505') return res.status(409).json({ error: 'That part ID is already in use.' });
  if (error.code === '23503') return res.status(409).json({ error: 'This part has saved bills and cannot be deleted.' });
  if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') return res.status(503).json({ error: 'PostgreSQL is unavailable. Check DATABASE_URL and the database service.' });
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Copy .env.example to .env and set your PostgreSQL connection string.');
  const schema = await fs.readFile(path.join(root,'server/schema.sql'),'utf8');
  await pool.query(schema);
  await pool.query(await fs.readFile(path.join(root,'server/erp-schema.sql'),'utf8'));
  const port = Number(process.env.PORT || 4000);
  app.listen(port, () => console.log(`ForgeFlow API listening on http://localhost:${port}`));
}
main().catch(error => { console.error(error); process.exit(1); });
