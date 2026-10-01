<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { state, currentUser, init, logout } from './store'
import Login from './components/Login.vue'
import Dashboard from './components/Dashboard.vue'
import ApplyLeave from './components/ApplyLeave.vue'
import CalendarView from './components/CalendarView.vue'
import Approvals from './components/Approvals.vue'
import Settings from './components/Settings.vue'
import Account from './components/Account.vue'

const view = ref('dashboard')

onMounted(init)

const pendingCount = computed(() => state.requests.filter((r) => r.status === 'pending').length)

const tabs = computed(() => [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'apply', label: 'Apply Leave' },
  { id: 'calendar', label: 'Calendar' },
  ...(currentUser.value?.isAdmin
    ? [
        { id: 'approvals', label: 'Approvals', badge: pendingCount.value },
        { id: 'settings', label: 'Settings' },
      ]
    : []),
  { id: 'account', label: 'Account' },
])

// Signing in as someone else must not land on a page they cannot see.
watch(
  () => state.me?.id,
  () => (view.value = 'dashboard'),
)
</script>

<template>
  <template v-if="!state.ready"></template>
  <Login v-else-if="!state.me" />
  <template v-else>
    <header class="topbar">
      <h1>{{ state.settings.companyName }} <span>Leave</span></h1>
      <nav>
        <button
          v-for="t in tabs"
          :key="t.id"
          :class="{ active: view === t.id }"
          @click="view = t.id"
        >
          {{ t.label }}
          <span v-if="t.badge" class="badge">{{ t.badge }}</span>
        </button>
      </nav>
      <div class="user-switch">
        {{ currentUser.name }}
        <button @click="logout">Sign out</button>
      </div>
    </header>

    <main>
      <Dashboard v-if="view === 'dashboard'" @apply="view = 'apply'" />
      <ApplyLeave v-else-if="view === 'apply'" @done="view = 'dashboard'" />
      <CalendarView v-else-if="view === 'calendar'" />
      <Approvals v-else-if="view === 'approvals'" />
      <Settings v-else-if="view === 'settings'" />
      <Account v-else-if="view === 'account'" />
    </main>
  </template>
</template>
