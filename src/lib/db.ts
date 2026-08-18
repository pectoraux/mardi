import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  prismaApp: PrismaClient | undefined
}

// Admin client — uses neondb_owner (BYPASSRLS). For migrations, seeds,
// and identity lookups that span tenants (User, Tenant, WaitlistEntry).
export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error', 'warn'],
  })

// App client — uses mardi_app (NOBYPASSRLS). For all tenant-scoped queries.
// RLS is enforced at the database level. Even if the application guard fails,
// the database rejects cross-tenant access.
function createAppClient(): PrismaClient {
  // If DATABASE_APP_URL is set, use it (production).
  // Otherwise, derive from DATABASE_URL by replacing credentials (sandbox).
  const appUrl = process.env.DATABASE_APP_URL
  if (appUrl) {
    return new PrismaClient({ datasources: { db: { url: appUrl } }, log: ['error', 'warn'] })
  }
  // Sandbox: derive from DATABASE_URL
  const baseUrl = process.env.DATABASE_URL ?? ''
  const derivedUrl = baseUrl.replace('neondb_owner:npg_DJpTREhY2N4U', 'mardi_app:MardiApp2025!')
  if (derivedUrl !== baseUrl) {
    return new PrismaClient({ datasources: { db: { url: derivedUrl } }, log: ['error', 'warn'] })
  }
  // Fallback: use the admin client (RLS not enforced — development only)
  console.warn('[db] WARNING: No app client configured — RLS not enforced. Set DATABASE_APP_URL for production.')
  return db
}

export const dbApp =
  globalForPrisma.prismaApp ?? createAppClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db
  globalForPrisma.prismaApp = dbApp
}
