<script setup>
import { reactive, ref, computed } from 'vue'
import { state, saveSettings, createItem, saveItem, removeItem } from '../store'
import { todayISO, WEEKDAYS, formatDate } from '../dates'

// Applies a change to a row and saves that row to the server.
function update(kind, item, patch = {}) {
  Object.assign(item, patch)
  saveItem(kind, item)
}

// ---- General ----
function toggleWeekend(day) {
  const days = state.settings.weekendDays
  state.settings.weekendDays = days.includes(day) ? days.filter((d) => d !== day) : [...days, day]
  saveSettings()
}

// ---- Public holidays ----
const holidayYear = ref(Number(todayISO().slice(0, 4)))
const newHoliday = reactive({ date: '', name: '', recurring: false })

const visibleHolidays = computed(() =>
  state.holidays
    .filter((h) => h.recurring || h.date.startsWith(`${holidayYear.value}-`))
    .sort((a, b) => a.date.slice(5).localeCompare(b.date.slice(5))),
)

async function addHoliday() {
  if (!(await createItem('holidays', newHoliday))) return
  holidayYear.value = Number(newHoliday.date.slice(0, 4))
  Object.assign(newHoliday, { date: '', name: '', recurring: false })
}

// ---- Leave types ----
const addLeaveType = () =>
  createItem('leave-types', { name: 'New Leave Type', days: 0, color: '#059669' })

// ---- Employees ----
const newEmployee = reactive({ name: '', username: '', department: '', password: '' })

async function addEmployee() {
  if (!(await createItem('employees', { ...newEmployee, isAdmin: false }))) return
  Object.assign(newEmployee, { name: '', username: '', department: '', password: '' })
}

function resetPassword(e) {
  const password = prompt(`New password for ${e.name} (at least 8 characters):`)
  if (password) saveItem('employees', { ...e, password })
}

function removeEmployee(e) {
  if (confirm(`Delete ${e.name} and all of their leave requests?`)) removeItem('employees', e.id)
}

// The signed-in admin cannot delete themselves or drop their own admin rights.
const isSelf = (e) => e.id === state.me.id
</script>

<template>
  <h2>Settings</h2>
  <p class="muted">Changes are saved automatically.</p>

  <section class="card">
    <h3>General</h3>
    <div class="form">
      <label>
        Company name
        <input v-model="state.settings.companyName" @change="saveSettings" />
      </label>
      <div>
        Weekend / rest days
        <div class="weekdays">
          <label v-for="(name, i) in WEEKDAYS" :key="i" class="check">
            <input
              type="checkbox"
              :checked="state.settings.weekendDays.includes(i)"
              @change="toggleWeekend(i)"
            />
            {{ name }}
          </label>
        </div>
      </div>
    </div>
  </section>

  <section class="card">
    <div class="page-head">
      <h3>Public holidays</h3>
      <div class="actions">
        <button @click="holidayYear--">‹</button>
        <strong>{{ holidayYear }}</strong>
        <button @click="holidayYear++">›</button>
      </div>
    </div>
    <p class="muted">
      "Every year" holidays repeat on the same date. Others (e.g. Chinese New Year, Hari Raya)
      apply only to the year of their date and must be added again each year.
    </p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Name</th>
            <th>Every year</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="h in visibleHolidays" :key="h.id">
            <td>
              <input
                type="date"
                :value="h.date"
                @change="update('holidays', h, { date: $event.target.value })"
              />
              <div class="muted">{{ h.date ? formatDate(h.date).slice(0, 3) : '' }}</div>
            </td>
            <td><input v-model="h.name" @change="update('holidays', h)" /></td>
            <td>
              <input
                type="checkbox"
                :checked="h.recurring"
                @change="update('holidays', h, { recurring: $event.target.checked })"
              />
            </td>
            <td>
              <button class="link danger" @click="removeItem('holidays', h.id)">Delete</button>
            </td>
          </tr>
          <tr v-if="!visibleHolidays.length">
            <td colspan="4" class="muted">No holidays for {{ holidayYear }}.</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td><input v-model="newHoliday.date" type="date" /></td>
            <td>
              <input
                v-model="newHoliday.name"
                placeholder="Holiday name"
                @keyup.enter="addHoliday"
              />
            </td>
            <td><input v-model="newHoliday.recurring" type="checkbox" /></td>
            <td><button class="primary" @click="addHoliday">Add</button></td>
          </tr>
        </tfoot>
      </table>
    </div>
  </section>

  <section class="card">
    <div class="page-head">
      <h3>Leave types</h3>
      <button @click="addLeaveType">+ Add type</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Days per year</th>
            <th>Colour</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in state.leaveTypes" :key="t.id">
            <td><input v-model="t.name" @change="update('leave-types', t)" /></td>
            <td>
              <input
                v-model.number="t.days"
                type="number"
                min="0"
                step="0.5"
                placeholder="Unlimited"
                @change="update('leave-types', t)"
              />
            </td>
            <td><input v-model="t.color" type="color" @change="update('leave-types', t)" /></td>
            <td>
              <button class="link danger" @click="removeItem('leave-types', t.id)">Delete</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="muted">Leave "Days per year" empty for unlimited (e.g. unpaid leave).</p>
  </section>

  <section class="card">
    <h3>Employees</h3>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Username</th>
            <th>Department</th>
            <th>Admin</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in state.employees" :key="e.id">
            <td><input v-model="e.name" @change="update('employees', e)" /></td>
            <td><input v-model="e.username" @change="update('employees', e)" /></td>
            <td><input v-model="e.department" @change="update('employees', e)" /></td>
            <td>
              <input
                type="checkbox"
                :checked="e.isAdmin"
                :disabled="isSelf(e)"
                @change="update('employees', e, { isAdmin: $event.target.checked })"
              />
            </td>
            <td class="nowrap">
              <button class="link" @click="resetPassword(e)">Reset password</button>
              <button v-if="!isSelf(e)" class="link danger" @click="removeEmployee(e)">
                Delete
              </button>
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td><input v-model="newEmployee.name" placeholder="Name" /></td>
            <td><input v-model="newEmployee.username" placeholder="Username" /></td>
            <td><input v-model="newEmployee.department" placeholder="Department" /></td>
            <td colspan="2" class="nowrap">
              <input
                v-model="newEmployee.password"
                type="password"
                autocomplete="new-password"
                placeholder="Initial password"
              />
              <button class="primary" @click="addEmployee">Add</button>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
    <p class="muted">Admins can approve requests and change these settings.</p>
  </section>
</template>
