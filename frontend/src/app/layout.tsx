import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
  variable: "--font-outfit",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AgentShield | Risk Management Vault for AI Agents on Robinhood Chain",
  description:
    "Arbitrum Stylus (Rust) on-chain risk vault providing cryptographically enforced Session Keys and micro-limits for autonomous AI trading agents on Robinhood Chain.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={outfit.variable}>
      <body className={`${outfit.className} antialiased bg-[#F0F0F0] text-[#121212] min-h-screen font-sans`}>
        {children}
      </body>
    </html>
  );
}
