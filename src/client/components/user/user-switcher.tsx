'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { User } from 'lucide-react'

// Placeholder user data - you'll handle the actual logic
const users = [
  { id: '1', name: 'User 1' },
  { id: '2', name: 'User 2' },
]

export default function UserSwitcher() {
  // You'll handle the current user and switch logic
  const currentUser = users[0]
  const handleSwitch = (userId: string) => {
    // Your switch logic here
    console.log('Switch to user:', userId)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="w-full justify-start">
          <User className="mr-2 h-4 w-4" />
          {currentUser?.name || 'Select user'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64" align="start">
        {users
          .filter((u) => u.id !== currentUser?.id)
          .map((u) => (
            <DropdownMenuItem
              key={u.id}
              onClick={() => handleSwitch(u.id)}
            >
              {u.name}
            </DropdownMenuItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
