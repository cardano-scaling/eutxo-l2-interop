'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatId } from '@/lib/utils'
import { Copy } from 'lucide-react'
import { useState, useEffect } from 'react'
import UtxoDialog from './utxo-dialog'
import { useContractAddresses } from '@/lib/use-contract-addresses'

export type UtxoItem = {
  id: string
  amountAda: number
  address: string
  type: 'htlc' | 'vesting' | 'user' // Type of UTXO
  
  // Contract-specific fields (optional)
  hash?: string // HTLC only
  timeout?: number // HTLC and Vesting
  from?: string // HTLC only (vkHash)
  to?: string // HTLC and Vesting (vkHash)
  
  // User-specific fields (optional)
  owner?: string // User name (alice, bob, ida) for user UTXOs
  ownerVkHash?: string // vkHash for user UTXOs
}

// Keep old type name for backward compatibility during migration
export type HtlcUtxoItem = UtxoItem

interface UtxoItemProps {
  item: UtxoItem
  currentUserVkeyHash?: string
  onClaim?: (utxoId: string, preimage?: string) => Promise<void>
  onRefund?: (txHash: string) => void
  isClaiming?: boolean
  onDialogClose?: () => void
}

export default function UtxoItemCard({
  item,
  currentUserVkeyHash,
  onClaim,
  onRefund,
  isClaiming = false,
  onDialogClose,
}: UtxoItemProps) {
  const [currentTime, setCurrentTime] = useState(Date.now())
  const { data: contractAddresses } = useContractAddresses()

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now())
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const isTimeout = item.timeout ? currentTime >= item.timeout : false
  const isVesting = item.type === 'vesting'
  const isHtlc = item.type === 'htlc'
  const isUser = item.type === 'user'

  const isYourAddress = (vkeyhash: string) => {
    return currentUserVkeyHash === vkeyhash
  }

  const canBeRefunded = (timeout?: number) => {
    // Refund only for HTLC (not vesting or user)
    if (isVesting || isUser || !timeout) return false
    return currentTime >= timeout + 1 * 60 * 1000 // add 1 minute buffer
  }

  const canBeClaimed = (timeout?: number) => {
    // User UTXOs can't be claimed
    if (isUser || !timeout) return false
    
    if (isVesting) {
      // Vesting: claim button enabled AFTER timeout
      return currentTime >= timeout
    } else {
      // HTLC: claim button enabled until timeout (disabled after timeout)
      return currentTime <= timeout
    }
  }

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  const formatCountdown = (targetTime?: number) => {
    if (!targetTime) return 'N/A'
    const diff = targetTime - currentTime
    if (diff <= 0) {
      // For vesting, timeout means it's claimable (not expired)
      return isVesting ? 'Ready to claim' : 'Expired'
    }
    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)
    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`
    return `${seconds}s`
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  return (
    <UtxoDialog
      item={item}
      currentUserVkeyHash={currentUserVkeyHash}
      onClaim={onClaim}
      onRefund={onRefund}
      isClaiming={isClaiming}
      onClose={onDialogClose}
    >
      <Card
        className={`bg-muted cursor-pointer hover:shadow-md transition-shadow ${
          isVesting ? 'border-l-4 border-l-purple-500' : isUser ? 'border-l-4 border-l-green-500' : ''
        }`}
      >
        <CardContent className="p-4">
          <div className="flex justify-between items-start mb-2">
            <div className="space-y-1 flex-1">
              <div className="flex items-center gap-2">
                <div className="text-xs font-mono text-muted-foreground">
                  ID: {formatId(item.id, 12, 12)}
                </div>
                {isVesting && (
                  <span className="text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-700 font-medium">
                    Vesting
                  </span>
                )}
                {isHtlc && (
                  <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">
                    HTLC
                  </span>
                )}
                {isUser && (
                  <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700 font-medium">
                    User
                  </span>
                )}
              </div>
            {isUser ? (
              <>
                <div className="text-sm">
                  <span className="text-muted-foreground">owner:</span>
                  <span className="font-mono ml-1 capitalize">{item.owner}</span>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">amount:</span>
                  <span className="font-mono ml-1">{item.amountAda} ADA</span>
                </div>
              </>
            ) : (
              <>
                {isHtlc && item.from && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">from:</span>
                    <span className="font-mono ml-1">{formatId(item.from)}</span>
                    {isYourAddress(item.from) && (
                      <span className="text-sm text-gray-400 ml-1">(you)</span>
                    )}
                  </div>
                )}
                {item.to && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">to:</span>
                    <span className="font-mono ml-1">{formatId(item.to)}</span>
                    {isYourAddress(item.to) && (
                      <span className="text-sm text-gray-400 ml-1">(you)</span>
                    )}
                  </div>
                )}
                <div className="text-sm">
                  <span className="text-muted-foreground">amount:</span>
                  <span className="font-mono ml-1">{item.amountAda} ADA</span>
                </div>
                {item.timeout && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">timeout:</span>
                    <span className="font-mono ml-1">{formatDate(item.timeout)}</span>
                  </div>
                )}
                {isHtlc && item.hash && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">hash:</span>
                    <span className="font-mono ml-1">
                      {formatId(item.hash, 8, 8)}
                      <Copy
                        className="inline-block cursor-pointer -mb-0.5 ml-1 h-3.5 w-3.5"
                        onClick={() => copyToClipboard(item.hash!)}
                      />
                    </span>
                  </div>
                )}
                {item.timeout && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">remaining: </span>
                    <span
                      className={`text-sm font-mono ${
                        isTimeout && !isVesting ? 'text-destructive' : isTimeout && isVesting ? 'text-green-600' : ''
                      }`}
                    >
                      {formatCountdown(item.timeout)}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
    </UtxoDialog>
  )
}
