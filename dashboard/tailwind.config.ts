import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        gold: {
          DEFAULT: '#d4af37',
          light: '#f0d060',
          dark: '#8b7355',
        },
        matrix: {
          DEFAULT: '#22c55e',
          dim: '#166534',
        },
      },
    },
  },
  plugins: [],
}
export default config
