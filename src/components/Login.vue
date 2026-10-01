<script setup>
import { reactive, ref } from 'vue'
import { login } from '../store'

const form = reactive({ username: '', password: '' })
const error = ref('')
const busy = ref(false)

async function submit() {
  busy.value = true
  error.value = (await login(form.username, form.password)) || ''
  busy.value = false
}
</script>

<template>
  <div class="login">
    <form class="card form" @submit.prevent="submit">
      <h2>Leave Application</h2>
      <label>
        Username
        <input v-model="form.username" autocomplete="username" required autofocus />
      </label>
      <label>
        Password
        <input
          v-model="form.password"
          type="password"
          autocomplete="current-password"
          required
        />
      </label>
      <p v-if="error" class="error">{{ error }}</p>
      <button type="submit" class="primary" :disabled="busy">Sign in</button>
    </form>
  </div>
</template>
