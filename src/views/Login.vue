<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { NButton, NCard, NInput, NSpace, NText, NAlert } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { OpenClawWebSocket } from '@/api/websocket'
import ConnectionDiagnostics from '@/components/common/ConnectionDiagnostics.vue'
import { diagnoseConnection } from '@/utils/connection-diagnostics'

const SCENES = ['local', 'lan', 'public'] as const

type LoginScene = typeof SCENES[number]

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const { t } = useI18n()

const token = ref(authStore.token)
const gatewayUrl = ref(authStore.gatewayUrl)
const loading = ref(false)
const error = ref('')
const selectedScene = ref<LoginScene>(inferSceneFromUrl(authStore.gatewayUrl))

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.replace(/\[|\]/g, '').toLowerCase()
  return normalized === 'localhost' || normalized === '::1' || /^127\./.test(normalized)
}

function inferSceneFromUrl(url: string): LoginScene {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'wss:') return 'public'
    if (isLoopbackHost(parsed.hostname)) return 'local'
    return 'lan'
  } catch {
    return 'local'
  }
}

const isHttpsPage = computed(() => {
  if (typeof window === 'undefined') return false
  return window.location.protocol === 'https:'
})

const isSecureContextPage = computed(() => {
  if (typeof window === 'undefined') return true
  return window.isSecureContext
})

const recommendedGatewayUrl = computed(() =>
  t(`pages.login.scenes.${selectedScene.value}.recommendedUrl`)
)

const sceneCards = computed(() =>
  SCENES.map((scene) => ({
    key: scene,
    title: t(`pages.login.scenes.${scene}.title`),
    description: t(`pages.login.scenes.${scene}.description`),
    recommendedUrl: t(`pages.login.scenes.${scene}.recommendedUrl`),
    tip: t(`pages.login.scenes.${scene}.tip`),
  }))
)

const preflightDiagnostics = computed(() =>
  diagnoseConnection(
    {
      gatewayUrl: gatewayUrl.value,
      pageProtocol: isHttpsPage.value ? 'https:' : 'http:',
      pageOrigin: typeof window !== 'undefined' ? window.location.origin : '',
      isSecureContext: isSecureContextPage.value,
    },
    t,
  )
)

const failureDiagnostics = computed(() =>
  error.value
    ? diagnoseConnection(
        {
          gatewayUrl: gatewayUrl.value,
          errorMessage: error.value,
          pageProtocol: isHttpsPage.value ? 'https:' : 'http:',
          pageOrigin: typeof window !== 'undefined' ? window.location.origin : '',
          isSecureContext: isSecureContextPage.value,
        },
        t,
      )
    : []
)

const visibleDiagnostics = computed(() =>
  failureDiagnostics.value.length ? failureDiagnostics.value : preflightDiagnostics.value
)

const diagnosticsTitle = computed(() =>
  error.value ? t('pages.login.failureTitle') : t('pages.login.preflightTitle')
)

const selectedSceneTip = computed(() => t(`pages.login.scenes.${selectedScene.value}.tip`))

function selectScene(scene: LoginScene): void {
  selectedScene.value = scene
  gatewayUrl.value = t(`pages.login.scenes.${scene}.recommendedUrl`)
  error.value = ''
}

function validateBeforeConnect(): string {
  if (!gatewayUrl.value.trim()) return t('pages.login.inputGatewayUrlRequired')
  if (!token.value.trim()) return t('pages.login.inputTokenRequired')

  const blocking = preflightDiagnostics.value.find((item) =>
    item.code === 'invalid-scheme' || item.code === 'https-ws-blocked'
  )

  return blocking?.summary || ''
}

