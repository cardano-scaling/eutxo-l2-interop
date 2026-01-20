import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/sidebar";
import Providers from "./providers";
import { PaymentProvider } from "@/contexts/payment-context";
import { PreimageProvider } from "@/contexts/preimage-context";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "HTLC Multihead Topologies Demo",
  description: "Hydra HTLC Multihead Topologies Demo",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>
          <PreimageProvider>
            <PaymentProvider>
              <div className="flex">
                <Sidebar />
                <main className="flex-1 min-h-screen">{children}</main>
              </div>
            </PaymentProvider>
          </PreimageProvider>
        </Providers>
      </body>
    </html>
  );
}
