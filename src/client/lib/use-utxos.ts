'use client'

import { useQuery } from '@tanstack/react-query'
import { UtxoItem } from '@/components/htlc/utxo-item'

type UtxosResponse = {
  utxos: UtxoItem[]
}

/**
 * Fetch UTXOs from Hydra head API
 * API route handles all parsing and conversion server-side
 */
async function fetchUtxos(headRoute: string): Promise<UtxosResponse> {
  const res = await fetch(`/api/hydra/${headRoute}/utxos`, { cache: 'no-store' })
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Failed to load UTXOs' }))
    throw new Error(error.error || 'Failed to load UTXOs')
  }
  return res.json()
}

/**
 * Hook to fetch and manage UTXOs for a Hydra head
 * Follows staffing-marketplace pattern: simple fetch + React Query
 */
export function useUtxos(headRoute: string | undefined, pauseRefetch: boolean = false) {
  return useQuery({
    queryKey: ['utxos', headRoute],
    queryFn: () => fetchUtxos(headRoute!),
    enabled: !!headRoute,
    refetchInterval: pauseRefetch ? false : 5000, // Poll every 5 seconds, or pause if requested
    staleTime: 2000, // Consider stale after 2 seconds
    refetchOnWindowFocus: !pauseRefetch, // Don't refetch on focus if paused
    select: (data) => data.utxos, // API already returns clean array
  })
}
