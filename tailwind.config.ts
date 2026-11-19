import type { Config } from "tailwindcss";

// Scheme 1 "Monsoon Teal" from the GroupFly UI schemes page.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#0F5E63", soft: "#DDEFEC" },
        accent: { DEFAULT: "#F2A33A", ink: "#1E1407" },
        canvas: "#F4F8F7",
        ink: "#12292B",
        muted: "#5B7174",
        line: "#D5E2E0",
        ok: "#1F8A4C",
        danger: "#B42318",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
