<script setup>
import { reactive, ref } from 'vue'
import { currentUser, changePassword } from '../store'

const form = reactive({ current: '', next: '', confirm: '' })
const error = ref('')
const done = ref(false)

async function submit() {
  done.value = false
  if (form.next !== form.confirm) {
    error.value = 'The new passwords do not match.'
    return
  }
  error.value = (await changePassword(form.current, form.next)) || ''
  if (!error.value) {
    Object.assign(form, { current: '', next: '', confirm: '' })
    done.value = true
  }
}
</script>

<template>
  <h2>Account</h2>
  <section class="card">
    <h3>{{ currentUser.name }}</h3>
    <p class="muted">
      Username: {{ currentUser.username }}
      <template v-if="currentUser.department"> · {{ currentUser.department }}</template>
      <template v-if="currentUser.isAdmin"> · Admin</template>
    </p>
  </section>

  <form class="card form" @submit.prevent="submit">
    <h3>Change password</h3>
    <label>
      Current password
      <input v-model="form.current" type="password" autocomplete="current-password" required />
    </label>
    <label>
      New password (at least 8 characters)
      <input
        v-model="form.next"
        type="password"
        autocomplete="new-password"
        minlength="8"
        required
      />
    </label>
    <label>
      Confirm new password
      <input v-model="form.confirm" type="password" autocomplete="new-password" required />
    </label>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="done" class="success">Password changed.</p>
    <div class="actions">
      <button type="submit" class="primary">Change password</button>
    </div>
  </form>
</template>
