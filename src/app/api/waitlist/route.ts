import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'

// POST /api/waitlist — sign up (adds to waitlist, no account created yet)
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { email, name, password, requestedRole, tenantSlug } = (body ?? {}) as {
    email?: string; name?: string; password?: string
    requestedRole?: string; tenantSlug?: string
  }
  if (!email || !name || !password) {
    return NextResponse.json({ error: 'email, name, and password are required' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'password must be at least 8 characters' }, { status: 400 })
  }
  const normalizedEmail = email.toLowerCase().trim()

  // Check if email already exists as a user or waitlist entry
  const existingUser = await db.user.findUnique({ where: { email: normalizedEmail } })
  if (existingUser) {
    return NextResponse.json({ error: 'an account with this email already exists' }, { status: 409 })
  }
  const existingWait = await db.waitlistEntry.findUnique({ where: { email: normalizedEmail } })
  if (existingWait) {
    return NextResponse.json({ error: 'you are already on the waitlist', status: existingWait.status }, { status: 409 })
  }

  const hash = await bcrypt.hash(password, 12)
  const entry = await db.waitlistEntry.create({
    data: {
      email: normalizedEmail,
      name,
      password: hash,
      requestedRole: requestedRole ?? 'marketer',
      tenantSlug: tenantSlug ?? null,
      status: 'pending',
    },
  })

  return NextResponse.json({
    ok: true,
    id: entry.id,
    status: 'pending',
    message: 'You have been added to the waitlist. An administrator will review your request.',
  })
}
