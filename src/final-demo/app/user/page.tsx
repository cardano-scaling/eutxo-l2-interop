import { FinalDemoApp } from "@/components/FinalDemoApp";
import { AppShell } from "@/components/layout/AppShell";

export default function UserPage() {
  return (
    <AppShell
      title="Final Demo · User"
      subtitle="Custodial and lottery flow: wallet, Head A/B monitoring, request funds, buy ticket."
    >
      <FinalDemoApp view="user" />
    </AppShell>
  );
}

