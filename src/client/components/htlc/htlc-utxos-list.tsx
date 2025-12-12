'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Search } from 'lucide-react'
import HtlcUtxoItemCard, { type HtlcUtxoItem } from './htlc-utxo-item'

interface HtlcUtxosListProps {
  utxos: HtlcUtxoItem[]
  currentUserVkeyHash?: string
  onClaim?: (txHash: string) => void
  onRefund?: (txHash: string) => void
}

export default function HtlcUtxosList({
  utxos,
  currentUserVkeyHash,
  onClaim,
  onRefund,
}: HtlcUtxosListProps) {
  const [searchQuery, setSearchQuery] = useState('')

  const filteredUtxos = utxos.filter((utxo) => {
    if (!searchQuery) return true
    const query = searchQuery.toLowerCase()
    return utxo.hash.toLowerCase().includes(query)
  })

  // Sort by timeout descending
  const sortedUtxos = [...filteredUtxos].sort(
    (a, b) => b.timeout - a.timeout
  )

  return (
    <Card className="flex flex-col overflow-hidden min-w-[480px]">
      <CardHeader className="p-0">
        <CardTitle className="text-center bg-primary text-primary-foreground rounded-t-lg p-4">
          HTLC UTXOs ({filteredUtxos.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto p-4 max-h-[630px]">
        <div className="mb-4">
          <div className="relative">
            <Input
              placeholder="Search by HTLC hash"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pr-10"
            />
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
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
              />
            ))
          ) : (
            <div className="text-center text-muted-foreground">
              No HTLC UTXOs found.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
