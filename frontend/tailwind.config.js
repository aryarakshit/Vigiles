/** @type {import('tailwindcss').Config} */
/*
 * Swiss International, inverted. Black board, white type, one green signal.
 * Radius is 0 everywhere and there are no shadows; depth comes from the
 * pattern utilities in globals.css (grid / dots / diagonal / noise).
 */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        page: "#000000", // the board
        ink: "#FFFFFF", // text and structural rules
        mute: "#0E0E0E", // secondary surfaces (carry patterns)
        mute2: "#171717", // input wells, table header bands
        accent: "#2BE86F", // the signal: refusals, CTAs, section numbers
        accentDeep: "#0B6B34", // filled accent surfaces that carry white text
      },
      fontFamily: {
        sans: ["Inter", "Helvetica Neue", "Helvetica", "Arial", "sans-serif"],
      },
      borderRadius: { none: "0", DEFAULT: "0", sm: "0", md: "0", lg: "0", xl: "0", "2xl": "0", full: "9999px" },
      boxShadow: {
        none: "none",
        // compositional ring only — never a drop shadow
        ring: "0 0 0 8px rgba(43, 232, 111, 0.12)",
      },
      letterSpacing: {
        tightest: "-0.05em",
      },
      transitionDuration: { 150: "150ms", 200: "200ms" },
    },
  },
  plugins: [],
};
