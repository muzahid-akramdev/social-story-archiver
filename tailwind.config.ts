import type { Config } from "tailwindcss";

// Design direction: a personal archive, not a SaaS dashboard — closer to a
// kept box of instant-film photos and library catalog cards than a "tool."
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        darkroom: {
          DEFAULT: "#1C1917", // warm near-black, not pure black
          light: "#2A2521",
        },
        paper: {
          DEFAULT: "#F5F0E8", // instant-film card cream
          dim: "#E8E0D2",
        },
        amber: {
          DEFAULT: "#D4A72C", // film-leader amber, the one accent
          dim: "#B8901F",
        },
        moss: "#7A9471", // "new since last check" indicator
        rust: "#B0532A", // errors / stale link warnings
        ink: "#3A342C", // body text on paper
      },
      fontFamily: {
        display: ["var(--font-fraunces)", "Georgia", "serif"],
        body: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      // Tailwind auto-generates the negative variant (-rotate-1.5) from
      // each positive key here, so only positive values are listed.
      rotate: {
        "1.5": "1.5deg",
        "2.5": "2.5deg",
      },
    },
  },
  plugins: [],
};

export default config;
