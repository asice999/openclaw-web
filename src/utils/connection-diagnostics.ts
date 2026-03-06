export type ConnectionDiagnosticSeverity = 'info' | 'warning' | 'error'

export interface ConnectionDiagnosticAction {
  label: string
  detail?: string
  copyText?: string
}

export interface ConnectionDiagnostic {
  code: string
  severity: ConnectionDiagnosticSeverity
  title: string
  summary: string
  actions: ConnectionDiagnosticAction[]
}

interface DiagnoseConnectionInput {
  gatewayUrl: string
  errorMessage?: string | null
  pageProtocol?: string
  pageOrigin?: string
  isSecureContext?: boolean
}

type Translate = (key: string, params?: Record<string, unknown>) => string

function normalizeText(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase()
}

function tryParseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.replace(/\[|\]/g, '').toLowerCase()
  return normalized === 'localhost' || normalized === '::1' || /^127\./.test(normalized)
}

function extractPairingRequestId(rawMessage: string): string | null {
  const approveMatch = rawMessage.match(/approve\s+([A-Za-z0-9_-]+)/i)
  if (approveMatch?.[1]) return approveMatch[1]

  const requestIdMatch = rawMessage.match(/requestId[^A-Za-z0-9_-]*([A-Za-z0-9_-]+)/i)
  if (requestIdMatch?.[1]) return requestIdMatch[1]

  return null
}

function pushUnique(
  diagnostics: ConnectionDiagnostic[],
  seenCodes: Set<string>,
  diagnostic: ConnectionDiagnostic,
): void {
  if (seenCodes.has(diagnostic.code)) return
  seenCodes.add(diagnostic.code)
  diagnostics.push(diagnostic)
}

export function diagnoseConnection(
  input: DiagnoseConnectionInput,
  t: Translate,
): ConnectionDiagnostic[] {
  const diagnostics: ConnectionDiagnostic[] = []
  const seenCodes = new Set<string>()
  const normalizedError = normalizeText(input.errorMessage)
  const gatewayUrl = input.gatewayUrl.trim()
  const parsedUrl = gatewayUrl ? tryParseUrl(gatewayUrl) : null
  const protocol = parsedUrl?.protocol || ''
  const hostname = parsedUrl?.hostname || ''
  const isLoopback = hostname ? isLoopbackHost(hostname) : false
  const isSecureContext = input.isSecureContext !== false

  if (gatewayUrl && (!parsedUrl || (protocol !== 'ws:' && protocol !== 'wss:'))) {
    pushUnique(diagnostics, seenCodes, {
      code: 'invalid-scheme',
      severity: 'warning',
      title: t('pages.login.diagnostics.items.invalidScheme.title'),
      summary: t('pages.login.diagnostics.items.invalidScheme.summary'),
      actions: [
        {
          label: t('pages.login.diagnostics.actions.useWsScheme'),
          detail: t('pages.login.diagnostics.items.invalidScheme.detail'),
        },
      ],
    })
  }

  if (parsedUrl && input.pageProtocol === 'https:' && protocol === 'ws:' && !isLoopback) {
    pushUnique(diagnostics, seenCodes, {
      code: 'https-ws-blocked',
      severity: 'error',
      title: t('pages.login.diagnostics.items.httpsWsBlocked.title'),
      summary: t('pages.login.diagnostics.items.httpsWsBlocked.summary'),
      actions: [
        {
          label: t('pages.login.diagnostics.actions.switchToWss'),
          detail: t('pages.login.diagnostics.items.httpsWsBlocked.detail'),
        },
      ],
    })
  }

  if (!isSecureContext && (!isLoopback || /secure context|crypto\.subtle|设备签名/.test(normalizedError))) {
    pushUnique(diagnostics, seenCodes, {
      code: 'secure-context',
      severity: 'warning',
      title: t('pages.login.diagnostics.items.secureContext.title'),
      summary: t('pages.login.diagnostics.items.secureContext.summary'),
      actions: [
        {
          label: t('pages.login.diagnostics.actions.useHttpsOrLocalhost'),
          detail: t('pages.login.diagnostics.items.secureContext.detail'),
        },
      ],
    })
  }

  if (normalizedError) {
    if (/pairing required|device pairing required|设备配对|待批准|approve/.test(normalizedError)) {
      const requestId = extractPairingRequestId(input.errorMessage || '')
      const approveCommand = requestId
        ? `openclaw devices approve ${requestId}`
        : 'openclaw devices approve --latest'
      pushUnique(diagnostics, seenCodes, {
        code: 'pairing-required',
        severity: 'error',
        title: t('pages.login.diagnostics.items.pairing.title'),
        summary: t('pages.login.diagnostics.items.pairing.summary'),
        actions: [
          {
            label: t('pages.login.diagnostics.actions.listRequests'),
            copyText: 'openclaw devices list',
          },
          {
            label: t('pages.login.diagnostics.actions.approveDevice'),
            copyText: approveCommand,
          },
        ],
      })
    }

    if (/allowedorigins|origin not allowed|origin rejected|host header origin fallback|origin .*refused|origin .*rejected/.test(normalizedError)) {
      const origin = input.pageOrigin || 'http://localhost:3001'
      const configSnippet = `{
  "gateway": {
    "controlUi": {
      "enabled": true,
      "allowedOrigins": [
        "${origin}"
      ]
    }
  }
}`
      pushUnique(diagnostics, seenCodes, {
        code: 'allowed-origins',
        severity: 'error',
        title: t('pages.login.diagnostics.items.allowedOrigins.title'),
        summary: t('pages.login.diagnostics.items.allowedOrigins.summary', { origin }),
        actions: [
          {
            label: t('pages.login.diagnostics.actions.copyAllowedOrigins'),
            copyText: configSnippet,
          },
        ],
      })
    }

    if (/token|unauthorized|forbidden|401|403|验证失败|auth/i.test(input.errorMessage || '')) {
      pushUnique(diagnostics, seenCodes, {
        code: 'token-invalid',
        severity: 'warning',
        title: t('pages.login.diagnostics.items.token.title'),
        summary: t('pages.login.diagnostics.items.token.summary'),
        actions: [
          {
            label: t('pages.login.diagnostics.actions.copyTokenCommand'),
            copyText: 'openclaw config get gateway.auth.token',
          },
        ],
      })
    }

    if (/timeout|timed out|connect\.challenge|握手超时|challenge|1006|network|econnrefused|failed to fetch|socket/.test(normalizedError)) {
      pushUnique(diagnostics, seenCodes, {
        code: 'network-unreachable',
        severity: 'warning',
        title: t('pages.login.diagnostics.items.network.title'),
        summary: t('pages.login.diagnostics.items.network.summary'),
        actions: [
          {
            label: t('pages.login.diagnostics.actions.checkGatewayAddress'),
            detail: t('pages.login.diagnostics.items.network.detail'),
          },
        ],
      })
    }
  }

  if (diagnostics.length === 0 && normalizedError) {
    pushUnique(diagnostics, seenCodes, {
      code: 'generic-error',
      severity: 'warning',
      title: t('pages.login.diagnostics.items.generic.title'),
      summary: t('pages.login.diagnostics.items.generic.summary'),
      actions: [
        {
          label: t('pages.login.diagnostics.actions.checkGatewayAddress'),
          detail: t('pages.login.diagnostics.items.generic.detail'),
        },
      ],
    })
  }

  return diagnostics
}
