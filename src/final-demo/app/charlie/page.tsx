import { FinalDemoApp } from "@/components/FinalDemoApp";
import { AppShell } from "@/components/layout/AppShell";
import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function CharliePage() {
  return (
    <AppShell
      title="Final Demo · Charlie"
      subtitle="Head C operator flow: monitor Head A/C, associate Hydra node, and buy ticket."
    >
      <FinalDemoApp view="charlie" />
    </AppShell>
  );
}
