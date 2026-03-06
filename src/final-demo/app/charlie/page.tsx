import { FinalDemoApp } from "@/components/FinalDemoApp";
import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function CharliePage() {
  return <FinalDemoApp view="charlie" />;
}
