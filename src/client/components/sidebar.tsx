'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { hydraHeads } from '@/lib/config'
import UserSwitcher from './user/user-switcher'
import GeneratePreimageDialog from './htlc/generate-preimage-dialog'
import { Button } from './ui/button'

export default function Sidebar() {
  return (
    <aside className="w-64 p-4 border-r flex flex-col justify-between">
      <nav className="space-y-2">
        <SidebarLink href="/" key="home">Hydra Heads</SidebarLink>
        {hydraHeads.map((head) => (
          <SidebarLink key={head.route} href={`/${head.route}`}>
            {head.name}
          </SidebarLink>
        ))}
      </nav>
      <div className="space-y-2">
        <div className="border-t pt-2">
          <GeneratePreimageDialog>
            <Button
              variant="outline"
              className="w-full justify-start"
            >
              Generate Preimage
            </Button>
          </GeneratePreimageDialog>
        </div>
        <UserSwitcher />
      </div>
    </aside>
  )
}

function SidebarLink({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const isActive = pathname === href

  return (
    <Link
      href={href}
      className={`block px-3 py-2 rounded font-medium ${
        isActive
          ? 'text-blue-600 bg-blue-50'
          : 'hover:bg-muted'
      }`}
    >
      {children}
    </Link>
  )
}
