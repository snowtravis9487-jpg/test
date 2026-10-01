import { reactive, computed } from 'vue'
import { api } from './api'
import { todayISO } from './dates'
import * as rules from '../shared/leave.js'

// Mirror of the server data for the signed-in user. The server is the source
// of truth; the rule helpers below are only used for display and previews.
const empty = () => ({
  me: null,
  settings: { companyName: '', weekendDays: [] },
  leaveTypes: [],
  holidays: [],
  employees: [],
  requests: [],
})

export const state = reactive({ ready: false, ...empty() })

export const currentUser = computed(() => state.me)

export const employeeById = (id) => state.employees.find((e) => e.id === id)
export const leaveTypeById = (id) => state.leaveTypes.find((t) => t.id === id)
export const isUnlimited = rules.isUnlimited

// ---- Session ----

export async function refresh() {
  try {
    Object.assign(state, await api.get('/state'))
  } catch (err) {
    if (err.status !== 401) throw err
    Object.assign(state, empty())
  }
}

export async function init() {
  try {
    await refresh()
  } finally {
    state.ready = true
  }
}

// Returns an error message, or null on success.
export async function login(username, password) {
  try {
    Object.assign(state, await api.post('/login', { username, password }))
    return null
  } catch (err) {
    return err.message
  }
}

export async function logout() {
  await api.post('/logout').catch(() => {})
  Object.assign(state, empty())
}

export async function changePassword(current, next) {
  try {
    await api.post('/password', { current, next })
    return null
  } catch (err) {
    return err.message
  }
}

// Runs a server change; on failure shows the error and reloads so the screen
// matches the server again. Returns true on success.
async function mutate(action, { reload = true } = {}) {
  try {
    await action()
    if (reload) await refresh()
    return true
  } catch (err) {
    alert(err.message)
    await refresh().catch(() => {})
    return false
  }
}

// ---- Holidays & working days ----

export const holidayOn = (iso) => rules.holidayOn(state.holidays, iso)
export const isWeekend = (iso) => rules.isWeekend(state.settings, iso)

export function holidaysForYear(year) {
  return state.holidays
    .map((h) => (h.recurring ? { ...h, date: `${year}-${h.date.slice(5)}` } : h))
    .filter((h) => h.date.startsWith(`${year}-`))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export function upcomingHolidays(limit = 5) {
  const today = todayISO()
  const year = Number(today.slice(0, 4))
  return [...holidaysForYear(year), ...holidaysForYear(year + 1)]
    .filter((h) => h.date >= today)
    .slice(0, limit)
}

export const countLeaveDays = (start, end, halfDay) =>
  rules.countLeaveDays(state, start, end, halfDay)

// ---- Balances ----

export const usedDays = (employeeId, typeId, year, statuses) =>
  rules.usedDays(state.requests, employeeId, typeId, year, statuses)

export function balances(employeeId, year) {
  return state.leaveTypes.map((type) => {
    const used = usedDays(employeeId, type.id, year, ['approved'])
    const pending = usedDays(employeeId, type.id, year, ['pending'])
    const unlimited = isUnlimited(type)
    return {
      type,
      used,
      pending,
      unlimited,
      remaining: unlimited ? null : type.days - used - pending,
    }
  })
}

// ---- Requests ----

// Returns an error message, or null when the request was created.
export async function applyLeave({ typeId, start, end, halfDay, reason }) {
  try {
    await api.post('/requests', { typeId, start, end, halfDay, reason })
    await refresh()
    return null
  } catch (err) {
    return err.message
  }
}

export const reviewRequest = (id, status, remark = '') =>
  mutate(() => api.post(`/requests/${id}/review`, { status, remark }))

export const cancelRequest = (id) => mutate(() => api.post(`/requests/${id}/cancel`))

// ---- Admin settings ----
// `kind` is 'holidays', 'leave-types' or 'employees'.

export const saveSettings = () =>
  mutate(() => api.put('/settings', state.settings), { reload: false })

export const createItem = (kind, item) => mutate(() => api.post(`/${kind}`, item))

// No reload on success: the row on screen already holds the new values, and a
// reload could overwrite another field the admin has started typing in.
export const saveItem = (kind, item) =>
  mutate(() => api.put(`/${kind}/${item.id}`, item), { reload: false })

export const removeItem = (kind, id) => mutate(() => api.delete(`/${kind}/${id}`))
