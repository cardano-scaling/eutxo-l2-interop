'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { UserName, getUser } from '@/lib/users'

const CURRENT_USER_KEY = 'currentUser'

/**
 * Get current user from sessionStorage
 */
function getCurrentUserFromStorage(): UserName {
  if (typeof window === 'undefined') return 'alice'
  const saved = sessionStorage.getItem(CURRENT_USER_KEY) as UserName | null
  return saved && ['alice', 'bob', 'ida', 'charlie'].includes(saved) ? saved : 'alice'
}

/**
 * Hook to get and manage current user
 */
export function useCurrentUser() {
  const queryClient = useQueryClient()

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
  const userData = getUser(currentUser)

  return {
    currentUser,
    currentUserData: userData,
    setCurrentUser: (user: UserName) => setUserMutation.mutate(user),
  }
}
