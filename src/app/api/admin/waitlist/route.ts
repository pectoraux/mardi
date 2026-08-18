import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { invalidateTenantCache } from '@/lib/tenant-context'

// GET /api/admin/waitlist — list waitlist entries (admin only)
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || !(session.user as { isAdmin?: boolean }).isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const entries = await db.waitlistEntry.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  return NextResponse.json({
    entries: entries.map((e) => ({
      id: e.id,
      email: e.email,
      name: e.name,
      requestedRole: e.requestedRole,
      tenantSlug: e.tenantSlug,
      status: e.status,
      createdAt: e.createdAt,
      reviewedAt: e.reviewedAt,
      createdUserId: e.createdUserId,
    })),
  })
}

// POST /api/admin/waitlist — approve or reject (admin only)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || !(session.user as { isAdmin?: boolean }).isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({}))
  const { entryId, action, tenantId } = (body ?? {}) as {
    entryId?: string; action?: 'approve' | 'reject'; tenantId?: string
  }
  if (!entryId || !action) {
    return NextResponse.json({ error: 'entryId and action required' }, { status: 400 })
  }

  const entry = await db.waitlistEntry.findUnique({ where: { id: entryId } })
  if (!entry) return NextResponse.json({ error: 'entry not found' }, { status: 404 })
  if (entry.status !== 'pending') {
    return NextResponse.json({ error: `entry already ${entry.status}` }, { status: 400 })
  }

  const adminId = (session.user as { id?: string }).id

  if (action === 'reject') {
    const updated = await db.waitlistEntry.update({
      where: { id: entryId },
      data: { status: 'rejected', reviewedBy: adminId, reviewedAt: new Date() },
    })
    return NextResponse.json({ ok: true, status: updated.status })
  }

  // Approve: create a User account from the waitlist entry
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId required to approve' }, { status: 400 })
  }

  // Verify tenant exists
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } })
  if (!tenant) return NextResponse.json({ error: 'tenant not found' }, { status: 404 })

  // Check email not already taken
  const existing = await db.user.findUnique({ where: { email: entry.email } })
  if (existing) {
    return NextResponse.json({ error: 'email already in use' }, { status: 409 })
  }

  const newUser = await db.user.create({
    data: {
      email: entry.email,
      name: entry.name,
      password: entry.password, // already hashed
      roles: entry.requestedRole,
      tenantId: tenantId,
      isDemo: false,
      isActive: true,
    },
  })

  await db.waitlistEntry.update({
    where: { id: entryId },
    data: {
      status: 'approved',
      reviewedBy: adminId,
      reviewedAt: new Date(),
      createdUserId: newUser.id,
    },
  })

  invalidateTenantCache()
  return NextResponse.json({ ok: true, userId: newUser.id, status: 'approved' })
}
