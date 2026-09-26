# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Static marketing site for ArcForge Designs (CNC plasma cutting & custom metal fabrication, South Africa), deployed to Cloudflare Pages. No build step, no package manager, no framework — three hand-authored files plus SVG brand assets.

## Commands

There is no build/lint/test tooling in this repo (no `package.json`). Local preview only:

```bash
# Cloudflare Pages emulation (matches production runtime, recommended)
npx wrangler pages dev .
# → http://localhost:8788

# or a plain static file server
python -m http.server 8080
npx serve .
```

Deploy directly:
```bash
npx wrangler pages deploy . --project-name=arcforge-designs-website
```
(Or via Cloudflare Dashboard Git integration; `wrangler.jsonc` sets `pages_build_output_dir` to `.`, so Cloudflare serves the repo root as-is.)

Since there's no build pipeline, edits to `index.html`/`styles.css`/`script.js` are visible on refresh — no compile step.

## Architecture

- **[index.html](index.html)** — entire page markup and content, single file, no templating/partials. Loads Tailwind CSS from CDN (`cdn.tailwindcss.com`) with an inline `tailwind.config` block (right after the CDN `<script>` tag) that extends the theme with two custom color scales: `plasma` (brand cyan/blue accent) and `charcoal` (dark backgrounds). Most layout/spacing/responsive styling is done with inline Tailwind utility classes directly in the markup — there is no separate component system.
- **[styles.css](styles.css)** — only for what Tailwind utilities can't express directly: CSS custom properties/brand variables, glassmorphism effects, custom animations, and state classes referenced by `script.js` (e.g. `.navbar-scrolled-dark`, `.hidden-toast`/`.visible-toast`, `.dragover`).
- **[script.js](script.js)** — vanilla JS, no dependencies. Structured as one `DOMContentLoaded` entry point that calls a set of independent `init*()` functions, each owning one interactive feature and guarding itself with early-return null checks (so sections can be added/removed from `index.html` without breaking the script):
  - `initThemeToggle` — dark/light mode, persisted to `localStorage` under `arcforge_theme`, defaults to dark. Toggles `dark`/`light` classes on `<html>` (Tailwind `darkMode: 'class'`).
  - `initNavbar` — scroll-based navbar background/blur; exposes `window._refreshNavbarScroll` so the theme toggle can re-apply navbar styling immediately after a theme switch.
  - `initMobileMenu` — hamburger menu open/close, closes on link click or Escape.
  - `initFileUpload` — drag-and-drop + file-picker zone for CAD/DXF quote uploads (UI only, no upload endpoint).
  - `initGalleryFilters` — client-side category filtering of `.gallery-item` elements via `data-category`/`data-filter` attributes, no data fetching.
  - `initQuoteForm` — quote request form; submission is currently simulated client-side (`setTimeout` + toast notification), not wired to a backend/API.
  - `initDynamicYear` — sets the footer copyright year.

  New interactive behavior should follow this same pattern: a new `init*()` function registered in the `DOMContentLoaded` listener, targeting elements by ID/class/data-attribute with null-guards, rather than introducing a framework or module bundler.

- **Brand assets**: `logo-full.svg`, `logo-mark.svg`, `favicon.svg` at repo root, referenced directly by relative path.
- **`wrangler.jsonc`**: Cloudflare Pages config only (no Workers logic, no functions directory).
