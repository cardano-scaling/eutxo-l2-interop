import type { ReactNode } from "react";
import { ModeToggle } from "./ModeToggle";
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
                  <p style={shellStyles.infoParagraph}>
                    This project was funded by{" "}
                    <a href="https://projectcatalyst.io/funds/13/cardano-open-developers/eutxo-l2-interoperability-connect-hydra-and-other-l2s" target="_blank" rel="noreferrer" style={shellStyles.link}>
                      Project Catalyst
                    </a>
                    . For a deeper dive into the architecture and technical details, please explore the{" "}
                    <a href="https://cardano-scaling.github.io/eutxo-l2-interop/" target="_blank" rel="noreferrer" style={shellStyles.link}>
                      Official Documentation
                    </a>
                    .
                  </p>
                </div>
                <div style={shellStyles.controls}>
                  <ModeToggle />
                </div>
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
  main: { minHeight: "100vh", padding: "14px 16px 20px", background: "var(--background)" },
  container: { maxWidth: 1220, margin: "0 auto", display: "grid", gap: 16 },
  headerCard: {
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    boxShadow: "0 1px 1px rgba(15,23,42,0.04)",
  },
  headerContent: { paddingTop: 12 },
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" },
  controls: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" },
  titleWrap: { display: "grid", gap: 4 },
  title: { margin: 0, fontSize: 18, letterSpacing: -0.2, lineHeight: 1.2, color: "var(--foreground)" },
  subtitle: { margin: 0, color: "var(--muted-foreground)", fontSize: 12, maxWidth: 760 },
  infoParagraph: { margin: 0, color: "var(--muted-foreground)", fontSize: 12, display: "inline-block" },
  link: { color: "var(--primary)", textDecoration: "underline", textUnderlineOffset: 2 },
};

