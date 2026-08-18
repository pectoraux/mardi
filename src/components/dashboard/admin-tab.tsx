'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Clock, Mail, Shield, UserCheck, X } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { apiFetch, fmtDateTime } from './types'

interface WaitlistEntry {
  id: string
  email: string
  name: string
  requestedRole: string
  tenantSlug: string | null
  status: string
  createdAt: string
  reviewedAt: string | null
  createdUserId: string | null
}

interface TenantInfo {
  slug: string
  name: string
}

export function AdminTab({ tenant }: { tenant: string }) {
  const qc = useQueryClient()
  const [pendingTenant, setPendingTenant] = useState<Record<string, string>>({})

  const waitlistQ = useQuery({
    queryKey: ['admin-waitlist'],
    queryFn: () => apiFetch<{ entries: WaitlistEntry[] }>('/api/admin/waitlist', tenant),
  })

  const tenantsQ = useQuery({
    queryKey: ['tenants'],
    queryFn: () => apiFetch<{ tenants: TenantInfo[] }>('/api/tenants', tenant),
  })

  async function approve(entryId: string) {
    const tenantId = pendingTenant[entryId]
    if (!tenantId) {
      toast.error('Select a tenant first')
      return
    }
    const t = toast.loading('Creating account…')
    try {
      await apiFetch('/api/admin/waitlist', tenant, {
        method: 'POST',
        body: { entryId, action: 'approve', tenantId },
      })
      toast.success('Account created & approved', { id: t })
      qc.invalidateQueries({ queryKey: ['admin-waitlist'] })
    } catch (e) {
      toast.error(String(e).slice(0, 120), { id: t })
    }
  }

  async function reject(entryId: string) {
    const t = toast.loading('Rejecting…')
    try {
      await apiFetch('/api/admin/waitlist', tenant, {
        method: 'POST',
        body: { entryId, action: 'reject' },
      })
      toast.success('Entry rejected', { id: t })
      qc.invalidateQueries({ queryKey: ['admin-waitlist'] })
    } catch (e) {
      toast.error(String(e).slice(0, 120), { id: t })
    }
  }

  const entries = waitlistQ.data?.entries ?? []
  const pending = entries.filter((e) => e.status === 'pending')
  const reviewed = entries.filter((e) => e.status !== 'pending')
  const tenants = tenantsQ.data?.tenants ?? []

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="size-4 text-emerald-600" /> Waitlist Management
          </CardTitle>
          <CardDescription>
            Review sign-up requests. Approving creates a user account assigned to a tenant.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {waitlistQ.isLoading && <div className="text-xs text-muted-foreground">Loading…</div>}

          <div className="grid grid-cols-3 gap-3 mb-4">
            <Stat label="Pending" value={pending.length} icon={Clock} color="text-amber-600" />
            <Stat label="Approved" value={reviewed.filter((e) => e.status === 'approved').length} icon={UserCheck} color="text-emerald-600" />
            <Stat label="Rejected" value={reviewed.filter((e) => e.status === 'rejected').length} icon={X} color="text-destructive" />
          </div>

          {pending.length === 0 && !waitlistQ.isLoading && (
            <div className="text-xs text-muted-foreground italic py-4 text-center">
              No pending requests. New sign-ups will appear here.
            </div>
          )}

          <div className="space-y-3">
            {pending.map((e) => (
              <div key={e.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-sm flex items-center gap-2">
                      <Mail className="size-3.5 text-muted-foreground" />
                      {e.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{e.email}</div>
                    <div className="text-[11px] text-muted-foreground">
                      Requested role: <span className="font-medium">{e.requestedRole}</span>
                      {e.tenantSlug && <> · tenant: <span className="font-medium">{e.tenantSlug}</span></>}
                      {' · '}{fmtDateTime(e.createdAt)}
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px] h-5 shrink-0 bg-amber-50 text-amber-700 border-amber-300">
                    pending
                  </Badge>
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <Select
                    value={pendingTenant[e.id] ?? ''}
                    onValueChange={(v) => setPendingTenant({ ...pendingTenant, [e.id]: v })}
                  >
                    <SelectTrigger className="h-7 text-xs w-48">
                      <SelectValue placeholder="Assign to tenant…" />
                    </SelectTrigger>
                    <SelectContent>
                      {tenants.map((t) => (
                        <SelectItem key={t.slug} value={t.slug}>
                          {t.name} ({t.slug})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex-1" />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    onClick={() => reject(e.id)}
                  >
                    <X className="size-3" /> Reject
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={() => approve(e.id)}
                    disabled={!pendingTenant[e.id]}
                  >
                    <Check className="size-3" /> Approve
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {reviewed.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Reviewed Requests</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {reviewed.map((e) => (
                <div key={e.id} className="flex items-center justify-between text-xs border-b last:border-0 py-2">
                  <div>
                    <span className="font-medium">{e.name}</span>
                    <span className="text-muted-foreground ml-2">{e.email}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={`text-[10px] h-5 ${e.status === 'approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-destructive/5 text-destructive border-destructive/30'}`}>
                      {e.status}
                    </Badge>
                    <span className="text-muted-foreground text-[10px]">{fmtDateTime(e.reviewedAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Stat({ label, value, icon: Icon, color }: { label: string; value: number; icon: typeof Clock; color: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
        <Icon className={`size-3.5 ${color}`} />
      </div>
      <div className="text-xl font-semibold mt-1">{value}</div>
    </div>
  )
}
