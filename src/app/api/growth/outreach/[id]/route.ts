import { NextRequest, NextResponse } from 'next/server'
import { withTenant } from '@/lib/middleware-tenant'
import { t } from '@/lib/tenant-guard'
import { getTenantContext } from '@/lib/tenant-context'

// POST /api/growth/outreach/[id] — approve / mark sent / record response
export const POST = withTenant(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const ctx = getTenantContext()
  const { action } = (body ?? {}) as { action: string }

  const outreach = await t.outreach.findUnique({ where: { id } })
  if (!outreach) return NextResponse.json({ error: 'not found' }, { status: 404 })

  if (action === 'approve') {
    const o = await t.outreach.update({
      where: { id },
      data: { status: 'approved', approvedBy: ctx.userId ?? 'operator', approvedAt: new Date() },
    })
    await t.prospect.update({
      where: { id: outreach.prospectId },
      data: { outreachState: 'approved' },
    })
    return NextResponse.json({ ok: true, status: o.status })
  }

  if (action === 'mark_sent') {
    const o = await t.outreach.update({
      where: { id },
      data: { status: 'sent', sentAt: new Date() },
    })
    await t.prospect.update({
      where: { id: outreach.prospectId },
      data: { status: 'contacted', outreachState: 'sent', lastContactedAt: new Date() },
    })
    // Increment experiment exposure
    if (o.growthExperimentId) {
      const exp = await t.growthExperiment.findUnique({ where: { id: o.growthExperimentId } })
      if (exp) {
        await t.growthExperiment.update({
          where: { id: exp.id },
          data: { exposure: exp.exposure + 1 },
        })
      }
    }
    return NextResponse.json({ ok: true })
  }

  if (action === 'record_response') {
    const { responseSummary, outcome } = (body ?? {}) as { responseSummary?: string; outcome?: string }
    const o = await t.outreach.update({
      where: { id },
      data: {
        status: 'replied',
        repliedAt: new Date(),
        responseSummary: responseSummary ?? null,
        outcome: outcome ?? 'conversation',
      },
    })
    await t.prospect.update({
      where: { id: outreach.prospectId },
      data: {
        status: outcome === 'qualified' ? 'qualified' : 'responded',
        outreachState: outcome === 'qualified' ? 'conversation' : 'replied',
      },
    })
    // Update experiment funnel
    if (o.growthExperimentId) {
      const exp = await t.growthExperiment.findUnique({ where: { id: o.growthExperimentId } })
      if (exp) {
        const updates: Record<string, unknown> = { leads: exp.leads + 1 }
        if (outcome === 'qualified') updates.qualifiedLeads = exp.qualifiedLeads + 1
        await t.growthExperiment.update({ where: { id: exp.id }, data: updates })
      }
    }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
})
