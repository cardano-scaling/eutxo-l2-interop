'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { getHydraHeads, getSelectedTopology } from '@/lib/config'
import UserSwitcher from './user/user-switcher'
import GeneratePreimageDialog from './htlc/generate-preimage-dialog'
import { Button } from './ui/button'
import { useCurrentUser } from '@/lib/use-current-user'
import { type UserName } from '@/lib/users'

// Color scheme for each user
const userColors: Record<UserName, { bg: string; border: string; text: string }> = {
  alice: {
    bg: 'bg-red-50',
    border: 'border-red-300',
    text: 'text-red-700',
  },
  bob: {
    bg: 'bg-orange-50',
    border: 'border-orange-300',
    text: 'text-orange-700',
  },
  ida: {
    bg: 'bg-teal-50',
    border: 'border-teal-300',
    text: 'text-teal-700',
  },
  charlie: {
    bg: 'bg-green-50',
    border: 'border-green-300',
    text: 'text-green-700',
  },
}

export default function Sidebar() {
  const { currentUser } = useCurrentUser()
  const [hydraHeads, setHydraHeads] = React.useState(getHydraHeads())
  const [topologyId, setTopologyId] = React.useState(getSelectedTopology())

  // Listen for topology changes via storage events
  React.useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'hydra-topology') {
        const newTopologyId = getSelectedTopology()
        setTopologyId(newTopologyId)
        setHydraHeads(getHydraHeads())
      }
    }

    // Listen for storage events (from other tabs/windows)
    window.addEventListener('storage', handleStorageChange)

    // Also listen for custom events (from same window)
    const handleTopologyChange = () => {
      const newTopologyId = getSelectedTopology()
      setTopologyId(newTopologyId)
      setHydraHeads(getHydraHeads())
    }

    window.addEventListener('topology-changed', handleTopologyChange)

    // Poll for changes (fallback for same-origin localStorage changes)
    const interval = setInterval(() => {
      const currentTopologyId = getSelectedTopology()
      if (currentTopologyId !== topologyId) {
        setTopologyId(currentTopologyId)
        setHydraHeads(getHydraHeads())
      }
    }, 500)

    return () => {
      window.removeEventListener('storage', handleStorageChange)
      window.removeEventListener('topology-changed', handleTopologyChange)
      clearInterval(interval)
    }
  }, [topologyId])
  
  // Use white/neutral colors until user is explicitly known
  // Check if user was loaded from storage (not just default)
  const hasUserFromStorage = typeof window !== 'undefined' && sessionStorage.getItem('currentUser')
  const colors = hasUserFromStorage && currentUser ? userColors[currentUser] : { bg: 'bg-white', border: 'border-gray-200', text: 'text-gray-700' }

  return (
    <aside className={`w-64 p-4 border-r-4 ${colors.bg} ${colors.border} flex flex-col justify-between`}>
      <nav className="space-y-2">
        <SidebarLink href="/" key="home">Hydra Heads</SidebarLink>
        {hydraHeads.map((head) => (
          <SidebarLink key={head.route} href={`/${head.route}`}>
            {head.name}
          </SidebarLink>
        ))}
      </nav>
      <div className="space-y-2">
        <div className="border-t pt-2">
          <GeneratePreimageDialog>
            <Button
              variant="outline"
              className="w-full justify-start"
            >
              Generate Preimage
            </Button>
          </GeneratePreimageDialog>
        </div>
        <UserSwitcher />
      </div>
    </aside>
  )
}

function SidebarLink({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const isActive = pathname === href

  return (
    <Link
      href={href}
      className={`block px-3 py-2 rounded font-medium ${
        isActive
          ? 'text-blue-600 bg-blue-50'
          : 'hover:bg-muted'
      }`}
    >
      {children}
    </Link>
  )
}
