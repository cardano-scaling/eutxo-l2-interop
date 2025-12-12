'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatId } from '@/lib/utils'
import { Copy } from 'lucide-react'
import { useState, useEffect } from 'react'

export type HtlcUtxoItem = {
  id: string
  hash: string
  timeout: number
  from: string
  to: string
  amountAda: number
}

interface HtlcUtxoItemProps {
  item: HtlcUtxoItem
  currentUserVkeyHash?: string
  onClaim?: (txHash: string) => void
  onRefund?: (txHash: string) => void
}

export default function HtlcUtxoItemCard({
  item,
  currentUserVkeyHash,
  onClaim,
  onRefund,
}: HtlcUtxoItemProps) {
  const [currentTime, setCurrentTime] = useState(Date.now())

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now())
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const isTimeout = currentTime >= item.timeout
  const isYourAddress = (vkeyhash: string) => {
    return currentUserVkeyHash === vkeyhash
  }

  const canBeRefunded = (timeout: number) => {
    return currentTime >= timeout + 1 * 60 * 1000 // add 1 minute buffer
  }

  const canBeClaimed = (timeout: number) => {
    return currentTime < timeout - 1 * 60 * 1000 // subtract 1 minute buffer
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
    if (diff <= 0) return 'Expired'
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
    <Card className="bg-muted">
      <CardContent className="p-4">
        <div className="flex justify-between items-start mb-2">
          <div className="space-y-1 flex-1">
            <div className="text-xs font-mono text-muted-foreground">
              ID: {formatId(item.id, 12, 12)}
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">from:</span>
              <span className="font-mono ml-1">{formatId(item.from)}</span>
              {isYourAddress(item.from) && (
                <span className="text-sm text-gray-400 ml-1">(you)</span>
              )}
            </div>
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
            <div className="text-sm">
              <span className="text-muted-foreground">remaining: </span>
              <span
                className={`text-sm font-mono ${
                  isTimeout ? 'text-destructive' : ''
                }`}
              >
                {formatCountdown(item.timeout)}
              </span>
            </div>
          </div>
          <div className="flex flex-col space-y-1">
            {isYourAddress(item.from) && canBeRefunded(item.timeout) && (
              <Button
                variant="default"
                size="sm"
                className="bg-orange-300 hover:bg-orange-400"
                onClick={() => onRefund?.(item.id)}
              >
                Refund
              </Button>
            )}
            {isYourAddress(item.to) && canBeClaimed(item.timeout) && (
              <Button
                variant="default"
                size="sm"
                className="bg-blue-300 hover:bg-blue-400"
                onClick={() => onClaim?.(item.id)}
              >
                Claim
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
