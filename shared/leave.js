// Leave rules shared by the browser (for previews) and the server (the authority).
// `data` is { settings, leaveTypes, holidays, requests }.

import { eachDay, parseISO, toISO } from './dates.js'

export const ACTIVE = ['pending', 'approved']

export const isISODate = (s) =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && toISO(parseISO(s)) === s

export const isUnlimited = (type) => type.days === '' || type.days == null

export const holidayOn = (holidays, iso) =>
  holidays.find((h) => (h.recurring ? h.date.slice(5) === iso.slice(5) : h.date === iso))

export const isWeekend = (settings, iso) => settings.weekendDays.includes(parseISO(iso).getDay())

export const workingDays = (data, start, end) =>
  eachDay(start, end).filter((d) => !isWeekend(data.settings, d) && !holidayOn(data.holidays, d))

export function countLeaveDays(data, start, end, halfDay) {
  if (!start || !end || end < start) return 0
  const n = workingDays(data, start, end).length
  return halfDay && n === 1 ? 0.5 : n
}

// A request counts against the year of its start date.
export function usedDays(requests, employeeId, typeId, year, statuses = ACTIVE) {
  return requests
    .filter(
      (r) =>
        r.employeeId === employeeId &&
        r.typeId === typeId &&
        statuses.includes(r.status) &&
        r.start.startsWith(`${year}-`),
    )
    .reduce((sum, r) => sum + r.days, 0)
}

// Returns { error } or { days } for a new request.
export function checkLeave(data, employeeId, { typeId, start, end, halfDay }) {
  const type = data.leaveTypes.find((t) => t.id === typeId)
  if (!type) return { error: 'Please choose a leave type.' }
  if (!isISODate(start) || !isISODate(end)) {
    return { error: 'Please choose the start and end date.' }
  }
  if (end < start) return { error: 'End date cannot be before start date.' }
  if ((parseISO(end) - parseISO(start)) / 864e5 > 366) {
    return { error: 'A single request cannot be longer than one year.' }
  }

  const days = countLeaveDays(data, start, end, halfDay)
  if (days === 0) return { error: 'The selected dates contain no working days.' }

  const overlap = data.requests.some(
    (r) =>
      r.employeeId === employeeId && ACTIVE.includes(r.status) && r.start <= end && r.end >= start,
  )
  if (overlap) return { error: 'You already have a leave request covering these dates.' }

  if (!isUnlimited(type)) {
    const year = Number(start.slice(0, 4))
    const remaining = type.days - usedDays(data.requests, employeeId, type.id, year)
    if (days > remaining) {
      return {
        error: `Not enough ${type.name} balance: ${remaining} day(s) left, ${days} requested.`,
      }
    }
  }
  return { days }
}
