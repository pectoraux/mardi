import { NextRequest, NextResponse } from 'next/server'
import { withTenant } from '@/lib/middleware-tenant'
import { t } from '@/lib/tenant-guard'
import { getTenantContext } from '@/lib/tenant-context'

export const GET = withTenant(async (_req, _ctx) => {
  const outreaches = await t.outreach.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { prospect: true } as never,
  })
  return NextResponse.json({
    outreaches: outreaches.map((o) => ({
      id: o.id,
      prospectId: o.prospectId,
      prospectCompany: (o as unknown as { prospect?: { company: string } }).prospect?.company,
      type: o.type,
      subject: o.subject,
      body: o.body,
      diagnosis: o.diagnosis,
      rationale: o.rationale,
      status: o.status,
      approvedBy: o.approvedBy,
      approvedAt: o.approvedAt,
      sentAt: o.sentAt,
      repliedAt: o.repliedAt,
      responseSummary: o.responseSummary,
      outcome: o.outcome,
      createdAt: o.createdAt,
    })),
  })
})

export const POST = withTenant(async (req: NextRequest, _ctx) => {
  const body = await req.json().catch(() => ({}))
  const ctx = getTenantContext()

  if (body.action === 'approve') {
    // Human approval required before any outreach is sent (milestone 9)
    const o = await t.outreach.update({
      where: { id: body.outreachId },
      data: {
        status: 'approved',
        approvedBy: ctx.userId ?? 'operator',
        approvedAt: new Date(),
      },
    })
    return NextResponse.json({ ok: true, id: o.id, status: o.status })
  }

  if (body.action === 'mark_sent') {
    const o = await t.outreach.update({
      where: { id: body.outreachId },
      data: { status: 'sent', sentAt: new Date() },
    })
    // Update prospect state
    await t.prospect.update({
      where: { id: o.prospectId },
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

  if (body.action === 'record_response') {
    const o = await t.outreach.update({
      where: { id: body.outreachId },
      data: {
        status: 'replied',
        repliedAt: new Date(),
        responseSummary: body.responseSummary,
        outcome: body.outcome ?? 'conversation',
      },
    })
    await t.prospect.update({
      where: { id: o.prospectId },
      data: { status: 'responded', outreachState: 'replied' },
    })
    if (o.growthExperimentId && body.outcome === 'qualified') {
      const exp = await t.growthExperiment.findUnique({ where: { id: o.growthExperimentId } })
      if (exp) {
        await t.growthExperiment.update({
          where: { id: exp.id },
          data: { qualifiedLeads: exp.qualifiedLeads + 1, leads: exp.leads + 1 },
        })
      }
    }
    return NextResponse.json({ ok: true })
  }

  // Create new outreach (draft — requires approval before sending)
  const o = await t.outreach.create({
    data: {
      prospectId: body.prospectId,
      growthExperimentId: body.growthExperimentId ?? null,
      type: body.type ?? 'email',
      subject: body.subject ?? null,
      body: body.body,
      diagnosis: body.diagnosis ?? null,
      rationale: body.rationale ?? null,
      status: 'draft',
    },
  })
  await t.prospect.update({
    where: { id: body.prospectId },
    data: { outreachState: 'drafting' },
  })
  return NextResponse.json({ ok: true, id: o.id, status: 'draft' })
})
