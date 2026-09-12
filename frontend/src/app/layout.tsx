import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vigiles — session keys, not wallet keys",
  description: "Session keys, not wallet keys — a Stylus (Rust) vault that cages AI trading agents with hard on-chain limits.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Inter: the neutral grotesque. 400/500 for body, 700/900 for structure. */}
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;900&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-screen bg-page text-ink font-sans">{children}</body>
    </html>
  );
}
