'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { getHydraHeads, getSelectedTopology } from '@/lib/config'
import { getTopologyConfig } from '@/lib/topologies'
import UserSwitcher from './user/user-switcher'
import GeneratePreimageDialog from './htlc/generate-preimage-dialog'
import PaymentStepper from './payment/payment-stepper'
import { TopologySelector } from './topology-selector'
import { Button } from './ui/button'
import { useCurrentUser } from '@/lib/use-current-user'
import { usePayment } from '@/contexts/payment-context'
import { type UserName } from '@/lib/users'
import { cn } from '@/lib/utils'
import { X, Network, WandSparkles } from 'lucide-react'

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
  jon: {
    bg: 'bg-blue-50',
    border: 'border-blue-300',
    text: 'text-blue-700',
  },
}

export default function Sidebar() {
  const { currentUser } = useCurrentUser()
  const { paymentState, resetPayment } = usePayment()
  const [hydraHeads, setHydraHeads] = React.useState(getHydraHeads())
  const [topologyId, setTopologyId] = React.useState(getSelectedTopology())
  const [topologyDialogOpen, setTopologyDialogOpen] = React.useState(false)

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
  

  const colors = userColors[currentUser]
  return (
    <aside className={cn('w-64 p-4 border-r-4 flex flex-col h-screen', colors.bg, colors.border)}>
      <nav className="space-y-2 flex-shrink-0">
        <SidebarLink href="/" key="home">Hydra Heads</SidebarLink>
        <div className="border-t pt-2"></div>
        {hydraHeads.map((head) => (
          <SidebarLink key={head.route} href={`/${head.route}`}>
            {head.name}
          </SidebarLink>
        ))}
      </nav>

      {/* Payment Progress - shown when there's an active or completed payment */}
      <div className="border-t pt-2"></div>
      {paymentState && paymentState.steps.length > 0 && (
        <div className="flex-1 overflow-y-auto my-4 border-t border-b pt-4 pb-4 min-h-0">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-md font-semibold">Payment Progress</h3>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={resetPayment}
              title="Clear payment progress"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <PaymentStepper
            steps={paymentState.steps}
            currentStepIndex={paymentState.currentStepIndex}
          />
        </div>
      )}

      <div className="space-y-2 flex-shrink-0 mt-auto">
        <GeneratePreimageDialog>
          <Button
            variant="outline"
            className="w-full justify-start"
          >
            <WandSparkles className="mr-2 h-4 w-4" />
            Generate Preimage
          </Button>
        </GeneratePreimageDialog>
        <div className="border-t pt-2"></div>
        <UserSwitcher />
        <Button
          onClick={() => setTopologyDialogOpen(true)}
          variant="outline"
          className="w-full justify-start"
        >
          <Network className="mr-2 h-4 w-4" />
          {topologyId ? getTopologyConfig(topologyId).name : 'Select Topology'}
        </Button>
      </div>

      <TopologySelector
        open={topologyDialogOpen}
        onOpenChange={setTopologyDialogOpen}
        onValidSelection={(selectedTopologyId) => {
          setTopologyId(selectedTopologyId)
          setHydraHeads(getHydraHeads())
          setTopologyDialogOpen(false)
        }}
        nonDismissible={false}
      />
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
      className={cn(
        'block px-3 py-2 rounded font-medium',
        isActive
          ? 'text-blue-600 bg-blue-50'
          : 'hover:bg-muted'
      )}
    >
      {children}
    </Link>
  )
}
