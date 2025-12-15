'use client'

import React, { createContext, useContext, useState, useEffect } from 'react'
import { UserName, getUser, getUserNodeUrl, type User } from '@/lib/users'
import { hydraHeads, type HydraHeadConfig } from '@/lib/config'

type UserContextType = {
  currentUser: UserName
  currentUserData: User
  currentHead?: HydraHeadConfig
  setCurrentUser: (user: UserName) => void
  setCurrentHead: (head: HydraHeadConfig | undefined) => void
  currentUserVkHash: string // Verification key hash (from config)
  currentUserSkHash: string // Signing key hash (from config)
  currentUserNodeUrl: string
}

const UserContext = createContext<UserContextType | undefined>(undefined)

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUserState] = useState<UserName>('alice')
  const [currentHead, setCurrentHeadState] = useState<HydraHeadConfig | undefined>(undefined)

  // Determine head number from current head config
  const headNumber: 1 | 2 = currentHead
    ? hydraHeads.findIndex((h) => h.headId === currentHead.headId) + 1
    : 1

  const currentUserNodeUrl = getUserNodeUrl(currentUser, headNumber as 1 | 2)
  const currentUserData = getUser(currentUser)
  const currentUserDataWithNodeUrl = {
    ...currentUserData,
    nodeUrl: currentUserNodeUrl,
  }
  
  // Get key hashes from config
  const currentUserVkHash = currentUserData.vkHash
  const currentUserSkHash = currentUserData.skHash

  const setCurrentUser = (user: UserName) => {
    setCurrentUserState(user)
    // Store in sessionStorage for persistence
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('currentUser', user)
    }
  }

  const setCurrentHead = (head: HydraHeadConfig | undefined) => {
    setCurrentHeadState(head)
    if (typeof window !== 'undefined') {
      if (head) {
        sessionStorage.setItem('currentHead', head.headId)
      } else {
        sessionStorage.removeItem('currentHead')
      }
    }
  }

  // Load from sessionStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedUser = sessionStorage.getItem('currentUser') as UserName | null
      if (savedUser && ['alice', 'bob', 'ida'].includes(savedUser)) {
        setCurrentUserState(savedUser)
      }

      const savedHeadId = sessionStorage.getItem('currentHead')
      if (savedHeadId) {
        const head = hydraHeads.find((h) => h.headId === savedHeadId)
        if (head) {
          setCurrentHeadState(head)
        }
      }
    }
  }, [])

  return (
    <UserContext.Provider
      value={{
        currentUser,
        currentUserData: currentUserDataWithNodeUrl,
        currentHead,
        setCurrentUser,
        setCurrentHead,
        currentUserVkHash,
        currentUserSkHash,
        currentUserNodeUrl,
      }}
    >
      {children}
    </UserContext.Provider>
  )
}

export function useUser() {
  const context = useContext(UserContext)
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider')
  }
  return context
}
