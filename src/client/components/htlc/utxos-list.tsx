'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import UtxoItemCard, { type UtxoItem } from './utxo-item'

interface UtxosListProps {
  utxos: UtxoItem[]
  currentUserVkeyHash?: string
  currentUserName?: string
  onClaim?: (utxoId: string, preimage?: string) => Promise<void>
  onRefund?: (txHash: string) => void
  claimingUtxoId?: string | null
  claimedUtxoIds?: Set<string>
  claimedUtxoCache?: Record<string, UtxoItem>
  onDialogClose?: () => void
}

export default function UtxosList({
  utxos,
  currentUserVkeyHash,
  currentUserName,
  onClaim,
  onRefund,
  claimingUtxoId,
  claimedUtxoIds = new Set(),
  claimedUtxoCache = {},
  onDialogClose,
}: UtxosListProps) {
  const [showAssociatedOnly, setShowAssociatedOnly] = useState(false)

  // Keep claimed UTXOs in the list even if they disappear from the API response
  // Use cached copy to prevent dialog unmounting after a successful claim
  const utxosWithClaimed = [...utxos]
  claimedUtxoIds.forEach((claimedId) => {
    if (!utxosWithClaimed.find((u) => u.id === claimedId) && claimedUtxoCache[claimedId]) {
      utxosWithClaimed.push(claimedUtxoCache[claimedId])
    }
  })

  const filteredUtxos = utxosWithClaimed.filter((utxo) => {
    if (!showAssociatedOnly) return true
    
    // Show UTXOs associated with current user:
    // - User UTXOs where I'm the owner
    // - Contract UTXOs where I'm the receiver
    if (utxo.type === 'user') {
      return currentUserName && utxo.owner === currentUserName
    } else {
      // HTLC or Vesting: show if I'm the receiver
      return currentUserVkeyHash && utxo.to === currentUserVkeyHash
    }
  })

  // Sort: contract UTXOs by timeout descending, user UTXOs by amount descending
  const sortedUtxos = [...filteredUtxos].sort((a, b) => {
    if (a.type === 'user' && b.type === 'user') {
      return b.amountAda - a.amountAda
    }
    if (a.type === 'user') return 1 // User UTXOs at the end
    if (b.type === 'user') return -1
    // Both are contracts, sort by timeout
    const timeoutA = a.timeout || 0
    const timeoutB = b.timeout || 0
    return timeoutB - timeoutA
  })

  return (
    <Card className="flex flex-col overflow-hidden min-w-[480px] h-full">
      <CardHeader className="p-0 flex-shrink-0">
        <CardTitle className="text-center bg-primary text-primary-foreground rounded-t-lg p-4">
          UTxOs ({filteredUtxos.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto p-4 min-h-0">
        <div className="mb-4">
          <TooltipProvider>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="filter-associated"
                checked={showAssociatedOnly}
                onCheckedChange={(checked) => setShowAssociatedOnly(checked === true)}
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Label
                    htmlFor="filter-associated"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                  >
                   Associated UTxOs
                  </Label>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Includes UTxOs owned by you or linked through contracts.</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        </div>
        <div className="space-y-4">
          {sortedUtxos.length > 0 ? (
            sortedUtxos.map((item) => (
              <UtxoItemCard
                key={item.id}
                item={item}
                currentUserVkeyHash={currentUserVkeyHash}
                currentUserName={currentUserName}
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
