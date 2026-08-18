// =============================================================================
// NextAuth configuration — credentials provider with bcrypt password check
// =============================================================================
// Session strategy: JWT (stateless, works on Vercel serverless).
// The JWT carries: userId, email, name, roles, tenantId, isDemo, isAdmin.
// These are exposed on the session object for the client + middleware.

import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { db } from './db'
import { invalidateTenantCache } from './tenant-context'

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null
        const email = credentials.email.toLowerCase().trim()
        const user = await db.user.findUnique({ where: { email } })
        if (!user || !user.password || !user.isActive) return null
        const ok = await bcrypt.compare(credentials.password, user.password)
        if (!ok) return null
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          roles: user.roles,
          tenantId: user.tenantId ?? undefined,
          isDemo: user.isDemo,
        } as unknown as { id: string; email: string; name: string }
      },
    }),
  ],
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 }, // 30 days
  jwt: {
    secret: process.env.NEXTAUTH_SECRET,
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const u = user as unknown as {
          id: string; email: string; name: string
          roles: string; tenantId?: string; isDemo: boolean
        }
        token.uid = u.id
        token.roles = u.roles
        token.tenantId = u.tenantId
        token.isDemo = u.isDemo
        token.isAdmin = u.roles.split(',').includes('admin')
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        ;(session.user as unknown as Record<string, unknown>).id = token.uid
        ;(session.user as unknown as Record<string, unknown>).roles = token.roles
        ;(session.user as unknown as Record<string, unknown>).tenantId = token.tenantId
        ;(session.user as unknown as Record<string, unknown>).isDemo = token.isDemo
        ;(session.user as unknown as Record<string, unknown>).isAdmin = token.isAdmin
      }
      return session
    },
  },
  pages: {
    // We use a modal on the home page, but NextAuth needs a sign-in page
    // fallback. We override to '/' so it redirects home.
    signIn: '/',
  },
}

// Helper: get the session's tenant slug (if the user has one).
export async function getSessionTenantSlug(
  session: { user?: { tenantId?: string; isAdmin?: boolean; roles?: string } } | null
): Promise<string | null> {
  if (!session?.user?.tenantId) return null
  const tenant = await db.tenant.findUnique({ where: { id: session.user.tenantId } })
  return tenant?.slug ?? null
}

// Re-export for convenience
export { invalidateTenantCache }
