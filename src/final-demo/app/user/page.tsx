import { FinalDemoApp } from "@/components/FinalDemoApp";
import { AppShell } from "@/components/layout/AppShell";

export default function UserPage() {
  return (
    <AppShell
      title="Final Demo · User"
      subtitle="Participate in a lottery across Hydra Head boundaries. Request funds from the faucet to begin, then buy tickets for the lottery running in Head B using the funds distributed to you in Head A. HTLCs are created and processed almost instantly—blink and you'll miss it! If you're lucky enough to win, prize funds will be directly transferred back to you in Head A."
    >
      <FinalDemoApp view="user" />
    </AppShell>
  );
}

