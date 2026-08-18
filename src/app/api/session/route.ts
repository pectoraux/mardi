import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

// GET /api/session — returns the current session state + default tenant slug
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ authenticated: false })
  }
  const u = session.user as {
    id?: string; email?: string; name?: string
    roles?: string; tenantId?: string; isDemo?: boolean; isAdmin?: boolean
  }

  let tenantSlug: string | null = null
  if (u.tenantId) {
    const tenant = await db.tenant.findUnique({ where: { id: u.tenantId } })
    tenantSlug = tenant?.slug ?? null
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      id: u.id,
      email: u.email,
      name: u.name,
      roles: u.roles?.split(',') ?? [],
      tenantId: u.tenantId,
      tenantSlug,
      isDemo: u.isDemo ?? false,
      isAdmin: u.isAdmin ?? false,
    },
  })
}
