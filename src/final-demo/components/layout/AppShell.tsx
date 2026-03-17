import type { ReactNode } from "react";
import { RoleNav } from "./RoleNav";
import { Card, CardContent } from "@/components/ui/card";

export function AppShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main style={shellStyles.main}>
      <div style={shellStyles.container}>
        <header>
          <Card style={shellStyles.headerCard}>
            <CardContent style={shellStyles.headerContent}>
              <div style={shellStyles.headerRow}>
                <div style={shellStyles.titleWrap}>
                  <h1 style={shellStyles.title}>{title}</h1>
                  {subtitle ? <p style={shellStyles.subtitle}>{subtitle}</p> : null}
                </div>
                <RoleNav />
              </div>
            </CardContent>
          </Card>
        </header>
        {children}
      </div>
    </main>
  );
}

const shellStyles: Record<string, React.CSSProperties> = {
  main: { minHeight: "100vh", padding: "14px 16px 20px" },
  container: { maxWidth: 1220, margin: "0 auto", display: "grid", gap: 16 },
  headerCard: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    boxShadow: "0 1px 1px rgba(15,23,42,0.04)",
  },
  headerContent: { paddingTop: 12 },
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" },
  titleWrap: { display: "grid", gap: 4 },
  title: { margin: 0, fontSize: 18, letterSpacing: -0.2, lineHeight: 1.2, color: "#111827" },
  subtitle: { margin: 0, color: "#6b7280", fontSize: 12, maxWidth: 760 },
};

