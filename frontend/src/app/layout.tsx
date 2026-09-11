import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en">
      <body className="antialiased bg-[#0B0E14] text-gray-100 min-h-screen">
        {children}
      </body>
    </html>
  );
}
