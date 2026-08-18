// =============================================================================
// Tenant middleware — establishes the immutable TenantContext (Section 4)
// =============================================================================
// Resolution order for the tenant slug:
//   1. ?tenant= query param (explicit override — works for demo/public)
//   2. x-tenant-id header
//   3. NextAuth session user's tenantId (if logged in)
//   4. default 'acme' (demo fallback)
//
// This keeps the app behaving identically whether or not the user is logged
// in: the tenant switcher always works, logged-in users get their own tenant
// by default but can still switch.

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import {
  buildContext,
  getTenantBySlug,
  TenantContext,
  withTenantContext,
} from './tenant-context'
import { authOptions } from './auth'
import { db } from './db'

export interface TenantRouteContext {
  ctx: TenantContext
}

export function withTenant<TArgs = unknown>(
  handler: (
    req: NextRequest,
    args: TArgs & TenantRouteContext
  ) => Promise<NextResponse> | NextResponse
) {
  return async (
    req: NextRequest,
    args: TArgs
  ): Promise<NextResponse> => {
    // 1. Check query param / header first (explicit override)
    let slug =
      req.headers.get('x-tenant-id') ??
      req.nextUrl.searchParams.get('tenant') ??
      null

    // 2. If no explicit override, check the session
    if (!slug) {
      try {
        const session = await getServerSession(authOptions)
        const u = session?.user as { tenantId?: string; isAdmin?: boolean } | undefined
        if (u?.tenantId) {
          const tenant = await db.tenant.findUnique({ where: { id: u.tenantId } })
          if (tenant) slug = tenant.slug
        }
      } catch {
        // Session check failed — fall through to default
      }
    }

    // 3. Default fallback
    if (!slug) slug = 'acme'

    const tenant = await getTenantBySlug(slug)
    if (!tenant) {
      return NextResponse.json(
        { error: `unknown tenant: ${slug}` },
        { status: 404 }
      )
    }

    // Determine roles from session (if available)
    let roles = ['marketer']
    let userId: string | undefined
    try {
      const session = await getServerSession(authOptions)
      if (session?.user) {
        const u = session.user as { roles?: string; id?: string }
        if (u.roles) roles = u.roles.split(',').filter(Boolean)
        if (u.id) userId = u.id
      }
    } catch {
      // ignore
    }

    const ctx = buildContext(tenant, { userId, roles })
    try {
      const out = await withTenantContext(ctx, () => handler(req, { ...args, ctx }))
      return out
    } catch (err) {
      const message = err instanceof Error ? err.message : 'internal error'
      const status =
        err instanceof Error && err.name === 'TenantIsolationViolation'
          ? 403
          : 500
      console.error('[withTenant] error', err)
      return NextResponse.json({ error: message }, { status })
    }
  }
}

/** Read the active TenantContext from a route handler (after withTenant). */
export { getTenantContext } from './tenant-context'
