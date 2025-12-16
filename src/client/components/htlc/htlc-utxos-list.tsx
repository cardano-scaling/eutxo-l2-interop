'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import HtlcUtxoItemCard, { type HtlcUtxoItem } from './htlc-utxo-item'

interface HtlcUtxosListProps {
  utxos: HtlcUtxoItem[]
  currentUserVkeyHash?: string
  onClaim?: (utxoId: string, preimage?: string) => Promise<void>
  onRefund?: (txHash: string) => void
  claimingUtxoId?: string | null
  claimedUtxoIds?: Set<string>
  claimedUtxoCache?: Record<string, HtlcUtxoItem>
  onDialogClose?: () => void
}

export default function HtlcUtxosList({
  utxos,
  currentUserVkeyHash,
  onClaim,
  onRefund,
  claimingUtxoId,
  claimedUtxoIds = new Set(),
  claimedUtxoCache = {},
  onDialogClose,
}: HtlcUtxosListProps) {
  const [showOnlyMine, setShowOnlyMine] = useState(false)

  // Keep claimed UTXOs in the list even if they disappear from the API response
  // Use cached copy to prevent dialog unmounting after a successful claim
  const utxosWithClaimed = [...utxos]
  claimedUtxoIds.forEach((claimedId) => {
    if (!utxosWithClaimed.find((u) => u.id === claimedId) && claimedUtxoCache[claimedId]) {
      utxosWithClaimed.push(claimedUtxoCache[claimedId])
    }
  })

  const filteredUtxos = utxosWithClaimed.filter((utxo) => {
    if (!showOnlyMine) return true
    // Show only UTXOs where current user is the receiver
    return currentUserVkeyHash && utxo.to === currentUserVkeyHash
  })

  // Sort by timeout descending
  const sortedUtxos = [...filteredUtxos].sort(
    (a, b) => b.timeout - a.timeout
  )

  return (
    <Card className="flex flex-col overflow-hidden min-w-[480px] h-full">
      <CardHeader className="p-0 flex-shrink-0">
        <CardTitle className="text-center bg-primary text-primary-foreground rounded-t-lg p-4">
          HTLC & Vesting UTXOs ({filteredUtxos.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto p-4 min-h-0">
        <div className="mb-4">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="filter-mine"
              checked={showOnlyMine}
              onCheckedChange={(checked) => setShowOnlyMine(checked === true)}
            />
            <Label
              htmlFor="filter-mine"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
            >
              Show only the UTxOs where I'm the receiver
            </Label>
          </div>
        </div>
        <div className="space-y-4">
          {sortedUtxos.length > 0 ? (
            sortedUtxos.map((item) => (
              <HtlcUtxoItemCard
                key={item.id}
                item={item}
                currentUserVkeyHash={currentUserVkeyHash}
                onClaim={onClaim}
                onRefund={onRefund}
                isClaiming={claimingUtxoId === item.id}
                onDialogClose={onDialogClose}
              />
            ))
          ) : (
            <div className="text-center text-muted-foreground">
              No UTxOs found.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
