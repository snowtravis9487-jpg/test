// Dates are kept as 'YYYY-MM-DD' strings everywhere to avoid timezone drift.

const pad = (n) => String(n).padStart(2, '0')

export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export const parseISO = (s) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const todayISO = () => toISO(new Date())

export function eachDay(start, end) {
  const out = []
  const d = parseISO(start)
  const last = parseISO(end)
  while (d <= last) {
    out.push(toISO(d))
    d.setDate(d.getDate() + 1)
  }
  return out
}

export const formatDate = (s) =>
  parseISO(s).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