async function handleLogin() {
  const validationError = validateBeforeConnect()
  if (validationError) {
    error.value = validationError
    return
  }

  const normalizedGatewayUrl = gatewayUrl.value.trim()
  const normalizedToken = token.value.trim()

  loading.value = true
  error.value = ''

  try {
    const probe = new OpenClawWebSocket({
      reconnect: false,
      maxReconnectAttempts: 0,
    })

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        probe.disconnect()
        reject(new Error(t('pages.login.connectTimeout')))
      }, 8000)

      const cleanup = () => {
        clearTimeout(timer)
        offConnected()
        offFailed()
        offDisconnected()
        probe.disconnect()
      }

      const offConnected = probe.on('connected', () => {
        if (settled) return
        settled = true
        cleanup()
        resolve()
      })

      const offFailed = probe.on('failed', (reason: unknown) => {
        if (settled) return
        settled = true
        cleanup()
        reject(new Error(String(reason || t('pages.login.tokenInvalid'))))
      })

      const offDisconnected = probe.on('disconnected', (code: unknown, reason: unknown) => {
        if (settled) return
        settled = true
        cleanup()
        const message =
          typeof reason === 'string' && reason.trim()
            ? reason
            : t('pages.login.connectionClosedWithCode', { code: String(code) })
        reject(new Error(message))
      })

      probe.connect(normalizedGatewayUrl, normalizedToken)
    })

    authStore.setToken(normalizedToken)
    authStore.setGatewayUrl(normalizedGatewayUrl)
    token.value = normalizedToken
    gatewayUrl.value = normalizedGatewayUrl

    const redirect = (route.query.redirect as string) || '/'
    router.push(redirect)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <NCard class="login-card" :bordered="true">
      <div class="login-header">
        <span class="login-logo">🦞</span>
        <NText strong class="login-title">
          OpenClaw Admin
        </NText>
        <NText depth="3" class="login-subtitle">
          {{ t('pages.login.subtitle') }}
        </NText>
      </div>

      <NSpace vertical :size="18">
        <div class="assistant-panel">
          <div class="assistant-panel__header">
            <NText strong>{{ t('pages.login.assistantTitle') }}</NText>
            <NText depth="3">{{ t('pages.login.assistantDescription') }}</NText>
          </div>

          <div class="scene-grid">
            <button
              v-for="scene in sceneCards"
              :key="scene.key"
              type="button"
              class="scene-card"
              :class="{ 'scene-card--active': scene.key === selectedScene }"
              @click="selectScene(scene.key)"
            >
              <div class="scene-card__title">{{ scene.title }}</div>
              <div class="scene-card__desc">{{ scene.description }}</div>
              <div class="scene-card__url">{{ scene.recommendedUrl }}</div>
            </button>
          </div>

          <NAlert type="info" :bordered="false">
            {{ t('pages.login.gatewayHint') }}
          </NAlert>

          <NAlert type="default" :bordered="false">
            {{ selectedSceneTip }}
          </NAlert>
        </div>

        <div>
          <NText depth="3" class="field-label">
            {{ t('pages.login.gatewayUrlLabel') }}
          </NText>
          <div class="field-row">
            <NInput
              v-model:value="gatewayUrl"
              :placeholder="t('pages.login.gatewayUrlPlaceholder')"
              :disabled="loading"
              @keydown.enter="handleLogin"
            />
            <NButton secondary :disabled="loading" @click="gatewayUrl = recommendedGatewayUrl">
              {{ t('pages.login.useRecommended') }}
            </NButton>
          </div>
        </div>

        <div>
          <NText depth="3" class="field-label">
            {{ t('pages.login.tokenLabel') }}
          </NText>
          <NInput
            v-model:value="token"
            type="password"
            show-password-on="click"
            :placeholder="t('pages.login.tokenPlaceholder')"
            :disabled="loading"
            @keydown.enter="handleLogin"
          />
          <NText depth="3" class="token-hint">
            {{ t('pages.login.tokenHintPrefix') }}
            <code class="token-command">openclaw config get gateway.auth.token</code>
            {{ t('pages.login.tokenHintSuffix') }}
          </NText>
        </div>

        <NAlert v-if="error" type="error" :bordered="false">
          {{ error }}
        </NAlert>

        <ConnectionDiagnostics
          :diagnostics="visibleDiagnostics"
          :title="visibleDiagnostics.length ? diagnosticsTitle : undefined"
        />

        <NButton
          type="primary"
          block
          :loading="loading"
          size="large"
          class="login-submit"
          @click="handleLogin"
        >
          {{ t('pages.login.connect') }}
        </NButton>
      </NSpace>
    </NCard>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-secondary);
  padding: 20px;
}

.login-card {
  max-width: 720px;
  width: 100%;
  border-radius: var(--radius-lg);
}

.login-header {
  text-align: center;
  margin-bottom: 28px;
}

.login-logo {
  font-size: 48px;
  display: block;
  margin-bottom: 12px;
}

.login-title {
  font-size: 24px;
  letter-spacing: -0.5px;
}

.login-subtitle {
  margin-top: 8px;
  display: block;
  font-size: 14px;
}

.assistant-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(42, 127, 255, 0.06), rgba(24, 160, 88, 0.04));
}

.assistant-panel__header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.scene-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.scene-card {
  width: 100%;
  text-align: left;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-primary);
  color: var(--text-primary);
  padding: 12px;
  cursor: pointer;
  transition: border-color 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease;
}

.scene-card:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}

.scene-card--active {
  border-color: #2a7fff;
  box-shadow: 0 0 0 1px rgba(42, 127, 255, 0.12);
}

.scene-card__title {
  font-size: 14px;
  font-weight: 700;
}

.scene-card__desc {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
}

.scene-card__url {
  margin-top: 10px;
  font-size: 12px;
  color: #2a7fff;
  word-break: break-word;
}

.field-label {
  font-size: 13px;
  margin-bottom: 6px;
  display: block;
}

.field-row {
  display: flex;
  gap: 10px;
  align-items: center;
}

.field-row :deep(.n-input) {
  flex: 1;
}

.token-hint {
  font-size: 12px;
  margin-top: 4px;
  display: block;
}

.token-command {
  background: var(--bg-secondary);
  padding: 1px 4px;
  border-radius: 3px;
}

.login-submit {
  border-radius: 8px;
}

@media (max-width: 640px) {
  .scene-grid {
    grid-template-columns: 1fr;
  }

  .field-row {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
