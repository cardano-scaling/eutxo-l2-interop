'use client'

import { use, useState, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { hydraHeads } from '@/lib/config'
import HtlcSenderForm from '@/components/htlc/htlc-sender-form'
import UtxosList from '@/components/htlc/utxos-list'
import { formatId } from '@/lib/utils'
import { useCurrentUser } from '@/lib/use-current-user'
import { useUtxos } from '@/lib/use-utxos'
import type { UtxoItem } from '@/components/htlc/utxo-item'

interface PageProps {
  params: Promise<{ headRoute: string }>
}

export default function HeadDashboardPage({ params }: PageProps) {
  const { headRoute } = use(params)
  const headConfig = hydraHeads.find((head) => head.route === headRoute)
  const { currentUserVkHash, currentUser } = useCurrentUser()
  const [pauseRefetch, setPauseRefetch] = useState(false)
  const [pauseRefetchForTx, setPauseRefetchForTx] = useState(false)
  const { data: utxos = [], isLoading, error } = useUtxos(headRoute, pauseRefetch || pauseRefetchForTx)
  const queryClient = useQueryClient()
  const [claiming, setClaiming] = useState<string | null>(null)
  const [claimedUtxoIds, setClaimedUtxoIds] = useState<Set<string>>(new Set())
  const [claimedUtxoCache, setClaimedUtxoCache] = useState<Record<string, UtxoItem>>({})
  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null)

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
        <p>Loading...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold mb-4 text-red-600">Error</h1>
        <p>Failed to load: {error instanceof Error ? error.message : String(error)}</p>
      </div>
    )
  }

  const handleClaim = async (utxoId: string, preimage?: string) => {
    setClaiming(utxoId)
    try {
      // Determine if this is a vesting or HTLC claim based on preimage
      const isVestingClaim = !preimage
      const endpoint = isVestingClaim 
        ? `/api/hydra/${headRoute}/vesting/claim`
        : `/api/hydra/${headRoute}/htlc/claim`

      const requestBody: any = {
        utxoId,
        claimerName: currentUser,
      }

      // Only add preimage for HTLC claims
      if (!isVestingClaim) {
        requestBody.preimage = preimage
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
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
        const errorMsg = data.error || data.details || `Failed to claim ${isVestingClaim ? 'vesting' : 'HTLC'}`
        const fullErrorMsg = data.details ? `${data.error || `Failed to claim ${isVestingClaim ? 'vesting' : 'HTLC'}`}: ${data.details}` : errorMsg
        throw new Error(fullErrorMsg)
      }

      // Mark this UTXO as claimed to keep it in the list even after refresh
      setClaimedUtxoIds((prev) => new Set(prev).add(utxoId))
      // Cache the claimed UTXO so the dialog/component stays mounted even if it disappears from the next fetch
      const currentItem = utxos.find((u) => u.id === utxoId)
      if (currentItem) {
        setClaimedUtxoCache((prev) => ({ ...prev, [utxoId]: currentItem }))
      }

      // Pause automatic refetching to prevent dialog from closing
      setPauseRefetch(true)

      // Clear any existing timeout
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current)
      }

      // Invalidate queries immediately to update the list (like lock does)
      // The dialog will stay open showing "Success" message
      // If user closes dialog, onDialogClose will refresh again and cancel this timeout
      queryClient.invalidateQueries({ queryKey: ['utxos', headRoute] })
      
      // Set timeout to clean up claimed state after dialog would have closed naturally
      // This ensures the claimed UTXO is removed from cache if user doesn't close dialog
      refreshTimeoutRef.current = setTimeout(() => {
        // Resume refetching after a delay
        setTimeout(() => {
          setPauseRefetch(false)
          // Remove from claimed set after dialog would have closed naturally
          setClaimedUtxoIds((prev) => {
            const next = new Set(prev)
            next.delete(utxoId)
            return next
          })
          setClaimedUtxoCache((prev) => {
            const { [utxoId]: _, ...rest } = prev
            return rest
          })
        }, 5000)
      }, 10000) // 10 seconds delay - gives user time to see success and close dialog
    } catch (err) {
      console.error(`Error claiming ${preimage ? 'HTLC' : 'vesting'}:`, err)
      // Re-throw error so dialog can display it
      throw err
    } finally {
      setClaiming(null)
    }
  }

  const handleRefund = async (utxoId: string) => {
    setClaiming(utxoId)
    try {
      const response = await fetch(`/api/hydra/${headRoute}/htlc/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          utxoId,
          senderName: currentUser,
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
        const errorMsg = data.error || data.details || 'Failed to refund HTLC'
        const fullErrorMsg = data.details ? `${data.error || 'Failed to refund HTLC'}: ${data.details}` : errorMsg
        throw new Error(fullErrorMsg)
      }

      // Mark this UTXO as refunded to keep it in the list even after refresh
      setClaimedUtxoIds((prev) => new Set(prev).add(utxoId))
      // Cache the refunded UTXO so the dialog/component stays mounted even if it disappears from the next fetch
      const currentItem = utxos.find((u) => u.id === utxoId)
      if (currentItem) {
        setClaimedUtxoCache((prev) => ({ ...prev, [utxoId]: currentItem }))
      }

      // Pause automatic refetching to prevent dialog from closing
      setPauseRefetch(true)

      // Clear any existing timeout
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current)
      }

      // Invalidate queries immediately to update the list (like lock does)
      // The dialog will stay open showing "Success" message
      // If user closes dialog, onDialogClose will refresh again and cancel this timeout
      queryClient.invalidateQueries({ queryKey: ['utxos', headRoute] })
      
      // Set timeout to clean up refunded state after dialog would have closed naturally
      refreshTimeoutRef.current = setTimeout(() => {
        // Resume refetching after a delay
        setTimeout(() => {
          setPauseRefetch(false)
          // Remove from claimed set after dialog would have closed naturally
          setClaimedUtxoIds((prev) => {
            const next = new Set(prev)
            next.delete(utxoId)
            return next
          })
          setClaimedUtxoCache((prev) => {
            const { [utxoId]: _, ...rest } = prev
            return rest
          })
        }, 5000)
      }, 10000) // 10 seconds delay - gives user time to see success and close dialog
    } catch (err) {
      console.error('Error refunding HTLC:', err)
      // Re-throw error so dialog can display it
      throw err
    } finally {
      setClaiming(null)
    }
  }

  const handleDialogClose = () => {
    // Cancel the delayed refresh timeout since user closed dialog manually
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current)
      refreshTimeoutRef.current = null
    }
    // When dialog closes after a successful claim, refresh immediately
    queryClient.invalidateQueries({ queryKey: ['utxos', headRoute] })
    setPauseRefetch(false) // Resume automatic refetching
    // Clear claimed UTXO IDs
    setClaimedUtxoIds(new Set())
    setClaimedUtxoCache({})
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
          onSubmissionStart={() => setPauseRefetchForTx(true)}
          onSubmissionEnd={() => setPauseRefetchForTx(false)}
        />

        {/* Right Panel - UTXOs List */}
        <UtxosList
          utxos={utxos}
          currentUserVkeyHash={currentUserVkHash}
          currentUserName={currentUser}
          onClaim={handleClaim}
          onRefund={handleRefund}
          claimingUtxoId={claiming}
          refundingUtxoId={claiming}
          claimedUtxoIds={claimedUtxoIds}
          claimedUtxoCache={claimedUtxoCache}
          onDialogClose={handleDialogClose}
        />
      </div>
    </div>
  )
}
