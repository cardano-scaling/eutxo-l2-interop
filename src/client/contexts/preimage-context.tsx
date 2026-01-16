'use client'

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'

type PreimagePair = {
  preimage: string
  hash: string
  createdAt: number
  isUsed: boolean // If true, never expires
}

type PreimageContextType = {
  pairs: Map<string, PreimagePair> // Map from hash to pair
  addPair: (preimage: string, hash: string) => void
  getPreimage: (hash: string) => string | null
  markAsUsed: (hash: string) => void
}

const PreimageContext = createContext<PreimageContextType | undefined>(undefined)

const TTL_MS = 5 * 60 * 1000 // 5 minutes
const CLEANUP_INTERVAL_MS = 3 * 60 * 1000 // Cleanup every three minutes

export function PreimageProvider({ children }: { children: React.ReactNode }) {
  const [pairs, setPairs] = useState<Map<string, PreimagePair>>(new Map())
  const cleanupIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Load from localStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return

    try {
      const stored = localStorage.getItem('preimage-pairs')
      if (stored) {
        const parsed = JSON.parse(stored) as Array<[string, PreimagePair]>
        const map = new Map<string, PreimagePair>()
        parsed.forEach(([hash, pair]) => {
          // Only restore used pairs (indefinite lifetime)
          if (pair.isUsed) {
            map.set(hash, pair)
          }
        })
        setPairs(map)
      }
    } catch (error) {
      console.error('Error loading preimage pairs:', error)
    }
  }, [])

  // Persist used pairs to localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return

    try {
      const usedPairs = Array.from(pairs.entries()).filter(([_, pair]) => pair.isUsed)
      if (usedPairs.length > 0) {
        localStorage.setItem('preimage-pairs', JSON.stringify(usedPairs))
      } else {
        localStorage.removeItem('preimage-pairs')
      }
    } catch (error) {
      console.error('Error persisting preimage pairs:', error)
    }
  }, [pairs])

  // Cleanup expired pairs (not used)
  useEffect(() => {
    cleanupIntervalRef.current = setInterval(() => {
      setPairs((prev) => {
        const now = Date.now()
        const updated = new Map(prev)
        let changed = false

        prev.forEach((pair, hash) => {
          // Remove if expired and not used
          if (!pair.isUsed && now - pair.createdAt > TTL_MS) {
            updated.delete(hash)
            changed = true
          }
        })

        return changed ? updated : prev
      })
    }, CLEANUP_INTERVAL_MS)

    return () => {
      if (cleanupIntervalRef.current) {
        clearInterval(cleanupIntervalRef.current)
      }
    }
  }, [])

  const addPair = useCallback((preimage: string, hash: string) => {
    setPairs((prev) => {
      const updated = new Map(prev)
      updated.set(hash, {
        preimage,
        hash,
        createdAt: Date.now(),
        isUsed: false,
      })
      return updated
    })
  }, [])

  const getPreimage = useCallback((hash: string): string | null => {
    const pair = pairs.get(hash)
    if (!pair) return null
    
    // Check if expired (only for unused pairs)
    if (!pair.isUsed && Date.now() - pair.createdAt > TTL_MS) {
      return null
    }
    
    return pair.preimage
  }, [pairs])

  const markAsUsed = useCallback((hash: string) => {
    setPairs((prev) => {
      const pair = prev.get(hash)
      if (!pair) return prev

      const updated = new Map(prev)
      updated.set(hash, {
        ...pair,
        isUsed: true, // Mark as used - indefinite lifetime
      })
      return updated
    })
  }, [])

  return (
    <PreimageContext.Provider
      value={{
        pairs,
        addPair,
        getPreimage,
        markAsUsed,
      }}
    >
      {children}
    </PreimageContext.Provider>
  )
}

export function usePreimage() {
  const context = useContext(PreimageContext)
  if (context === undefined) {
    throw new Error('usePreimage must be used within a PreimageProvider')
  }
  return context
}
