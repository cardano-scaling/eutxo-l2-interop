"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LINKS: Array<{ href: string; label: string }> = [
  { href: "/user", label: "User" },
  { href: "/charlie", label: "Charlie" },
  { href: "/admin", label: "Admin" },
];

export function RoleNav() {
  const pathname = usePathname();

  return (
    <nav className="inline-flex items-center gap-1 rounded-lg border bg-muted/40 p-1">
      {LINKS.map((link) => {
        const active = pathname === link.href;
        return (
          <Button
            key={link.href}
            asChild
            size="sm"
            variant={active ? "default" : "ghost"}
            className={cn(
              "h-7 px-3 text-xs",
              active ? "shadow-sm" : "text-muted-foreground",
            )}
          >
            <Link href={link.href}>{link.label}</Link>
          </Button>
        );
      })}
    </nav>
  );
}

