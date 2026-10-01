import express from 'express'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initDb, loadData, query, one, run, transaction, hashPassword, verifyPassword } from './db.js'
import { checkLeave, isISODate } from '../shared/leave.js'
import { todayISO } from '../shared/dates.js'

const PORT = process.env.PORT || 3001
const SESSION_MS = 7 * 24 * 60 * 60 * 1000
const MIN_PASSWORD = 8

const app = express()
if (process.env.TRUST_PROXY) app.set('trust proxy', 1)
app.use(express.json({ limit: '100kb' }))

const fail = (res, status, error) => res.status(status).json({ error })
const text = (v, max = 200) => String(v ?? '').trim().slice(0, max)

app.get('/api/health', (req, res) => res.json({ ok: true }))

// ---- Sessions ----

const sha256 = (s) => createHash('sha256').update(s).digest('hex')

function cookieToken(req) {
  const match = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie || '')
  return match ? match[1] : null
}

function setSessionCookie(req, res, token, maxAgeMs) {
  res.setHeader(
    'Set-Cookie',
    `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(maxAgeMs / 1000)}` +
      (req.secure ? '; Secure' : ''),
  )
}

async function startSession(req, res, employeeId) {
  const token = randomBytes(32).toString('hex')
  await run('DELETE FROM sessions WHERE expires_at < $1', [Date.now()])
  await run('INSERT INTO sessions (token_hash, employee_id, expires_at) VALUES ($1, $2, $3)', [
    sha256(token),
    employeeId,
    Date.now() + SESSION_MS,
  ])
  setSessionCookie(req, res, token, SESSION_MS)
}

async function auth(req, res, next) {
  const token = cookieToken(req)
  const row =
    token &&
    (await one(
      `SELECT e.id, e.is_admin FROM sessions s JOIN employees e ON e.id = s.employee_id
       WHERE s.token_hash = $1 AND s.expires_at > $2`,
      [sha256(token), Date.now()],
    ))
  if (!row) return fail(res, 401, 'Please sign in.')
  req.user = { id: row.id, isAdmin: row.is_admin }
  next()
}

const admin = (req, res, next) => (req.user.isAdmin ? next() : fail(res, 403, 'Admins only.'))

// Non-admins see who is away (for the calendar) but not other people's
// reasons, remarks or usernames.
async function stateFor(user) {
  const data = await loadData()
  const me = data.employees.find((e) => e.id === user.id)
  if (!user.isAdmin) {
    data.employees = data.employees.map(({ username, ...e }) => e)
    data.requests = data.requests.map((r) =>
      r.employeeId === user.id ? r : { ...r, reason: '', remark: '' },
    )
  }
  return { me, ...data }
}

// ---- Login ----

// Slow down password guessing: 10 failures per username per 15 minutes.
const failures = new Map()

function blocked(key) {
  const f = failures.get(key)
  return f && f.count >= 10 && f.reset > Date.now()
}

function recordFailure(key) {
  if (failures.size > 10000) failures.clear()
  const f = failures.get(key)
  if (!f || f.reset < Date.now()) failures.set(key, { count: 1, reset: Date.now() + 15 * 60e3 })
  else f.count++
}

// Verified against when the username does not exist, so both cases take equally long.
const dummyHash = hashPassword(randomBytes(8).toString('hex'))

app.post('/api/login', async (req, res) => {
  const username = text(req.body?.username, 64).toLowerCase()
  const password = String(req.body?.password ?? '')
  if (blocked(username)) return fail(res, 429, 'Too many attempts. Try again in 15 minutes.')

  const row = await one('SELECT id, is_admin, password_hash FROM employees WHERE username = $1', [
    username,
  ])
  if (!verifyPassword(password, row?.password_hash || dummyHash) || !row) {
    recordFailure(username)
    return fail(res, 401, 'Wrong username or password.')
  }
  failures.delete(username)
  await startSession(req, res, row.id)
  res.json(await stateFor({ id: row.id, isAdmin: row.is_admin }))
})

