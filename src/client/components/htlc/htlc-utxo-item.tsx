'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatId } from '@/lib/utils'
import { Copy } from 'lucide-react'
import { useState, useEffect } from 'react'
import UtxoDialog from './utxo-dialog'
import { useContractAddresses } from '@/lib/use-contract-addresses'

export type HtlcUtxoItem = {
  id: string
  hash: string
  timeout: number
  from: string
  to: string
  amountAda: number
  address: string // UTXO address to detect if it's HTLC or Vesting
}

interface HtlcUtxoItemProps {
  item: HtlcUtxoItem
  currentUserVkeyHash?: string
  onClaim?: (utxoId: string, preimage?: string) => Promise<void>
  onRefund?: (txHash: string) => void
  isClaiming?: boolean
  onDialogClose?: () => void
}

export default function HtlcUtxoItemCard({
  item,
  currentUserVkeyHash,
  onClaim,
  onRefund,
  isClaiming = false,
  onDialogClose,
}: HtlcUtxoItemProps) {
  const [currentTime, setCurrentTime] = useState(Date.now())
  const { data: contractAddresses } = useContractAddresses()

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now())
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const isTimeout = currentTime >= item.timeout
  const isVesting = contractAddresses ? item.address === contractAddresses.vestingContractAddress : false
  const isHtlc = contractAddresses ? item.address === contractAddresses.htlcContract.address : false

  const isYourAddress = (vkeyhash: string) => {
    return currentUserVkeyHash === vkeyhash
  }

  const canBeRefunded = (timeout: number) => {
    // Refund only for HTLC (not vesting)
    if (isVesting) return false
    return currentTime >= timeout + 1 * 60 * 1000 // add 1 minute buffer
  }

  const canBeClaimed = (timeout: number) => {
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

  const formatCountdown = (targetTime: number) => {
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
          isVesting ? 'border-l-4 border-l-purple-500' : ''
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
              </div>
            {isHtlc && (
              <div className="text-sm">
                <span className="text-muted-foreground">from:</span>
                <span className="font-mono ml-1">{formatId(item.from)}</span>
                {isYourAddress(item.from) && (
                  <span className="text-sm text-gray-400 ml-1">(you)</span>
                )}
              </div>
            )}
            <div className="text-sm">
              <span className="text-muted-foreground">to:</span>
              <span className="font-mono ml-1">{formatId(item.to)}</span>
              {isYourAddress(item.to) && (
                <span className="text-sm text-gray-400 ml-1">(you)</span>
              )}
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">amount:</span>
              <span className="font-mono ml-1">{item.amountAda} ADA</span>
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">timeout:</span>
              <span className="font-mono ml-1">{formatDate(item.timeout)}</span>
            </div>
            {isHtlc && (
              <div className="text-sm">
                <span className="text-muted-foreground">hash:</span>
                <span className="font-mono ml-1">
                  {formatId(item.hash, 8, 8)}
                  <Copy
                    className="inline-block cursor-pointer -mb-0.5 ml-1 h-3.5 w-3.5"
                    onClick={() => copyToClipboard(item.hash)}
                  />
                </span>
              </div>
            )}
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
          </div>
        </div>
      </CardContent>
    </Card>
    </UtxoDialog>
  )
}
