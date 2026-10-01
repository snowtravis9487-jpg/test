<script setup>
import { computed } from 'vue'
import {
  state,
  currentUser,
  balances,
  upcomingHolidays,
  leaveTypeById,
  cancelRequest,
} from '../store'
import { formatDate, todayISO } from '../dates'

defineEmits(['apply'])

const year = Number(todayISO().slice(0, 4))

const myBalances = computed(() => balances(currentUser.value.id, year))
const holidays = computed(() => upcomingHolidays(6))
const myRequests = computed(() =>
  state.requests
    .filter((r) => r.employeeId === currentUser.value.id)
    .sort((a, b) => b.start.localeCompare(a.start)),
)

const canCancel = (r) =>
  r.status === 'pending' || (r.status === 'approved' && r.start > todayISO())

function cancel(r) {
  if (confirm('Cancel this leave request?')) cancelRequest(r.id)
}
</script>

<template>
  <div class="page-head">
    <h2>Hello, {{ currentUser.name }}</h2>
    <button class="primary" @click="$emit('apply')">+ Apply Leave</button>
  </div>

  <section>
    <h3>Leave balance {{ year }}</h3>
    <div class="cards">
      <div
        v-for="b in myBalances"
        :key="b.type.id"
        class="card balance"
        :style="{ borderTopColor: b.type.color }"
      >
        <div class="label">{{ b.type.name }}</div>
        <div class="big">{{ b.unlimited ? '∞' : b.remaining }}</div>
        <div class="muted">
          <template v-if="b.unlimited">{{ b.used }} used</template>
          <template v-else>left of {{ b.type.days }} · {{ b.used }} used</template>
          <template v-if="b.pending"> · {{ b.pending }} pending</template>
        </div>
      </div>
    </div>
  </section>

  <div class="two-col">
    <section class="card">
      <h3>My requests</h3>
      <p v-if="!myRequests.length" class="muted">No leave requests yet.</p>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Dates</th>
              <th>Days</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in myRequests" :key="r.id">
              <td>{{ leaveTypeById(r.typeId)?.name || '(deleted type)' }}</td>
              <td>
                {{ formatDate(r.start) }}
                <template v-if="r.end !== r.start"> – {{ formatDate(r.end) }}</template>
                <div v-if="r.remark" class="muted">Remark: {{ r.remark }}</div>
              </td>
              <td>{{ r.days }}</td>
              <td><span class="status" :class="r.status">{{ r.status }}</span></td>
              <td>
                <button v-if="canCancel(r)" class="link danger" @click="cancel(r)">Cancel</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="card">
      <h3>Upcoming public holidays</h3>
      <p v-if="!holidays.length" class="muted">No upcoming holidays configured.</p>
      <ul class="holiday-list">
        <li v-for="h in holidays" :key="h.id + h.date">
          <strong>{{ h.name }}</strong>
          <span class="muted">{{ formatDate(h.date) }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>