app.post('/api/logout', async (req, res) => {
  const token = cookieToken(req)
  if (token) await run('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)])
  setSessionCookie(req, res, '', 0)
  res.json({ ok: true })
})

app.use('/api', auth)

app.get('/api/state', async (req, res) => res.json(await stateFor(req.user)))

app.post('/api/password', async (req, res) => {
  const current = String(req.body?.current ?? '')
  const next = String(req.body?.next ?? '')
  const row = await one('SELECT password_hash FROM employees WHERE id = $1', [req.user.id])
  if (!verifyPassword(current, row.password_hash)) {
    return fail(res, 400, 'Current password is wrong.')
  }
  if (next.length < MIN_PASSWORD) {
    return fail(res, 400, `Password must be at least ${MIN_PASSWORD} characters.`)
  }
  await run('UPDATE employees SET password_hash = $1 WHERE id = $2', [
    hashPassword(next),
    req.user.id,
  ])
  // Sign out every other device.
  await run('DELETE FROM sessions WHERE employee_id = $1 AND token_hash != $2', [
    req.user.id,
    sha256(cookieToken(req)),
  ])
  res.json({ ok: true })
})

// ---- Leave requests ----

app.post('/api/requests', async (req, res) => {
  const body = req.body || {}
  const error = await transaction(async (client) => {
    // One request at a time per employee, so two simultaneous submissions
    // cannot both pass the balance / overlap check.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [req.user.id])
    const result = checkLeave(await loadData(client), req.user.id, body)
    if (result.error) return result.error
    await run(
      `INSERT INTO requests (id, employee_id, type_id, start_date, end_date, half_day, days, reason, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        randomUUID(),
        req.user.id,
        body.typeId,
        body.start,
        body.end,
        result.days === 0.5,
        result.days,
        text(body.reason, 500),
        todayISO(),
      ],
      client,
    )
  })
  if (error) return fail(res, 400, error)
  res.json({ ok: true })
})

app.post('/api/requests/:id/cancel', async (req, res) => {
  const r = await one('SELECT * FROM requests WHERE id = $1', [req.params.id])
  if (!r || r.employee_id !== req.user.id) return fail(res, 404, 'Request not found.')
  const allowed = r.status === 'pending' || (r.status === 'approved' && r.start_date > todayISO())
  if (!allowed) return fail(res, 409, 'This request can no longer be cancelled.')
  await run("UPDATE requests SET status = 'cancelled' WHERE id = $1", [r.id])
  res.json({ ok: true })
})

app.post('/api/requests/:id/review', admin, async (req, res) => {
  const status = req.body?.status
  if (!['approved', 'rejected'].includes(status)) return fail(res, 400, 'Invalid status.')
  const changes = await run(
    "UPDATE requests SET status = $1, remark = $2, reviewed_by = $3 WHERE id = $4 AND status = 'pending'",
    [status, text(req.body?.remark, 500), req.user.id, req.params.id],
  )
  if (!changes) return fail(res, 409, 'This request is no longer pending.')
  res.json({ ok: true })
})

// ---- Admin: settings ----

app.put('/api/settings', admin, async (req, res) => {
  const companyName = text(req.body?.companyName, 100)
  const weekendDays = req.body?.weekendDays
  if (!companyName) return fail(res, 400, 'Company name is required.')
  if (!Array.isArray(weekendDays) || weekendDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    return fail(res, 400, 'Invalid weekend days.')
  }
  const save = `INSERT INTO settings (key, value) VALUES ($1, $2)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
  await run(save, ['companyName', JSON.stringify(companyName)])
  await run(save, ['weekendDays', JSON.stringify([...new Set(weekendDays)])])
  res.json({ ok: true })
})

// ---- Admin: public holidays ----

function holidayFrom(body) {
  const name = text(body?.name, 100)
  if (!isISODate(body?.date)) return { error: 'Please enter a valid holiday date.' }
  if (!name) return { error: 'Holiday name is required.' }
  return { date: body.date, name, recurring: !!body.recurring }
}

app.post('/api/holidays', admin, async (req, res) => {
  const h = holidayFrom(req.body)
  if (h.error) return fail(res, 400, h.error)
  await run('INSERT INTO holidays (id, date, name, recurring) VALUES ($1, $2, $3, $4)', [
    randomUUID(),
    h.date,
    h.name,
    h.recurring,
  ])
  res.json({ ok: true })
})

app.put('/api/holidays/:id', admin, async (req, res) => {
  const h = holidayFrom(req.body)
  if (h.error) return fail(res, 400, h.error)
  await run('UPDATE holidays SET date = $1, name = $2, recurring = $3 WHERE id = $4', [
    h.date,
    h.name,
    h.recurring,
    req.params.id,
  ])
  res.json({ ok: true })
})

app.delete('/api/holidays/:id', admin, async (req, res) => {
  await run('DELETE FROM holidays WHERE id = $1', [req.params.id])
  res.json({ ok: true })
})

// ---- Admin: leave types ----

function leaveTypeFrom(body) {
  const name = text(body?.name, 100)
  const unlimited = body?.days === '' || body?.days == null
  const days = unlimited ? null : Number(body.days)
  if (!name) return { error: 'Leave type name is required.' }
  if (!unlimited && !(days >= 0 && days <= 366)) return { error: 'Days per year must be 0 or more.' }
  if (!/^#[0-9a-fA-F]{6}$/.test(body?.color)) return { error: 'Invalid colour.' }
  return { name, days, color: body.color }
}

app.post('/api/leave-types', admin, async (req, res) => {
  const t = leaveTypeFrom(req.body)
  if (t.error) return fail(res, 400, t.error)
  await run('INSERT INTO leave_types (id, name, days, color) VALUES ($1, $2, $3, $4)', [
    randomUUID(),
    t.name,
    t.days,
    t.color,
  ])
  res.json({ ok: true })
})

app.put('/api/leave-types/:id', admin, async (req, res) => {
  const t = leaveTypeFrom(req.body)
  if (t.error) return fail(res, 400, t.error)
  await run('UPDATE leave_types SET name = $1, days = $2, color = $3 WHERE id = $4', [
    t.name,
    t.days,
    t.color,
    req.params.id,
  ])
  res.json({ ok: true })
})

app.delete('/api/leave-types/:id', admin, async (req, res) => {
  const used = await one('SELECT 1 FROM requests WHERE type_id = $1 LIMIT 1', [req.params.id])
  if (used) {
    return fail(res, 409, 'This leave type is used by existing requests and cannot be deleted.')
  }
  await run('DELETE FROM leave_types WHERE id = $1', [req.params.id])
  res.json({ ok: true })
})

// ---- Admin: employees ----

function employeeFrom(body) {
  const name = text(body?.name, 100)
  const username = text(body?.username, 64).toLowerCase()
  if (!name) return { error: 'Employee name is required.' }
  if (!/^[a-z0-9._@-]+$/.test(username)) {
    return { error: 'Username may only contain letters, numbers and . _ @ -' }
  }
  return { name, username, department: text(body?.department, 100), isAdmin: !!body?.isAdmin }
}

const passwordError = (password) =>
  typeof password !== 'string' || password.length < MIN_PASSWORD
    ? `Password must be at least ${MIN_PASSWORD} characters.`
    : null

app.post('/api/employees', admin, async (req, res) => {
  const e = employeeFrom(req.body)
  const error = e.error || passwordError(req.body?.password)
  if (error) return fail(res, 400, error)
  await run(
    `INSERT INTO employees (id, username, name, department, is_admin, password_hash)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), e.username, e.name, e.department, e.isAdmin, hashPassword(req.body.password)],
  )
  res.json({ ok: true })
})

// Include `password` in the body to reset the employee's password.
app.put('/api/employees/:id', admin, async (req, res) => {
  const { id } = req.params
  const e = employeeFrom(req.body)
  const resetting = req.body?.password != null
  const error = e.error || (resetting && passwordError(req.body.password))
  if (error) return fail(res, 400, error)
  if (id === req.user.id && !e.isAdmin) {
    return fail(res, 400, 'You cannot remove your own admin rights.')
  }
  await run(
    'UPDATE employees SET username = $1, name = $2, department = $3, is_admin = $4 WHERE id = $5',
    [e.username, e.name, e.department, e.isAdmin, id],
  )
  if (resetting) {
    await run('UPDATE employees SET password_hash = $1 WHERE id = $2', [
      hashPassword(req.body.password),
      id,
    ])
    if (id !== req.user.id) await run('DELETE FROM sessions WHERE employee_id = $1', [id])
  }
  res.json({ ok: true })
})

app.delete('/api/employees/:id', admin, async (req, res) => {
  if (req.params.id === req.user.id) return fail(res, 400, 'You cannot delete your own account.')
  await run('DELETE FROM employees WHERE id = $1', [req.params.id]) // cascades to requests + sessions
  res.json({ ok: true })
})

app.use('/api', (req, res) => fail(res, 404, 'Not found.'))

// ---- Built frontend (after `npm run build`) ----

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist')
if (existsSync(dist)) app.use(express.static(dist))

app.use((err, req, res, next) => {
  // 23505 = Postgres unique violation; the only unique column users can hit is the username.
  if (err.code === '23505') return fail(res, 409, 'That username is already taken.')
  if (err.type === 'entity.parse.failed') return fail(res, 400, 'Invalid JSON.')
  console.error(err)
  fail(res, 500, 'Server error.')
})

await initDb()
app.listen(PORT, () => console.log(`Leave app server listening on port ${PORT}`))
