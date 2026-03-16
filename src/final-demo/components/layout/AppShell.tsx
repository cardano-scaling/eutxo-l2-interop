import type { ReactNode } from "react";
import { RoleNav } from "./RoleNav";

export function AppShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main style={{ minHeight: "100vh", padding: "14px 16px 20px" }}>
      <div style={{ maxWidth: 1220, margin: "0 auto", display: "grid", gap: 16 }}>
        <header
          style={{
            background: "#ffffff",
            border: "1px solid #e5e7eb",
            borderRadius: 10,
            padding: 12,
            display: "grid",
            gap: 10,
            boxShadow: "0 1px 1px rgba(15,23,42,0.04)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "grid", gap: 4 }}>
              <h1 style={{ margin: 0, fontSize: 18, letterSpacing: -0.2, lineHeight: 1.2, color: "#111827" }}>{title}</h1>
              {subtitle ? <p style={{ margin: 0, color: "#6b7280", fontSize: 12, maxWidth: 760 }}>{subtitle}</p> : null}
            </div>
            <RoleNav />
          </div>
        </header>
        {children}
      </div>
    </main>
  );
}

