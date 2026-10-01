<script setup>
import { reactive, computed } from 'vue'
import { state, employeeById, leaveTypeById, reviewRequest } from '../store'
import { formatDate } from '../dates'

const remarks = reactive({})

const pending = computed(() =>
  state.requests.filter((r) => r.status === 'pending').sort((a, b) => a.start.localeCompare(b.start)),
)
const history = computed(() =>
  state.requests
    .filter((r) => r.status !== 'pending')
    .sort((a, b) => b.start.localeCompare(a.start)),
)

function review(r, status) {
  reviewRequest(r.id, status, remarks[r.id] || '')
  delete remarks[r.id]
}
</script>

<template>
  <h2>Approvals</h2>

  <section class="card">
    <h3>Pending ({{ pending.length }})</h3>
    <p v-if="!pending.length" class="muted">Nothing waiting for approval.</p>
    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Employee</th>
            <th>Type</th>
            <th>Dates</th>
            <th>Days</th>
            <th>Reason</th>
            <th>Remark</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in pending" :key="r.id">
            <td>
              {{ employeeById(r.employeeId)?.name }}
              <div class="muted">{{ employeeById(r.employeeId)?.department }}</div>
            </td>
            <td>{{ leaveTypeById(r.typeId)?.name || '(deleted type)' }}</td>
            <td>
              {{ formatDate(r.start) }}
              <template v-if="r.end !== r.start"> – {{ formatDate(r.end) }}</template>
            </td>
            <td>{{ r.days }}</td>
            <td>{{ r.reason || '—' }}</td>
            <td><input v-model="remarks[r.id]" placeholder="Optional" /></td>
            <td class="nowrap">
              <button class="primary" @click="review(r, 'approved')">Approve</button>
              <button class="danger" @click="review(r, 'rejected')">Reject</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <section class="card">
    <h3>History</h3>
    <p v-if="!history.length" class="muted">No reviewed requests yet.</p>
    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Employee</th>
            <th>Type</th>
            <th>Dates</th>
            <th>Days</th>
            <th>Status</th>
            <th>Reviewed by</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in history" :key="r.id">
            <td>{{ employeeById(r.employeeId)?.name }}</td>
            <td>{{ leaveTypeById(r.typeId)?.name || '(deleted type)' }}</td>
            <td>
              {{ formatDate(r.start) }}
              <template v-if="r.end !== r.start"> – {{ formatDate(r.end) }}</template>
            </td>
            <td>{{ r.days }}</td>
            <td>
              <span class="status" :class="r.status">{{ r.status }}</span>
              <div v-if="r.remark" class="muted">{{ r.remark }}</div>
            </td>
            <td>{{ employeeById(r.reviewedBy)?.name || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
