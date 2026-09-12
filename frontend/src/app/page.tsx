"use client";

import dynamic from "next/dynamic";

// The dashboard reads localStorage, window.ethereum and the wall clock, so it is
// rendered on the client only; there is nothing meaningful to pre-render for a wallet app.
const Dashboard = dynamic(() => import("../components/Dashboard").then((m) => m.Dashboard), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen flex items-center justify-center">
      <div className="label">Loading</div>
    </div>
  ),
});

export default function Home() {
  return <Dashboard />;
}
