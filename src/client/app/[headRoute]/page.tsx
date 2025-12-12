'use client'

import { use } from 'react'
import { hydraHeads, type HydraHeadConfig } from '@/lib/config'
import HtlcSenderForm from '@/components/htlc/htlc-sender-form'
import HtlcUtxosList from '@/components/htlc/htlc-utxos-list'
import { HtlcUtxoItem } from '@/components/htlc/htlc-utxo-item'
import { formatId } from '@/lib/utils'

interface PageProps {
  params: Promise<{ headRoute: string }>
}

export default function HeadDashboardPage({ params }: PageProps) {
  const { headRoute } = use(params)
  const headConfig = hydraHeads.find((head) => head.route === headRoute)

  if (!headConfig) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold mb-4">Head not found</h1>
        <p>Head route &quot;{headRoute}&quot; not found.</p>
      </div>
    )
  }

  // Mock data - you'll replace this with actual data from your Hydra provider
  const mockAllHeadsInfo = hydraHeads.map((head) => ({
    name: head.name,
    route: head.route,
    headId: head.headId,
    headSeed: head.headSeed,
    tag: 'Open' as const,
  }))

  const mockUtxos: HtlcUtxoItem[] = [
    // Add mock UTXOs here for testing
    {
      id: 'tx1#0',
      hash: 'abc123...',
      timeout: Date.now() + 3600000,
      from: 'from_address...',
      to: 'to_address...',
      amountAda: 10,
    },
  ]

  const currentUserVkeyHash = undefined // You'll set this from your user context

  const handleClaim = (txHash: string) => {
    console.log('Claim HTLC:', txHash)
    // Your claim logic
  }

  const handleRefund = (txHash: string) => {
    console.log('Refund HTLC:', txHash)
    // Your refund logic
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="border-b border-border bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="text-sm text-muted-foreground">
              <p>{headConfig.name}</p>
              <p className="font-mono">ID: {formatId(headConfig.headId)}</p>
              <p className="font-mono">Seed: {formatId(headConfig.headSeed)}</p>
            </div>
          </div>
        </div>
      </header>

      {/* Content Grid */}
      <div className="flex-1 flex gap-6 p-6 overflow-hidden">
        {/* Left Panel - HTLC Sender Form */}
        <HtlcSenderForm
          currentHeadId={headConfig.headId}
          allHeadsInfo={mockAllHeadsInfo}
        />

        {/* Right Panel - HTLC UTXOs List */}
        <HtlcUtxosList
          utxos={mockUtxos}
          currentUserVkeyHash={currentUserVkeyHash}
          onClaim={handleClaim}
          onRefund={handleRefund}
        />
      </div>
    </div>
  )
}
