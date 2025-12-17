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
import { UtxoItem } from './utxo-item'
import { useContractAddresses } from '@/lib/use-contract-addresses'

interface UtxoDialogProps {
  item: UtxoItem
  currentUserVkeyHash?: string
  onClaim?: (utxoId: string, preimage?: string) => Promise<void>
  onRefund?: (utxoId: string) => Promise<void>
  children: React.ReactNode
  isClaiming?: boolean
  isRefunding?: boolean
  onClose?: () => void
}

export default function UtxoDialog({
  item,
  currentUserVkeyHash,
  onClaim,
  onRefund,
  children,
  isClaiming = false,
  isRefunding = false,
  onClose,
}: UtxoDialogProps) {
  const [open, setOpen] = useState(false)
  const [preimage, setPreimage] = useState('')
  const [currentTime, setCurrentTime] = useState(Date.now())
  const [claimError, setClaimError] = useState<string | null>(null)
  const [claimSuccess, setClaimSuccess] = useState(false)
  const [refundError, setRefundError] = useState<string | null>(null)
  const [refundSuccess, setRefundSuccess] = useState(false)
  const { data: contractAddresses } = useContractAddresses()
  const wasExplicitlyClosedRef = React.useRef(false)

  // Update current time every second when dialog is open
  React.useEffect(() => {
    if (!open) {
      // If dialog was explicitly closed by user and we had a successful claim/refund, notify parent to refresh
      if (wasExplicitlyClosedRef.current && (claimSuccess || refundSuccess) && onClose) {
        onClose()
        wasExplicitlyClosedRef.current = false // Reset flag
      }
      // Reset preimage, error, and success when dialog closes
      setPreimage('')
      setClaimError(null)
      setClaimSuccess(false)
      setRefundError(null)
      setRefundSuccess(false)
      return
    }
    const interval = setInterval(() => {
      setCurrentTime(Date.now())
    }, 1000)
    return () => clearInterval(interval)
  }, [open, claimSuccess, refundSuccess, onClose])

  // Prevent dialog from closing automatically when claim/refund succeeds
  // Only allow manual close via Close button
  const handleOpenChange = (newOpen: boolean) => {
    // If trying to close but claim/refund just succeeded, prevent closing
    // User must explicitly click the Close button
    if (!newOpen && (claimSuccess || refundSuccess)) {
      return // Don't close if success state is showing
    }
    
    // Mark as explicitly closed if user is closing it
    if (!newOpen) {
      wasExplicitlyClosedRef.current = true
    }
    
    setOpen(newOpen)
  }

  const isVesting = item.type === 'vesting'
  const isHtlc = item.type === 'htlc'
  const isUser = item.type === 'user'

  const isYourAddress = (vkeyhash: string) => {
    return currentUserVkeyHash === vkeyhash
  }

  const canBeRefunded = (timeout?: number) => {
    if (isVesting || isUser || !timeout) return false
    return currentTime >= timeout
  }

  const canBeClaimed = (timeout?: number) => {
    if (isUser || !timeout) return false
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


  const handleClaim = async () => {
    if (!onClaim) return
    
    setClaimError(null)
    setClaimSuccess(false)
    
    try {
      if (isHtlc && preimage.trim()) {
        // HTLC requires preimage
        await onClaim(item.id, preimage.trim())
      } else if (isVesting) {
        // Vesting doesn't need preimage
        await onClaim(item.id)
      }
      // On success, show success state but keep dialog open
      setClaimSuccess(true)
    } catch (error) {
      // On error, keep dialog open and show error
      setClaimError(error instanceof Error ? error.message : 'Failed to claim')
      setClaimSuccess(false)
    }
  }

  const handleRefund = async () => {
    if (!onRefund) return
    
    setRefundError(null)
    setRefundSuccess(false)
    
    try {
      await onRefund(item.id)
      // On success, show success state but keep dialog open
      setRefundSuccess(true)
    } catch (error) {
      // On error, keep dialog open and show error
      setRefundError(error instanceof Error ? error.message : 'Failed to refund')
      setRefundSuccess(false)
    }
  }

  const showClaimButton =
    !isUser && item.to && isYourAddress(item.to) && canBeClaimed(item.timeout)
  const showRefundButton =
    !isUser && item.from && isYourAddress(item.from) && canBeRefunded(item.timeout)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} modal={true}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-lg" onInteractOutside={(e) => {
        // Prevent closing by clicking outside when claim/refund succeeded
        if (claimSuccess || refundSuccess) {
          e.preventDefault()
        }
      }} onEscapeKeyDown={(e) => {
        // Prevent closing with ESC when claim/refund succeeded
        if (claimSuccess || refundSuccess) {
          e.preventDefault()
        }
      }}>
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
            {isUser && (
              <span className="text-xs px-2 py-1 rounded bg-green-100 text-green-700 font-medium">
                User
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
            {isUser ? (
              <>
                <div>
                  <span className="text-muted-foreground">Owner: </span>
                  <span className="font-mono capitalize">{item.owner}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Amount: </span>
                  <span className="font-mono">{item.amountAda} ADA</span>
                </div>
              </>
            ) : (
              <>
                {isHtlc && item.from && (
                  <div>
                    <span className="text-muted-foreground">From: </span>
                    <span className="font-mono">{formatId(item.from)}</span>
                    {isYourAddress(item.from) && (
                      <span className="text-muted-foreground ml-1">(you)</span>
                    )}
                  </div>
                )}
                {item.to && (
                  <div>
                    <span className="text-muted-foreground">To: </span>
                    <span className="font-mono">{formatId(item.to)}</span>
                    {isYourAddress(item.to) && (
                      <span className="text-muted-foreground ml-1">(you)</span>
                    )}
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">Amount: </span>
                  <span className="font-mono">{item.amountAda} ADA</span>
                </div>
                {item.timeout && (
                  <div>
                    <span className="text-muted-foreground">Timeout: </span>
                    <span className="font-mono">{formatDate(item.timeout)}</span>
                  </div>
                )}
                {isHtlc && item.hash && (
                  <div>
                    <span className="text-muted-foreground">Hash: </span>
                    <span className="font-mono">{formatId(item.hash, 8, 8)}</span>
                    <Copy
                      className="inline-block cursor-pointer ml-1 h-3.5 w-3.5"
                      onClick={() => copyToClipboard(item.hash!)}
                    />
                  </div>
                )}
                {item.timeout && (
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
                )}
              </>
            )}
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
                  className="font-mono text-xs overflow-x-auto whitespace-pre-wrap break-all"
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

          {/* Error messages */}
          {claimError && (
            <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">
              {claimError}
            </div>
          )}
          {refundError && (
            <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">
              {refundError}
            </div>
          )}
          
          {/* Success messages */}
          {claimSuccess && (
            <div className="text-sm text-green-600 bg-green-50 p-2 rounded">
              Successfully claimed! Transaction submitted.
            </div>
          )}
          {refundSuccess && (
            <div className="text-sm text-green-600 bg-green-50 p-2 rounded">
              Successfully refunded! Transaction submitted.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              wasExplicitlyClosedRef.current = true
              setOpen(false)
              // Success state and onClose will be handled in the useEffect when open becomes false
            }}
            disabled={isClaiming || isRefunding}
          >
            Close
          </Button>
          {showRefundButton && (
            <Button
              type="button"
              variant="default"
              className={refundSuccess ? "bg-green-300 hover:bg-green-400" : "bg-orange-300 hover:bg-orange-400"}
              onClick={handleRefund}
              disabled={isRefunding || refundSuccess}
            >
              {isRefunding ? 'Loading...' : refundSuccess ? 'Success' : 'Refund'}
            </Button>
          )}
          {showClaimButton && (
            <Button
              type="button"
              variant="default"
              className={claimSuccess ? "bg-green-300 hover:bg-green-400" : "bg-blue-300 hover:bg-blue-400"}
              onClick={handleClaim}
              disabled={(isHtlc && !preimage.trim()) || isClaiming || claimSuccess}
            >
              {isClaiming ? 'Loading...' : claimSuccess ? 'Success' : 'Claim'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
