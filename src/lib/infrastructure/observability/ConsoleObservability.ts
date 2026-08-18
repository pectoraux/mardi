// Bootstrap ObservabilityProvider — console-based metrics/spans/logs.
// Production: OpenTelemetry adapter exporting to Honeycomb/Datadog/Jaeger.

import type { ObservabilityProviderPort } from '../../application/ports'
import type { TenantContext } from '../../tenant-context'

export const ConsoleObservability: ObservabilityProviderPort = {
  metric(ctx, name, value, opts) {
    // In production: export to OTLP collector
    if (process.env.OBSERVABILITY_DEBUG === 'true') {
      console.log(`[metric] ${ctx.tenantSlug}:${name}=${value}${opts?.unit ? opts.unit : ''}`)
    }
  },

  increment(ctx, name, opts) {
    if (process.env.OBSERVABILITY_DEBUG === 'true') {
      console.log(`[increment] ${ctx.tenantSlug}:${name}`)
    }
  },

  histogram(ctx, name, value, opts) {
    if (process.env.OBSERVABILITY_DEBUG === 'true') {
      console.log(`[histogram] ${ctx.tenantSlug}:${name}=${value}${opts?.unit ? opts.unit : ''}`)
    }
  },

  async span(ctx, name, fn, opts) {
    const started = Date.now()
    try {
      const result = await fn()
      const duration = Date.now() - started
      if (process.env.OBSERVABILITY_DEBUG === 'true') {
        console.log(`[span] ${ctx.tenantSlug}:${name} ${duration}ms`)
      }
      return result
    } catch (err) {
      const duration = Date.now() - started
      console.error(`[span] ${ctx.tenantSlug}:${name} FAILED ${duration}ms`, err)
      throw err
    }
  },

  log(ctx, level, message, opts) {
    const prefix = `[${level}] ${ctx.tenantSlug}:`
    if (level === 'error') {
      console.error(prefix, message, opts?.data ?? '')
    } else if (level === 'warn') {
      console.warn(prefix, message, opts?.data ?? '')
    } else if (process.env.OBSERVABILITY_DEBUG === 'true' || level === 'info') {
      console.log(prefix, message, opts?.data ?? '')
    }
  },
}
