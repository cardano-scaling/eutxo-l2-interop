'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { User } from 'lucide-react'
import { useCurrentUser } from '@/lib/use-current-user'
import { getAllUsers, type UserName } from '@/lib/users'

export default function UserSwitcher() {
  const { currentUser, setCurrentUser } = useCurrentUser()
  const allUsers = getAllUsers()

  const handleSwitch = (userName: UserName) => {
    setCurrentUser(userName)
  }

  const displayName = currentUser.charAt(0).toUpperCase() + currentUser.slice(1)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="w-full justify-start">
          <User className="mr-2 h-4 w-4" />
          {displayName}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64" align="start">
        {allUsers
          .filter((u) => u.name !== currentUser)
          .map((u) => (
            <DropdownMenuItem
              key={u.name}
              onClick={() => handleSwitch(u.name)}
            >
              {u.name.charAt(0).toUpperCase() + u.name.slice(1)}
            </DropdownMenuItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
