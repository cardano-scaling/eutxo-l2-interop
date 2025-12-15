'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usePathname } from 'next/navigation'
import { UserName, getUser, getUserNodeUrl, type User } from '@/lib/users'
import { hydraHeads, type HydraHeadConfig } from '@/lib/config'

const CURRENT_USER_KEY = 'currentUser'

/**
 * Get current user from sessionStorage
 */
function getCurrentUserFromStorage(): UserName {
  if (typeof window === 'undefined') return 'alice'
  const saved = sessionStorage.getItem(CURRENT_USER_KEY) as UserName | null
  return saved && ['alice', 'bob', 'ida'].includes(saved) ? saved : 'alice'
}

/**
 * Hook to get and manage current user
 */
export function useCurrentUser() {
  const queryClient = useQueryClient()
  const pathname = usePathname()

  // Query for current user
  const userQuery = useQuery({
    queryKey: [CURRENT_USER_KEY],
    queryFn: () => getCurrentUserFromStorage(),
    staleTime: Infinity, // User selection doesn't change unless explicitly set
    initialData: getCurrentUserFromStorage,
  })

  // Mutation to set current user
  const setUserMutation = useMutation({
    mutationFn: async (user: UserName) => {
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(CURRENT_USER_KEY, user)
      }
      return user
    },
    onSuccess: (user) => {
      queryClient.setQueryData([CURRENT_USER_KEY], user)
    },
  })

  const currentUser = userQuery.data ?? 'alice'

  // Derive current head from route pathname
  const currentHead: HydraHeadConfig | undefined = pathname
    ? hydraHeads.find((head) => pathname === `/${head.route}`)
    : undefined

  // Determine head number from current head config
  const headNumber: 1 | 2 = currentHead
    ? hydraHeads.findIndex((h) => h.headId === currentHead.headId) + 1
    : 1

  const currentUserNodeUrl = getUserNodeUrl(currentUser, headNumber as 1 | 2)
  const userData = getUser(currentUser)
  const currentUserData: User = {
    ...userData,
    nodeUrl: currentUserNodeUrl,
  }

  return {
    currentUser,
    currentUserData,
    currentHead,
    currentUserVkHash: userData.vkHash,
    currentUserSkHash: userData.skHash,
    currentUserNodeUrl,
    setCurrentUser: (user: UserName) => setUserMutation.mutate(user),
  }
}
