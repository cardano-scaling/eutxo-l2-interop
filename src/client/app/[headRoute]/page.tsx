'use client'

import { use, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { hydraHeads } from '@/lib/config'
import HtlcSenderForm from '@/components/htlc/htlc-sender-form'
import HtlcUtxosList from '@/components/htlc/htlc-utxos-list'
import { formatId } from '@/lib/utils'
import { useCurrentUser } from '@/lib/use-current-user'
import { useUtxos } from '@/lib/use-utxos'

interface PageProps {
  params: Promise<{ headRoute: string }>
}

export default function HeadDashboardPage({ params }: PageProps) {
  const { headRoute } = use(params)
  const headConfig = hydraHeads.find((head) => head.route === headRoute)
  const { currentUserVkHash, currentUser } = useCurrentUser()
  const { data: utxos = [], isLoading, error } = useUtxos(headRoute)
  const queryClient = useQueryClient()
  const [claiming, setClaiming] = useState<string | null>(null)

  if (!headConfig) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold mb-4">Head not found</h1>
        <p>Head route &quot;{headRoute}&quot; not found.</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <p>Loading UTXOs...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold mb-4 text-red-600">Error</h1>
        <p>Failed to load UTXOs: {error instanceof Error ? error.message : String(error)}</p>
      </div>
    )
  }

  const handleClaim = async (utxoId: string, preimage?: string) => {
    if (!preimage) {
      // Vesting claim - will be implemented separately
      console.log('Vesting claim not yet implemented:', utxoId)
      return
    }

    setClaiming(utxoId)
    try {
      const response = await fetch(`/api/hydra/${headRoute}/htlc/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          utxoId,
          preimage,
          claimerName: currentUser,
        }),
      })

      const contentType = response.headers.get('content-type')
      let data
      if (contentType && contentType.includes('application/json')) {
        data = await response.json()
      } else {
        const text = await response.text()
        throw new Error(`Server error: ${text || response.statusText}`)
      }

      if (!response.ok) {
        const errorMsg = data.error || data.details || 'Failed to claim HTLC'
        const fullErrorMsg = data.details ? `${data.error || 'Failed to claim HTLC'}: ${data.details}` : errorMsg
        throw new Error(fullErrorMsg)
      }

      // Refresh UTXO list after successful claim
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['utxos', headRoute] })
      }, 2000)
    } catch (err) {
      console.error('Error claiming HTLC:', err)
      alert(err instanceof Error ? err.message : 'Failed to claim HTLC')
    } finally {
      setClaiming(null)
    }
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
          onRecipientChange={(recipientName, recipientAddress) => {
            // Recipient name and address are provided
            // You'll use this when building the HTLC transaction
            console.log('Recipient selected:', recipientName, 'Address:', recipientAddress)
          }}
        />

        {/* Right Panel - HTLC UTXOs List */}
        <HtlcUtxosList
          utxos={utxos}
          currentUserVkeyHash={currentUserVkHash}
          onClaim={handleClaim}
          onRefund={handleRefund}
          claimingUtxoId={claiming}
        />
      </div>
    </div>
  )
}
