/* Tailwind Play CDN theme config, shared by every page. Loaded right after
   cdn.tailwindcss.com (kept out of the HTML so the CSP needs no inline scripts). */
tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        plasma: {
          300: '#70f8ff',
          400: '#38f5ff',
          500: '#00e5ff',
          600: '#00c7d4',
          700: '#0284c7',
          800: '#0369a1',
          900: '#075985',
        },
        charcoal: {
          950: '#11161d',
          900: '#0b1015',
          850: '#0d111a',
          800: '#141a27',
          750: '#1b2333',
          700: '#242f44',
        }
      }
    }
  }
}
