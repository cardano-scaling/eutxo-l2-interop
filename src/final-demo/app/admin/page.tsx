import { FinalDemoApp } from "@/components/FinalDemoApp";
import { AppShell } from "@/components/layout/AppShell";
import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminPage() {
  return (
    <AppShell
      title="Final Demo · Admin"
      subtitle="Monitor all heads/workflows and execute admin operations."
    >
      <FinalDemoApp view="admin" />
    </AppShell>
  );
}

