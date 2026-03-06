<script setup lang="ts">
import { NAlert, NButton, NSpace, NText, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { ConnectionDiagnostic } from '@/utils/connection-diagnostics'

const props = defineProps<{
  diagnostics: ConnectionDiagnostic[]
  title?: string
}>()

const message = useMessage()
const { t } = useI18n()

function mapAlertType(severity: ConnectionDiagnostic['severity']): 'info' | 'warning' | 'error' {
  if (severity === 'error') return 'error'
  if (severity === 'warning') return 'warning'
  return 'info'
}

async function handleCopy(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    message.success(t('pages.login.diagnostics.copied'))
  } catch {
    message.error(t('pages.login.diagnostics.copyFailed'))
  }
}
</script>

<template>
  <div v-if="props.diagnostics.length" class="connection-diagnostics">
    <NText v-if="props.title" depth="3" class="connection-diagnostics__title">
      {{ props.title }}
    </NText>

    <div class="connection-diagnostics__list">
      <NAlert
        v-for="diagnostic in props.diagnostics"
        :key="diagnostic.code"
        :type="mapAlertType(diagnostic.severity)"
        :bordered="false"
        class="connection-diagnostics__item"
      >
        <template #header>
          {{ diagnostic.title }}
        </template>

        <div class="connection-diagnostics__summary">{{ diagnostic.summary }}</div>

        <div v-if="diagnostic.actions.length" class="connection-diagnostics__actions">
          <div
            v-for="action in diagnostic.actions"
            :key="`${diagnostic.code}-${action.label}`"
            class="connection-diagnostics__action"
          >
            <div class="connection-diagnostics__action-main">
              <div class="connection-diagnostics__action-label">{{ action.label }}</div>
              <div v-if="action.detail" class="connection-diagnostics__action-detail">{{ action.detail }}</div>
              <pre v-if="action.copyText" class="connection-diagnostics__code">{{ action.copyText }}</pre>
            </div>

            <NButton
              v-if="action.copyText"
              size="tiny"
              secondary
              @click="handleCopy(action.copyText)"
            >
              {{ t('pages.login.diagnostics.copy') }}
            </NButton>
          </div>
        </div>
      </NAlert>
    </div>
  </div>
</template>

<style scoped>
.connection-diagnostics {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.connection-diagnostics__title {
  font-size: 12px;
}

.connection-diagnostics__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.connection-diagnostics__item {
  border-radius: 10px;
}

.connection-diagnostics__summary {
  font-size: 13px;
  line-height: 1.6;
}

.connection-diagnostics__actions {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.connection-diagnostics__action {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
  padding: 10px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
}

.connection-diagnostics__action-main {
  min-width: 0;
  flex: 1;
}

.connection-diagnostics__action-label {
  font-size: 13px;
  font-weight: 600;
}

.connection-diagnostics__action-detail {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary);
}

.connection-diagnostics__code {
  margin-top: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 640px) {
  .connection-diagnostics__action {
    flex-direction: column;
  }
}
</style>
