'use client'

import { useState, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Activity, Brain, FlaskConical, GitFork, LayoutDashboard,
  Lightbulb, Network, Plug, ScrollText, Shield, Sparkles, TrendingUp, Users,
} from 'lucide-react'
import { apiFetch, type AutonomyT, type DashboardData, type Tenant } from '@/components/dashboard/types'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { OverviewTab } from '@/components/dashboard/overview-tab'
import { DataTab } from '@/components/dashboard/data-tab'
import { EvidenceTab } from '@/components/dashboard/evidence-tab'
import { ExperimentsTab } from '@/components/dashboard/experiments-tab'
import { RecommendationsTab } from '@/components/dashboard/recommendations-tab'
import { DecisionsTab } from '@/components/dashboard/decisions-tab'
import { AgentTab } from '@/components/dashboard/agent-tab'
import { AuthModal } from '@/components/dashboard/auth-modal'
import { AdminTab } from '@/components/dashboard/admin-tab'
import { GrowthTab } from '@/components/dashboard/growth/growth-tab'
import { DiagnosticTool } from '@/components/dashboard/growth/diagnostic-tool'
import { useSearchParams } from 'next/navigation'

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'data', label: 'Data Sources', icon: Plug },
  { id: 'evidence', label: 'Evidence Graph', icon: Network },
  { id: 'experiments', label: 'Experiments', icon: FlaskConical },
  { id: 'recommendations', label: 'Recommendations', icon: Lightbulb },
  { id: 'decisions', label: 'Decision Ledger', icon: ScrollText },
  { id: 'agent', label: 'Strategy Agent', icon: Brain },
  { id: 'growth', label: 'Growth', icon: TrendingUp },
] as const

interface SessionUser {
  id?: string
  email?: string
  name?: string
  roles: string[]
  tenantId?: string
  tenantSlug?: string | null
  isDemo: boolean
  isAdmin: boolean
}

export default function Page() {
  const searchParams = useSearchParams()
  const isDiagnosticTool = searchParams.get('tool') === 'growth-diagnostic'

  // Public diagnostic tool — no auth required, renders standalone
  if (isDiagnosticTool) {
    return <DiagnosticTool />
  }
  return <Dashboard />
}

