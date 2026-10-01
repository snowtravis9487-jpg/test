<script setup>
import { reactive, ref, computed, watch } from 'vue'
import {
  state,
  currentUser,
  applyLeave,
  countLeaveDays,
  leaveTypeById,
  isUnlimited,
  usedDays,
  holidayOn,
} from '../store'
import { eachDay, formatDate, todayISO } from '../dates'

const emit = defineEmits(['done'])

const form = reactive({
  typeId: state.leaveTypes[0]?.id || '',
  start: todayISO(),
  end: todayISO(),
  halfDay: false,
  reason: '',
})
const error = ref('')

watch(
  () => form.start,
  (start) => {
    if (form.end < start) form.end = start
  },
)

const singleDay = computed(() => form.start === form.end)
watch(singleDay, (single) => {
  if (!single) form.halfDay = false
})

const days = computed(() => countLeaveDays(form.start, form.end, form.halfDay))

const remaining = computed(() => {
  const type = leaveTypeById(form.typeId)
  if (!type || isUnlimited(type) || !form.start) return null
  return type.days - usedDays(currentUser.value.id, type.id, Number(form.start.slice(0, 4)))
})

const holidaysInRange = computed(() => {
  if (!form.start || !form.end || form.end < form.start) return []
  return eachDay(form.start, form.end)
    .map((d) => ({ date: d, holiday: holidayOn(d) }))
    .filter((x) => x.holiday)
})

async function submit() {
  error.value = (await applyLeave(form)) || ''
  if (!error.value) emit('done')
}
</script>

<template>
  <h2>Apply Leave</h2>
  <form class="card form" @submit.prevent="submit">
    <label>
      Leave type
      <select v-model="form.typeId" required>
        <option v-for="t in state.leaveTypes" :key="t.id" :value="t.id">{{ t.name }}</option>
      </select>
    </label>

    <div class="row">
      <label>
        From
        <input v-model="form.start" type="date" required />
      </label>
      <label>
        To
        <input v-model="form.end" type="date" :min="form.start" required />
      </label>
    </div>

    <label class="check" :class="{ disabled: !singleDay }">
      <input v-model="form.halfDay" type="checkbox" :disabled="!singleDay" />
      Half day (single-day leave only)
    </label>

    <label>
      Reason
      <textarea v-model="form.reason" rows="3" placeholder="Optional"></textarea>
    </label>

    <div class="summary">
      <div>
        <strong>{{ days }}</strong> working day(s) will be deducted
        <span v-if="remaining !== null" class="muted">· {{ remaining }} day(s) available</span>
      </div>
      <div class="muted">Weekends and public holidays are not counted.</div>
      <ul v-if="holidaysInRange.length">
        <li v-for="h in holidaysInRange" :key="h.date">
          {{ formatDate(h.date) }} — {{ h.holiday.name }} (public holiday)
        </li>
      </ul>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <div class="actions">
      <button type="submit" class="primary">Submit request</button>
      <button type="button" @click="emit('done')">Cancel</button>
    </div>
  </form>
</template>
