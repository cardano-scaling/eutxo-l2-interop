"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS: Array<{ href: string; label: string }> = [
  { href: "/user", label: "User" },
  { href: "/charlie", label: "Charlie" },
  { href: "/admin", label: "Admin" },
];

export function RoleNav() {
  const pathname = usePathname();

  return (
    <nav
      style={{
        display: "flex",
        gap: 6,
        flexWrap: "wrap",
        padding: 3,
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        background: "#f9fafb",
      }}
    >
      {LINKS.map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            style={{
              textDecoration: "none",
              borderRadius: 6,
              padding: "5px 10px",
              border: active ? "1px solid #d1d5db" : "1px solid transparent",
              background: active ? "#ffffff" : "transparent",
              color: active ? "#111827" : "#4b5563",
              fontSize: 12,
              fontWeight: active ? 700 : 600,
              boxShadow: active ? "0 1px 1px rgba(0,0,0,0.04)" : "none",
              transition: "all 120ms ease",
            }}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

