// Bootstrap WorkflowEngine adapter — DB-backed durable execution.
// Production: Temporal adapter behind the same interface (Section 5).
// The DB-backed adapter persists workflow + step state, supports pauses
// (for human approval), and can resume after process restarts.

import type { WorkflowEnginePort } from '../../application/ports'
import type { TenantContext } from '../../tenant-context'
import { t } from '../../tenant-guard'
import { requireTenantId } from '../../tenant-context'
import { randomUUID } from 'node:crypto'

export const DbWorkflowEngine: WorkflowEnginePort = {
  async start(ctx, workflow) {
    const tid = requireTenantId()
    const wf = await t.workflow.create({
      data: {
        tenantId: tid,
        type: workflow.type,
        status: 'running',
        input: JSON.stringify(workflow.input),
        version: workflow.version ?? 'v1',
      } as never,
    })
    return { workflowId: wf.id }
  },

  async getStatus(ctx, workflowId) {
    const wf = await t.workflow.findUnique({ where: { id: workflowId }, include: { steps: true } as never })
    if (!wf) return { status: 'failed' as const, error: 'workflow not found' }
    const runningStep = (wf as unknown as { steps?: Array<{ name: string; status: string }> }).steps?.find((s) => s.status === 'running')
    return {
      status: wf.status as 'pending' | 'running' | 'completed' | 'failed' | 'paused',
      currentStep: runningStep?.name,
      output: wf.output ? JSON.parse(wf.output) : undefined,
      error: undefined,
    }
  },

  async pause(ctx, workflowId) {
    await t.workflow.update({ where: { id: workflowId }, data: { status: 'paused' } })
  },

  async resume(ctx, workflowId, signal) {
    await t.workflow.update({
      where: { id: workflowId },
      data: { status: 'running', output: signal ? JSON.stringify(signal) : undefined },
    })
  },

  async cancel(ctx, workflowId) {
    await t.workflow.update({ where: { id: workflowId }, data: { status: 'failed' } })
  },
}
