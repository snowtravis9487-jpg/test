import pg from 'pg'
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.')
  process.exit(1)
}

// Hosted Postgres (Supabase) requires TLS; its pooler certificate is not signed
// by a public CA, so the chain is not verified here.
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url)
const pool = new pg.Pool({
  connectionString: url,
  max: 5,
  ssl: isLocal ? false : { rejectUnauthorized: false },
})
pool.on('error', (err) => console.error('Database connection error:', err.message))

// `client` defaults to the pool; pass the transaction client inside transaction().
export const query = async (text, params = [], client = pool) =>
  (await client.query(text, params)).rows
export const one = async (text, params, client) => (await query(text, params, client))[0]
export const run = async (text, params = [], client = pool) =>
  (await client.query(text, params)).rowCount

export async function transaction(fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

const TABLES = ['settings', 'leave_types', 'holidays', 'employees', 'requests', 'sessions']

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value JSONB NOT NULL
  );
  CREATE TABLE IF NOT EXISTS leave_types (
    id    TEXT PRIMARY KEY,
    seq   SERIAL,
    name  TEXT NOT NULL,
    days  DOUBLE PRECISION,   -- NULL = unlimited
    color TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS holidays (
    id        TEXT PRIMARY KEY,
    date      TEXT NOT NULL,  -- 'YYYY-MM-DD'
    name      TEXT NOT NULL,
    recurring BOOLEAN NOT NULL DEFAULT FALSE
  );
  CREATE TABLE IF NOT EXISTS employees (
    id            TEXT PRIMARY KEY,
    seq           SERIAL,
    username      TEXT NOT NULL UNIQUE,  -- always stored lower-case
    name          TEXT NOT NULL,
    department    TEXT NOT NULL DEFAULT '',
    is_admin      BOOLEAN NOT NULL DEFAULT FALSE,
    password_hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS requests (
    id          TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    type_id     TEXT NOT NULL,
    start_date  TEXT NOT NULL,
    end_date    TEXT NOT NULL,
    half_day    BOOLEAN NOT NULL DEFAULT FALSE,
    days        DOUBLE PRECISION NOT NULL,
    reason      TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'pending',
    created_at  TEXT NOT NULL,
    reviewed_by TEXT,
    remark      TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    expires_at  BIGINT NOT NULL
  );
  -- Supabase exposes public tables through its auto-generated REST API. With
  -- row level security on and no policies, that API can read nothing; this
  -- server connects as the table owner, which is not restricted by it.
  ${TABLES.map((t) => `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`).join('\n  ')}
`

// ---- Passwords ----

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':')
  const expected = Buffer.from(hash, 'hex')
  return timingSafeEqual(scryptSync(password, salt, expected.length), expected)
}

// ---- First-run seed ----
// Everything seeded here can be changed from the Settings page afterwards.

async function seed(client) {
  const setting = 'INSERT INTO settings (key, value) VALUES ($1, $2)'
  await run(setting, ['companyName', JSON.stringify('My Company')], client)
  await run(setting, ['weekendDays', JSON.stringify([0, 6])], client) // 0 = Sunday ... 6 = Saturday

  for (const type of [
    ['annual', 'Annual Leave', 14, '#2563eb'],
    ['medical', 'Medical Leave', 14, '#dc2626'],
    ['hospital', 'Hospitalisation Leave', 60, '#9333ea'],
    ['unpaid', 'Unpaid Leave', null, '#6b7280'],
  ]) {
    await run('INSERT INTO leave_types (id, name, days, color) VALUES ($1, $2, $3, $4)', type, client)
  }

  // `recurring` holidays repeat every year; lunar / Islamic ones are per-year.
  for (const [date, name, recurring] of [
    ['2026-01-01', "New Year's Day", true],
    ['2026-02-17', 'Chinese New Year', false],
    ['2026-02-18', 'Chinese New Year (Day 2)', false],
    ['2026-03-21', 'Hari Raya Aidilfitri', false],
    ['2026-03-22', 'Hari Raya Aidilfitri (Day 2)', false],
    ['2026-05-01', 'Labour Day', true],
    ['2026-05-27', 'Hari Raya Haji', false],
    ['2026-05-31', 'Wesak Day', false],
    ['2026-06-01', "Agong's Birthday", false],
    ['2026-06-17', 'Awal Muharram', false],
    ['2026-08-25', 'Maulidur Rasul', false],
    ['2026-08-31', 'National Day', true],
    ['2026-09-16', 'Malaysia Day', true],
    ['2026-11-08', 'Deepavali', false],
    ['2026-12-25', 'Christmas Day', true],
  ]) {
    await run(
      'INSERT INTO holidays (id, date, name, recurring) VALUES ($1, $2, $3, $4)',
      [randomUUID(), date, name, recurring],
      client,
    )
  }

  const password = process.env.ADMIN_PASSWORD || 'admin123'
  await run(
    `INSERT INTO employees (id, username, name, department, is_admin, password_hash)
     VALUES ($1, 'admin', 'Admin', 'HR', TRUE, $2)`,
    [randomUUID(), hashPassword(password)],
    client,
  )
  console.log(
    process.env.ADMIN_PASSWORD
      ? 'Created first admin account — username: admin, password: (from ADMIN_PASSWORD)'
      : 'Created first admin account — username: admin, password: admin123',
  )
  console.log('Change this password after signing in (Account page).')
}

// Creates the tables and, on an empty database, the default data.
export async function initDb() {
  await transaction(async (client) => {
    await client.query(SCHEMA)
    const { n } = await one('SELECT COUNT(*)::int AS n FROM employees', [], client)
    if (n === 0) await seed(client)
  })
}

// ---- Read everything in the shape the frontend uses ----

export async function loadData(client) {
  const [settings, leaveTypes, holidays, employees, requests] = [
    await query('SELECT key, value FROM settings', [], client),
    await query('SELECT id, name, days, color FROM leave_types ORDER BY seq', [], client),
    await query('SELECT id, date, name, recurring FROM holidays ORDER BY date', [], client),
    await query(
      'SELECT id, username, name, department, is_admin FROM employees ORDER BY seq',
      [],
      client,
    ),
    await query('SELECT * FROM requests ORDER BY start_date', [], client),
  ]
  return {
    settings: Object.fromEntries(settings.map((r) => [r.key, r.value])),
    leaveTypes,
    holidays,
    employees: employees.map((e) => ({
      id: e.id,
      username: e.username,
      name: e.name,
      department: e.department,
      isAdmin: e.is_admin,
    })),
    requests: requests.map((r) => ({
      id: r.id,
      employeeId: r.employee_id,
      typeId: r.type_id,
      start: r.start_date,
      end: r.end_date,
      halfDay: r.half_day,
      days: r.days,
      reason: r.reason,
      status: r.status,
      createdAt: r.created_at,
      reviewedBy: r.reviewed_by,
      remark: r.remark,
    })),
  }
}
