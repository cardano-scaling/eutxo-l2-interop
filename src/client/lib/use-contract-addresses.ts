'use client'

import { useQuery } from '@tanstack/react-query'

type ContractAddressesResponse = {
  htlcContract: {
    address: string
  }
  vestingContractAddress: string
}

/**
 * Fetch contract addresses from API
 */
async function fetchContractAddresses(): Promise<ContractAddressesResponse> {
  const res = await fetch('/api/contract-addresses', { cache: 'no-store' })
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Failed to load contract addresses' }))
    throw new Error(error.error || 'Failed to load contract addresses')
  }
  return res.json()
}

/**
 * Hook to fetch and cache contract addresses
 */
export function useContractAddresses() {
  return useQuery({
    queryKey: ['contractAddresses'],
    queryFn: fetchContractAddresses,
    staleTime: Infinity, // Contract addresses don't change
    refetchOnWindowFocus: false,
  })
}
