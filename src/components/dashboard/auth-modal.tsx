'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { signIn, signOut } from 'next-auth/react'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { LogIn, LogOut, Mail, Shield, UserPlus, Users } from 'lucide-react'

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

interface Props {
  user: SessionUser | null
  onSessionChange: () => void
}

const DEMO_ACCOUNTS = [
  { email: 'demo.acme@mdip.demo', password: 'Demo1234!', label: 'Acme Marketer', role: 'marketer', tenant: 'acme' },
  { email: 'demo.cmo@mdip.demo', password: 'Demo1234!', label: 'Acme CMO', role: 'cmo', tenant: 'acme' },
  { email: 'demo.nova@mdip.demo', password: 'Demo1234!', label: 'Nova Marketer', role: 'marketer', tenant: 'nova' },
  { email: 'demo.admin@mdip.demo', password: 'Demo1234!', label: 'Demo Admin', role: 'admin', tenant: null },
]

export function AuthModal({ user, onSessionChange }: Props) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const qc = useQueryClient()

  async function handleLogin(emailToUse?: string, passToUse?: string) {
    const e = emailToUse ?? email
    const p = passToUse ?? password
    if (!e || !p) {
      toast.error('Email and password are required')
      return
    }
    setLoading(true)
    const t = toast.loading('Signing in…')
    try {
      const res = await signIn('credentials', {
        email: e,
        password: p,
        redirect: false,
      })
      if (res?.error) {
        toast.error('Invalid credentials', { id: t })
      } else {
        toast.success('Signed in', { id: t })
        setOpen(false)
        setEmail('')
        setPassword('')
        onSessionChange()
        qc.invalidateQueries()
      }
    } catch (err) {
      toast.error(String(err).slice(0, 120), { id: t })
    } finally {
      setLoading(false)
    }
  }

  async function handleSignup() {
    if (!email || !password || !name) {
      toast.error('All fields are required')
      return
    }
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    setLoading(true)
    const t = toast.loading('Adding to waitlist…')
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, password, requestedRole: 'marketer' }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Signup failed', { id: t })
      } else {
        toast.success(data.message || 'Added to waitlist!', { id: t })
        setOpen(false)
        setEmail('')
        setPassword('')
        setName('')
      }
    } catch (err) {
      toast.error(String(err).slice(0, 120), { id: t })
    } finally {
      setLoading(false)
    }
  }

  async function handleLogout() {
    const t = toast.loading('Signing out…')
    await signOut({ redirect: false })
    toast.success('Signed out', { id: t })
    onSessionChange()
    qc.invalidateQueries()
  }

  // Logged in state
  if (user) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted text-xs">
          <Mail className="size-3 text-muted-foreground" />
          <span className="font-medium max-w-[120px] truncate">{user.name || user.email}</span>
          {user.isDemo && <Badge variant="outline" className="text-[9px] h-4 px-1 ml-1">DEMO</Badge>}
          {user.isAdmin && <Badge variant="outline" className="text-[9px] h-4 px-1 ml-1 bg-emerald-50 text-emerald-700 border-emerald-300">ADMIN</Badge>}
        </div>
        <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs" onClick={handleLogout}>
          <LogOut className="size-3.5" />
          <span className="hidden sm:inline">Sign out</span>
        </Button>
      </div>
    )
  }

  // Logged out state
  return (
    <>
      <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs" onClick={() => { setMode('login'); setOpen(true) }}>
        <LogIn className="size-3.5" />
        <span className="hidden sm:inline">Sign in</span>
      </Button>
      <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => { setMode('signup'); setOpen(true) }}>
        <UserPlus className="size-3.5" />
        <span className="hidden sm:inline">Sign up</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{mode === 'login' ? 'Sign in' : 'Join the waitlist'}</DialogTitle>
            <DialogDescription>
              {mode === 'login'
                ? 'Sign in to your Marketing Decision Intelligence account.'
                : 'New sign-ups are reviewed by an administrator before accounts are created.'}
            </DialogDescription>
          </DialogHeader>

          <Tabs value={mode} onValueChange={(v) => setMode(v as 'login' | 'signup')}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login" className="text-xs gap-1.5"><LogIn className="size-3" /> Login</TabsTrigger>
              <TabsTrigger value="signup" className="text-xs gap-1.5"><UserPlus className="size-3" /> Sign up</TabsTrigger>
            </TabsList>

            {/* Login */}
            <TabsContent value="login" className="space-y-3 mt-4">
              <div>
                <Label className="text-xs">Email</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  placeholder="you@example.com"
                  className="h-9 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Password</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  placeholder="••••••••"
                  className="h-9 text-sm"
                />
              </div>
              <Button className="w-full" disabled={loading} onClick={() => handleLogin()}>
                {loading ? 'Signing in…' : 'Sign in'}
              </Button>

              {/* Quick login for demo accounts */}
              <div className="pt-3 border-t">
                <div className="text-[11px] text-muted-foreground mb-2 flex items-center gap-1">
                  <Users className="size-3" /> Quick login (demo accounts)
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {DEMO_ACCOUNTS.map((a) => (
                    <Button
                      key={a.email}
                      variant="outline"
                      size="sm"
                      className="h-7 text-[10px] justify-start gap-1"
                      disabled={loading}
                      onClick={() => handleLogin(a.email, a.password)}
                    >
                      <Shield className="size-2.5 text-emerald-600" />
                      {a.label}
                    </Button>
                  ))}
                </div>
                <div className="text-[10px] text-muted-foreground mt-1.5">
                  All demo passwords: <code className="font-mono">Demo1234!</code>
                </div>
              </div>
            </TabsContent>

            {/* Signup */}
            <TabsContent value="signup" className="space-y-3 mt-4">
              <div>
                <Label className="text-xs">Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="h-9 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Email</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="h-9 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Password (min 8 characters)</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="h-9 text-sm"
                />
              </div>
              <Button className="w-full" disabled={loading} onClick={handleSignup}>
                {loading ? 'Adding to waitlist…' : 'Join the waitlist'}
              </Button>
              <div className="text-[11px] text-muted-foreground text-center">
                An administrator will review your request and create your account.
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  )
}
