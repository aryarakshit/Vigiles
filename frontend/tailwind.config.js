/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        robinhood: {
          green: "#00C805",
          dark: "#0F141C",
          card: "#18202F",
          border: "#263249",
          muted: "#8E9BAE",
        },
      },
    },
  },
  plugins: [],
};
