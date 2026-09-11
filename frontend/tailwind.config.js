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
        bauhaus: {
          canvas: "#F0F0F0",
          foreground: "#121212",
          black: "#121212",
          red: "#D02020",
          blue: "#1040C0",
          yellow: "#F0C020",
          border: "#121212",
          muted: "#E0E0E0",
          lightYellow: "#FFF9C4",
        },
        robinhood: {
          green: "#00C805",
          dark: "#0F141C",
          card: "#18202F",
          border: "#263249",
          muted: "#8E9BAE",
        },
      },
      boxShadow: {
        'bauhaus-sm': '3px 3px 0px 0px #121212',
        'bauhaus-md': '4px 4px 0px 0px #121212',
        'bauhaus-lg': '8px 8px 0px 0px #121212',
        'bauhaus-red': '4px 4px 0px 0px #D02020',
        'bauhaus-blue': '4px 4px 0px 0px #1040C0',
        'bauhaus-yellow': '4px 4px 0px 0px #F0C020',
      },
      fontFamily: {
        outfit: ["var(--font-outfit)", "Outfit", "sans-serif"],
      },
    },
  },
  plugins: [],
};
