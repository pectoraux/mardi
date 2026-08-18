'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight, Brain, Check, Clock, Mail, Sparkles, Target, X,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { apiFetch, fmtPct, fmtDateTime, fmtMoney } from '../types'

interface Prospect {
  id: string
  company: string
  website: string | null
  industry: string | null
  size: string | null
  contactName: string | null
  contactEmail: string | null
  contactTitle: string | null
  icpFitScore: number
  qualificationSignals: string[]
  opportunitySignals: Record<string, unknown>
  status: string
  outreachState: string
  source: string
  growthExperimentId: string | null
  outreachCount: number
  createdAt: string
}

interface Outreach {
  id: string
  prospectId: string
  prospectCompany: string | null
  type: string
  subject: string | null
  body: string
  diagnosis: string | null
  rationale: string | null
  status: string
  approvedBy: string | null
  sentAt: string | null
  repliedAt: string | null
  responseSummary: string | null
  outcome: string | null
  createdAt: string
}

export function ProspectWorkbench({ tenant }: { tenant: string }) {
  const qc = useQueryClient()
  const [selectedProspectId, setSelectedProspectId] = useState<string | null>(null)
  const [drafting, setDrafting] = useState(false)
  const [responseForm, setResponseForm] = useState<Record<string, { summary: string; outcome: string }>>({})

  const prospectsQ = useQuery({
    queryKey: ['growth-prospects', tenant],
    queryFn: () => apiFetch<{ prospects: Prospect[] }>('/api/growth/prospects', tenant),
  })

  const outreachesQ = useQuery({
    queryKey: ['growth-outreach', tenant],
    queryFn: () => apiFetch<{ outreaches: Outreach[] }>('/api/growth/outreach', tenant),
  })

  const prospects = prospectsQ.data?.prospects ?? []
  const outreaches = outreachesQ.data?.outreaches ?? []
  const selectedProspect = prospects.find((p) => p.id === selectedProspectId)
  const prospectOutreaches = outreaches.filter((o) => o.prospectId === selectedProspectId)

  async function generateDraft(prospectId: string) {
    setDrafting(true)
    const t = toast.loading('Generating personalized outreach draft…')
    try {
      const result = await apiFetch<{ outreachId: string; draft: Record<string, unknown>; fellBack: boolean }>(
        `/api/growth/prospects/${prospectId}`,
        tenant,
        { method: 'POST' }
      )
      toast.success(`Draft generated${result.fellBack ? ' (fallback mode)' : ''}`, { id: t })
      qc.invalidateQueries({ queryKey: ['growth-outreach', tenant] })
      qc.invalidateQueries({ queryKey: ['growth-prospects', tenant] })
    } catch (e) {
      toast.error(String(e).slice(0, 120), { id: t })
    } finally {
      setDrafting(false)
    }
  }

  async function approveOutreach(outreachId: string) {
    const t = toast.loading('Approving…')
    try {
      await apiFetch(`/api/growth/outreach/${outreachId}`, tenant, {
        method: 'POST', body: { action: 'approve' },
      })
      toast.success('Approved — ready to send', { id: t })
      qc.invalidateQueries({ queryKey: ['growth-outreach', tenant] })
      qc.invalidateQueries({ queryKey: ['growth-prospects', tenant] })
    } catch (e) {
      toast.error(String(e).slice(0, 120), { id: t })
    }
  }

  async function markSent(outreachId: string) {
    const t = toast.loading('Marking as sent…')
    try {
      await apiFetch(`/api/growth/outreach/${outreachId}`, tenant, {
        method: 'POST', body: { action: 'mark_sent' },
      })
      toast.success('Recorded as sent', { id: t })
      qc.invalidateQueries({ queryKey: ['growth-outreach', tenant] })
      qc.invalidateQueries({ queryKey: ['growth-prospects', tenant] })
      qc.invalidateQueries({ queryKey: ['growth-dashboard', tenant] })
    } catch (e) {
      toast.error(String(e).slice(0, 120), { id: t })
    }
  }

  async function recordResponse(outreachId: string) {
    const form = responseForm[outreachId]
    if (!form?.summary) {
      toast.error('Enter a response summary')
      return
    }
    const t = toast.loading('Recording response…')
    try {
      await apiFetch(`/api/growth/outreach/${outreachId}`, tenant, {
        method: 'POST',
        body: { action: 'record_response', responseSummary: form.summary, outcome: form.outcome || 'conversation' },
      })
      toast.success('Response recorded', { id: t })
      setResponseForm({ ...responseForm, [outreachId]: { summary: '', outcome: 'conversation' } })
      qc.invalidateQueries({ queryKey: ['growth-outreach', tenant] })
      qc.invalidateQueries({ queryKey: ['growth-prospects', tenant] })
      qc.invalidateQueries({ queryKey: ['growth-dashboard', tenant] })
    } catch (e) {
      toast.error(String(e).slice(0, 120), { id: t })
    }
  }

  async function convertToCustomer(prospectId: string, outreachId: string, experimentId: string | null) {
    const amount = prompt('Enter the verified payment amount (USD):')
    if (!amount) return
    const amt = parseFloat(amount)
    if (isNaN(amt) || amt <= 0) {
      toast.error('Invalid amount')
      return
    }
    const paymentSource = prompt('Payment source (stripe | invoice | paypal | manual_verification):', 'manual_verification')
    if (!paymentSource) return
    const t = toast.loading('Recording verified revenue…')
    try {
      const result = await apiFetch<{ ok: boolean; message: string }>(`/api/growth/revenue`, tenant, {
        method: 'POST',
        body: {
          prospectId,
          outreachId,
          growthExperimentId: experimentId,
          amount: amt,
          paymentSource,
          customerName: selectedProspect?.company,
        },
      })
      toast.success(result.message, { id: t, duration: 8000 })
      qc.invalidateQueries({ queryKey: ['growth-dashboard', tenant] })
      qc.invalidateQueries({ queryKey: ['growth-prospects', tenant] })
      qc.invalidateQueries({ queryKey: ['growth-outreach', tenant] })
    } catch (e) {
      toast.error(String(e).slice(0, 120), { id: t })
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* Prospect list */}
      <Card className="lg:col-span-1">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="size-4 text-amber-600" /> Prospects
          </CardTitle>
          <CardDescription className="text-xs">Click to inspect</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-[600px] overflow-y-auto space-y-2">
            {prospects.length === 0 && <div className="text-xs text-muted-foreground italic py-3 text-center">No prospects yet.</div>}
            {prospects.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedProspectId(p.id)}
                className={`w-full text-left border rounded-md p-2 text-xs transition-colors ${selectedProspectId === p.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="font-medium truncate">{p.company}</span>
                  <Badge variant="outline" className="text-[9px] h-4 shrink-0">{p.status}</Badge>
                </div>
                <div className="text-muted-foreground mt-0.5 truncate">
                  {p.industry ?? '—'} · ICP {fmtPct(p.icpFitScore)}
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Prospect detail + workbench */}
      <Card className="lg:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Brain className="size-4 text-fuchsia-600" /> Prospect Workbench
          </CardTitle>
          <CardDescription className="text-xs">
            Why selected · evidence · diagnostic findings · outreach
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!selectedProspect && (
            <div className="text-xs text-muted-foreground italic py-8 text-center">
              Select a prospect to inspect their evidence and generate outreach.
            </div>
          )}
          {selectedProspect && (
            <div className="space-y-4">
              {/* Why them + evidence */}
              <div>
                <div className="text-sm font-medium">{selectedProspect.company}</div>
                <div className="text-[11px] text-muted-foreground">
                  {selectedProspect.website ?? '—'} · {selectedProspect.industry ?? '—'} · {selectedProspect.size ?? '—'} · source: {selectedProspect.source}
                </div>
                {selectedProspect.contactName && (
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Contact: {selectedProspect.contactName} ({selectedProspect.contactTitle})
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border p-2">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">ICP Fit</div>
                  <div className="text-lg font-semibold">{fmtPct(selectedProspect.icpFitScore)}</div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Outreach State</div>
                  <div className="text-sm font-medium capitalize">{selectedProspect.outreachState.replace(/_/g, ' ')}</div>
                </div>
              </div>

              {selectedProspect.qualificationSignals.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Qualification Signals</div>
                  <div className="flex flex-wrap gap-1">
                    {selectedProspect.qualificationSignals.map((s, i) => (
                      <Badge key={i} variant="outline" className="text-[10px] h-5">{s}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {selectedProspect.opportunitySignals && Object.keys(selectedProspect.opportunitySignals).length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Opportunity Signals (from diagnostic)</div>
                  <div className="rounded-md bg-muted/60 p-2 text-[11px] space-y-1">
                    {(selectedProspect.opportunitySignals as Record<string, unknown>).recommendedAngle && (
                      <div><span className="font-medium">Recommended angle:</span> {String((selectedProspect.opportunitySignals as Record<string, unknown>).recommendedAngle)}</div>
                    )}
                    {(selectedProspect.opportunitySignals as Record<string, unknown>).suggestedCTA && (
                      <div><span className="font-medium">Suggested CTA:</span> {String((selectedProspect.opportunitySignals as Record<string, unknown>).suggestedCTA)}</div>
                    )}
                    {(selectedProspect.opportunitySignals as Record<string, unknown>).mardiFit && (
                      <div><span className="font-medium">MARDI fit:</span> {String((selectedProspect.opportunitySignals as Record<string, unknown>).mardiFit).slice(0, 200)}</div>
                    )}
                  </div>
                </div>
              )}

              {/* Generate draft button */}
              <Button
                onClick={() => generateDraft(selectedProspect.id)}
                disabled={drafting}
                className="w-full gap-2"
                size="sm"
              >
                <Sparkles className="size-3.5" />
                {drafting ? 'Generating draft…' : 'Generate personalized outreach draft'}
              </Button>

              {/* Existing outreach for this prospect */}
              {prospectOutreaches.length > 0 && (
                <div className="space-y-3">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Outreach</div>
                  {prospectOutreaches.map((o) => {
                    const diagnosis = o.diagnosis ? JSON.parse(o.diagnosis) : null
                    return (
                      <div key={o.id} className="border rounded-md p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium">{o.subject ?? '(no subject)'}</span>
                          <Badge variant="outline" className={`text-[9px] h-4 ${
                            o.status === 'sent' ? 'bg-emerald-50 text-emerald-700' :
                            o.status === 'replied' || o.status === 'closed' ? 'bg-teal-50 text-teal-700' :
                            o.status === 'approved' ? 'bg-blue-50 text-blue-700' :
                            'bg-amber-50 text-amber-700'
                          }`}>{o.status}</Badge>
                        </div>

                        {diagnosis && (
                          <div className="text-[11px] space-y-1 bg-muted/40 rounded p-2">
                            {diagnosis.whyThem && <div><span className="font-medium">Why them:</span> {diagnosis.whyThem}</div>}
                            {diagnosis.problemObserved && <div><span className="font-medium">Problem:</span> {diagnosis.problemObserved}</div>}
                            {diagnosis.specificOffer && <div><span className="font-medium">Offer:</span> {diagnosis.specificOffer}</div>}
                            {diagnosis.confidence !== undefined && (
                              <div><span className="font-medium">Confidence:</span> {fmtPct(diagnosis.confidence)}</div>
                            )}
                          </div>
                        )}

                        <div className="text-[11px] text-muted-foreground whitespace-pre-wrap border-l-2 border-muted pl-2 max-h-40 overflow-y-auto">
                          {o.body.slice(0, 500)}{o.body.length > 500 ? '…' : ''}
                        </div>

                        {/* Action buttons based on status */}
                        <div className="flex items-center gap-2 flex-wrap">
                          {o.status === 'draft' && (
                            <Button size="sm" variant="outline" className="h-6 text-[11px] gap-1" onClick={() => approveOutreach(o.id)}>
                              <Check className="size-3" /> Approve
                            </Button>
                          )}
                          {o.status === 'approved' && (
                            <Button size="sm" className="h-6 text-[11px] gap-1" onClick={() => markSent(o.id)}>
                              <Mail className="size-3" /> Mark as sent
                            </Button>
                          )}
                          {o.status === 'sent' && (
                            <div className="w-full space-y-1.5">
                              <div className="text-[10px] text-muted-foreground">Record response:</div>
                              <Textarea
                                placeholder="Summary of the response (or 'no response yet')…"
                                className="text-xs min-h-12"
                                value={responseForm[o.id]?.summary ?? ''}
                                onChange={(e) => setResponseForm({ ...responseForm, [o.id]: { summary: e.target.value, outcome: responseForm[o.id]?.outcome ?? 'conversation' } })}
                              />
                              <div className="flex items-center gap-2">
                                <Select
                                  value={responseForm[o.id]?.outcome ?? 'conversation'}
                                  onValueChange={(v) => setResponseForm({ ...responseForm, [o.id]: { summary: responseForm[o.id]?.summary ?? '', outcome: v } })}
                                >
                                  <SelectTrigger className="h-6 text-[11px] w-40"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="conversation">Conversation</SelectItem>
                                    <SelectItem value="qualified">Qualified</SelectItem>
                                    <SelectItem value="converted">Converted</SelectItem>
                                    <SelectItem value="rejected">Rejected</SelectItem>
                                    <SelectItem value="no_response">No response</SelectItem>
                                  </SelectContent>
                                </Select>
                                <Button size="sm" className="h-6 text-[11px]" onClick={() => recordResponse(o.id)}>
                                  Record
                                </Button>
                              </div>
                            </div>
                          )}
                          {o.status === 'replied' && o.outcome === 'converted' && (
                            <div className="text-[11px] text-emerald-700 font-medium">✓ Converted</div>
                          )}
                          {o.status === 'replied' && o.outcome !== 'converted' && (
                            <Button
                              size="sm"
                              className="h-6 text-[11px] gap-1 bg-emerald-600 hover:bg-emerald-700"
                              onClick={() => convertToCustomer(selectedProspect.id, o.id, selectedProspect.growthExperimentId)}
                            >
                              <ArrowRight className="size-3" /> Convert to customer
                            </Button>
                          )}
                        </div>

                        {o.sentAt && (
                          <div className="text-[10px] text-muted-foreground">Sent: {fmtDateTime(o.sentAt)}</div>
                        )}
                        {o.repliedAt && (
                          <div className="text-[10px] text-muted-foreground">Replied: {fmtDateTime(o.repliedAt)}</div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
