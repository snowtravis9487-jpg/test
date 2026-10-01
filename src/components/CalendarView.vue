<script setup>
import { ref, computed } from 'vue'
import { state, holidayOn, isWeekend, employeeById, leaveTypeById } from '../store'
import { toISO, todayISO, WEEKDAYS } from '../dates'

const now = new Date()
const year = ref(now.getFullYear())
const month = ref(now.getMonth())
const today = todayISO()

// Week starts on Monday.
const headers = [1, 2, 3, 4, 5, 6, 0].map((d) => WEEKDAYS[d])

const title = computed(() =>
  new Date(year.value, month.value, 1).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
  }),
)

function leavesOn(iso) {
  return state.requests
    .filter((r) => ['pending', 'approved'].includes(r.status) && r.start <= iso && r.end >= iso)
    .map((r) => ({
      id: r.id,
      name: employeeById(r.employeeId)?.name || 'Unknown',
      color: leaveTypeById(r.typeId)?.color || '#6b7280',
      type: leaveTypeById(r.typeId)?.name || '',
      pending: r.status === 'pending',
      halfDay: r.halfDay,
    }))
}

const cells = computed(() => {
  const first = new Date(year.value, month.value, 1)
  const blanks = (first.getDay() + 6) % 7
  const count = new Date(year.value, month.value + 1, 0).getDate()
  const out = Array.from({ length: blanks }, () => null)
  for (let d = 1; d <= count; d++) {
    const iso = toISO(new Date(year.value, month.value, d))
    const holiday = holidayOn(iso)
    const weekend = isWeekend(iso)
    out.push({
      iso,
      day: d,
      holiday,
      weekend,
      leaves: holiday || weekend ? [] : leavesOn(iso),
    })
  }
  return out
})

function shift(delta) {
  const d = new Date(year.value, month.value + delta, 1)
  year.value = d.getFullYear()
  month.value = d.getMonth()
}

function goToday() {
  year.value = now.getFullYear()
  month.value = now.getMonth()
}
</script>

<template>
  <div class="page-head">
    <h2>{{ title }}</h2>
    <div class="actions">
      <button @click="shift(-1)">‹ Prev</button>
      <button @click="goToday">Today</button>
      <button @click="shift(1)">Next ›</button>
    </div>
  </div>

  <div class="legend">
    <span><i class="dot holiday"></i> Public holiday</span>
    <span v-for="t in state.leaveTypes" :key="t.id">
      <i class="dot" :style="{ background: t.color }"></i> {{ t.name }}
    </span>
    <span><i class="dot pending"></i> Pending approval</span>
  </div>

  <div class="calendar card">
    <div v-for="h in headers" :key="h" class="cal-head">{{ h }}</div>
    <div
      v-for="(c, i) in cells"
      :key="i"
      class="cal-cell"
      :class="c && { weekend: c.weekend, holiday: c.holiday, today: c.iso === today }"
    >
      <template v-if="c">
        <div class="cal-day">{{ c.day }}</div>
        <div v-if="c.holiday" class="cal-holiday">{{ c.holiday.name }}</div>
        <div
          v-for="l in c.leaves"
          :key="l.id"
          class="chip"
          :class="{ pending: l.pending }"
          :style="{ '--chip': l.color }"
          :title="`${l.name} — ${l.type}${l.pending ? ' (pending)' : ''}`"
        >
          {{ l.name }}{{ l.halfDay ? ' (½)' : '' }}
        </div>
      </template>
    </div>
  </div>
</template>
