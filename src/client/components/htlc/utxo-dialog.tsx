'use client'

import { useState } from 'react'
import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { formatId } from '@/lib/utils'
import { Copy } from 'lucide-react'
import { HtlcUtxoItem } from './htlc-utxo-item'
import { htlcContract, vestingContractAddress } from '@/lib/config'

interface UtxoDialogProps {
  item: HtlcUtxoItem
  currentUserVkeyHash?: string
  onClaim?: (txHash: string, preimage?: string) => void
  onRefund?: (txHash: string) => void
  children: React.ReactNode
}

export default function UtxoDialog({
  item,
  currentUserVkeyHash,
  onClaim,
  onRefund,
  children,
}: UtxoDialogProps) {
  const [open, setOpen] = useState(false)
  const [preimage, setPreimage] = useState('')
  const [currentTime, setCurrentTime] = useState(Date.now())

  // Update current time every second when dialog is open
  React.useEffect(() => {
    if (!open) {
      // Reset preimage when dialog closes
      setPreimage('')
      return
    }
    const interval = setInterval(() => {
      setCurrentTime(Date.now())
    }, 1000)
    return () => clearInterval(interval)
  }, [open])

  const isVesting = item.address === vestingContractAddress
  const isHtlc = item.address === htlcContract.address

  const isYourAddress = (vkeyhash: string) => {
    return currentUserVkeyHash === vkeyhash
  }

  const canBeRefunded = (timeout: number) => {
    if (isVesting) return false
    return currentTime >= timeout + 1 * 60 * 1000
  }

  const canBeClaimed = (timeout: number) => {
    if (isVesting) {
      return currentTime >= timeout
    } else {
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


  const handleClaim = () => {
    if (isHtlc && preimage.trim()) {
      // HTLC requires preimage
      onClaim?.(item.id, preimage.trim())
    } else if (isVesting) {
      // Vesting doesn't need preimage
      onClaim?.(item.id)
    }
    setPreimage('')
    setOpen(false)
  }

  const handleRefund = () => {
    onRefund?.(item.id)
    setOpen(false)
  }

  const showClaimButton =
    isYourAddress(item.to) && canBeClaimed(item.timeout)
  const showRefundButton =
    isYourAddress(item.from) && canBeRefunded(item.timeout)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            UTXO Details
            {isVesting && (
              <span className="text-xs px-2 py-1 rounded bg-purple-100 text-purple-700 font-medium">
                Vesting
              </span>
            )}
            {isHtlc && (
              <span className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700 font-medium">
                HTLC
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            View details and manage this UTXO
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* UTXO Information */}
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-muted-foreground">ID: </span>
              <span className="font-mono">{formatId(item.id, 12, 12)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">From: </span>
              <span className="font-mono">{formatId(item.from)}</span>
              {isYourAddress(item.from) && (
                <span className="text-muted-foreground ml-1">(you)</span>
              )}
            </div>
            <div>
              <span className="text-muted-foreground">To: </span>
              <span className="font-mono">{formatId(item.to)}</span>
              {isYourAddress(item.to) && (
                <span className="text-muted-foreground ml-1">(you)</span>
              )}
            </div>
            <div>
              <span className="text-muted-foreground">Amount: </span>
              <span className="font-mono">{item.amountAda} ADA</span>
            </div>
            <div>
              <span className="text-muted-foreground">Timeout: </span>
              <span className="font-mono">{formatDate(item.timeout)}</span>
            </div>
            {isHtlc && (
              <div>
                <span className="text-muted-foreground">Hash: </span>
                <span className="font-mono">{formatId(item.hash, 8, 8)}</span>
                <Copy
                  className="inline-block cursor-pointer ml-1 h-3.5 w-3.5"
                  onClick={() => copyToClipboard(item.hash)}
                />
              </div>
            )}
            <div>
              <span className="text-muted-foreground">Remaining: </span>
              <span
                className={`font-mono ${
                  currentTime >= item.timeout && !isVesting
                    ? 'text-destructive'
                    : currentTime >= item.timeout && isVesting
                    ? 'text-green-600'
                    : ''
                }`}
              >
                {formatCountdown(item.timeout)}
              </span>
            </div>
          </div>

          {/* Preimage input for HTLC claims only */}
          {isHtlc && showClaimButton && (
            <div className="space-y-2">
              <Label htmlFor="preimage">Preimage (required for HTLC claim)</Label>
              <div className="flex gap-2">
                <Textarea
                  id="preimage"
                  placeholder="Enter or paste preimage here"
                  value={preimage}
                  onChange={(e) => setPreimage(e.target.value)}
                  onPaste={(e) => {
                    // Allow native paste as fallback
                    const pastedText = e.clipboardData.getData('text')
                    setPreimage(pastedText)
                  }}
                  rows={3}
                  className="font-mono text-xs"
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={async () => {
                  try {
                    const text = await navigator.clipboard.readText()
                    setPreimage(text)
                  } catch (error) {
                    console.error('Failed to read clipboard:', error)
                  }
                }}
              >
                Paste from clipboard
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
          >
            Close
          </Button>
          {showRefundButton && (
            <Button
              type="button"
              variant="default"
              className="bg-orange-300 hover:bg-orange-400"
              onClick={handleRefund}
            >
              Refund
            </Button>
          )}
          {showClaimButton && (
            <Button
              type="button"
              variant="default"
              className="bg-blue-300 hover:bg-blue-400"
              onClick={handleClaim}
              disabled={isHtlc && !preimage.trim()}
            >
              Claim
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
