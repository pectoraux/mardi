// Bootstrap ExecutionProvider — passes actions through policy + mode pipeline.
// Production: real ad platform / CRM / email adapters behind the same interface.

import type { ExecutionProviderPort } from '../../application/ports'
import type { TenantContext } from '../../tenant-context'
import { getExecutor } from '../composition/root'
import { randomUUID } from 'node:crypto'

export const PolicyControlledExecutionProvider: ExecutionProviderPort = {
  async execute(ctx, action) {
    const executor = getExecutor()
    const mode = await executor.getMode(ctx.tenantId)

    // Determine if this action costs money
    const costs = action.cost ?? 0
    const isPaidAction = costs > 0

    // Paid actions require verified capital (capital provenance invariant)
    if (isPaidAction && mode === 'LIVE') {
      const { getRepository } = await import('../composition/root')
      const { createCapitalProvenanceService } = await import('../../domain/services/capital-provenance')
      const repo = getRepository()
      const capitalService = createCapitalProvenanceService(repo)
      const canSpend = await capitalService.canAuthorizeSpend(ctx, costs)
      if (!canSpend) {
        return {
          result: { error: 'INSUFFICIENT_VERIFIED_CAPITAL' },
          mode,
          simulated: true,
          executionId: randomUUID(),
        }
      }
    }

    // Execute through the mode-aware executor
    const result = await executor.execute(ctx, {
      type: action.type,
      description: `${action.provider}:${action.operation}`,
      perform: async () => {
        // In bootstrap mode, we don't have real ad platform APIs.
        // Record the action as "would have executed" and return a receipt.
        return { provider: action.provider, operation: action.operation, status: 'executed', params: action.params }
      },
      performSandbox: async () => {
        return { provider: action.provider, operation: action.operation, status: 'sandbox_executed', params: action.params }
      },
    })

    return {
      result: result.result,
      mode: result.mode,
      simulated: result.simulated,
      executionId: randomUUID(),
    }
  },
}