function Dashboard() {
  const [tenant, setTenant] = useState('acme')
  const [tab, setTab] = useState<string>('overview')
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)

  const fetchSession = useCallback(async () => {
    setSessionLoading(true)
    try {
      const res = await fetch('/api/session')
      const data = await res.json()
      if (data.authenticated && data.user) {
        setSessionUser(data.user)
        // If the user has a tenant and no explicit tenant is set, use their tenant
        if (data.user.tenantSlug && tenant === 'acme') {
          setTenant(data.user.tenantSlug)
        }
      } else {
        setSessionUser(null)
      }
    } catch {
      setSessionUser(null)
    } finally {
      setSessionLoading(false)
    }
  }, [tenant])

  useEffect(() => {
    fetchSession()
  }, [fetchSession])

  const tenantsQ = useQuery({
    queryKey: ['tenants'],
    queryFn: () => apiFetch<{ tenants: Tenant[] }>('/api/tenants', tenant),
  })

  const dashQ = useQuery({
    queryKey: ['dashboard', tenant],
    queryFn: () => apiFetch<DashboardData>('/api/dashboard', tenant),
    refetchInterval: 20_000,
  })

  const autonomyQ = useQuery({
    queryKey: ['autonomy', tenant],
    queryFn: () => apiFetch<AutonomyT>('/api/autonomy', tenant),
  })

  const tenants = tenantsQ.data?.tenants ?? []
  const dash = dashQ.data
  const autonomy = autonomyQ.data

  async function setAutonomyLevel(level: number) {
    await apiFetch('/api/autonomy', tenant, { method: 'POST', body: { autonomyLevel: level } })
    autonomyQ.refetch()
  }

  // Build the tab list — add admin tab if the user is an admin
  const visibleTabs = sessionUser?.isAdmin
    ? [...TABS, { id: 'admin', label: 'Admin', icon: Users } as const]
    : TABS

  return (
    <div className="min-h-screen flex flex-col bg-muted/30">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 mr-2">
            <div className="size-8 rounded-lg bg-primary text-primary-foreground grid place-items-center font-bold text-sm">
              MD
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold">Marketing Decision Intelligence</div>
              <div className="text-[11px] text-muted-foreground hidden sm:block">
                Capital allocation · Causal evidence · Continuous learning
              </div>
            </div>
          </div>

          <div className="flex-1" />

          {/* Tenant switcher */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground hidden sm:inline">Tenant</span>
            <Select value={tenant} onValueChange={setTenant}>
              <SelectTrigger className="w-[180px] sm:w-[220px] h-9">
                <SelectValue placeholder="Select tenant" />
              </SelectTrigger>
              <SelectContent>
                {tenants.map((t) => (
                  <SelectItem key={t.slug} value={t.slug}>
                    <span className="font-medium">{t.name}</span>
                    <span className="ml-2 text-[11px] text-muted-foreground">({t.plan})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Autonomy badge */}
          {autonomy && (
            <Badge variant="outline" className="h-9 gap-1.5 px-2.5" title="Autonomy level (Section 22)">
              <Shield className="size-3.5 text-emerald-600" />
              <span className="text-xs">L{autonomy.autonomyLevel}</span>
              <span className="text-[11px] text-muted-foreground hidden md:inline">
                {autonomy.levels.find((l) => l.level === autonomy.autonomyLevel)?.label}
              </span>
            </Badge>
          )}

          {/* Auth */}
          <AuthModal user={sessionUser} onSessionChange={fetchSession} />
        </div>

        {/* Tabs */}
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="bg-transparent h-auto p-0 overflow-x-auto w-full justify-start rounded-none border-b-0">
              {visibleTabs.map((t) => {
                const Icon = t.icon
                return (
                  <TabsTrigger
                    key={t.id}
                    value={t.id}
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-3 sm:px-4 py-2.5 text-xs sm:text-sm gap-1.5 shrink-0"
                  >
                    <Icon className="size-3.5" />
                    {t.label}
                  </TabsTrigger>
                )
              })}
            </TabsList>
          </Tabs>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 mx-auto w-full max-w-[1400px] px-4 sm:px-6 py-6">
        {dashQ.isLoading && <LoadingSkeleton />}
        {dashQ.error && <ErrorBlock message={String(dashQ.error)} />}
        {dash && (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsContent value="overview" className="mt-0">
              <OverviewTab tenant={tenant} dash={dash} autonomy={autonomy} onSetAutonomy={setAutonomyLevel} />
            </TabsContent>
            <TabsContent value="data" className="mt-0">
              <DataTab tenant={tenant} dash={dash} />
            </TabsContent>
            <TabsContent value="evidence" className="mt-0">
              <EvidenceTab tenant={tenant} />
            </TabsContent>
            <TabsContent value="experiments" className="mt-0">
              <ExperimentsTab tenant={tenant} />
            </TabsContent>
            <TabsContent value="recommendations" className="mt-0">
              <RecommendationsTab tenant={tenant} />
            </TabsContent>
            <TabsContent value="decisions" className="mt-0">
              <DecisionsTab tenant={tenant} />
            </TabsContent>
            <TabsContent value="agent" className="mt-0">
              <AgentTab tenant={tenant} />
            </TabsContent>
            <TabsContent value="growth" className="mt-0">
              <GrowthTab tenant={tenant} />
            </TabsContent>
            {sessionUser?.isAdmin && (
              <TabsContent value="admin" className="mt-0">
                <AdminTab tenant={tenant} />
              </TabsContent>
            )}
          </Tabs>
        )}
      </main>

      {/* Sticky footer — closed-loop + isolation status */}
      <footer className="mt-auto border-t bg-background">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] sm:text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-amber-600" />
            <span className="font-medium text-foreground">Closed loop:</span>
            <ClosedLoop />
          </div>
          <div className="hidden md:flex items-center gap-1.5">
            <Shield className="size-3.5 text-emerald-600" />
            <span>Tenant isolation: enforced via AsyncLocalStorage + repository guard</span>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-3">
            {dash && (
              <span className="flex items-center gap-1">
                <Activity className="size-3.5 text-emerald-600" />
                {dash.metrics.eventCount} events · {dash.metrics.rawRecordCount} raw records
              </span>
            )}
            <span className="flex items-center gap-1">
              <GitFork className="size-3.5" />
              v0.1 · MVP slice
            </span>
          </div>
        </div>
      </footer>
    </div>
  )
}

function ClosedLoop() {
  const steps = ['Market', 'Customer', 'Hypothesis', 'Experiment', 'Measure', 'Causal', 'Decision', 'Outcome', 'Learn']
  return (
    <span className="hidden lg:inline-flex items-center gap-1">
      {steps.map((s, i) => (
        <span key={s} className="inline-flex items-center gap-1">
          <span className={i === 6 ? 'font-semibold text-foreground' : ''}>{s}</span>
          {i < steps.length - 1 && <span className="text-muted-foreground/50">→</span>}
        </span>
      ))}
    </span>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-28 rounded-xl bg-muted animate-pulse" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-40 rounded-xl bg-muted animate-pulse" />
        ))}
      </div>
    </div>
  )
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm">
      <div className="font-medium text-destructive">Failed to load dashboard</div>
      <div className="mt-1 text-muted-foreground text-xs font-mono break-all">{message}</div>
    </div>
  )
}
