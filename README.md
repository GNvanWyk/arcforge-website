# ArcForge Designs Website

A high-performance static website for **ArcForge Designs**, structured and configured for **Cloudflare Pages**.

---

## Project Structure

```text
.
├── index.html       # Main HTML markup styled with Tailwind CSS (via CDN)
├── terms.html       # Terms & Conditions of Trade page (shares header/footer/styles with index.html)
├── styles.css       # Custom accents, brand variables, glassmorphism, & animations
├── script.js        # Interactive handlers (mobile menu, filtering, contact toast, scroll effects)
├── wrangler.jsonc   # Cloudflare Pages deployment configuration
├── .gitignore       # Git ignore rules for Wrangler cache and system files
└── README.md        # Project guide and deployment instructions
```

---

## Quick Start & Local Preview

You can preview the site locally using Cloudflare's Wrangler CLI or any static file server.

### Option 1: Cloudflare Wrangler (Recommended)

Run a local Cloudflare Pages emulation server:

```bash
npx wrangler pages dev .
```

This runs the exact Cloudflare Pages runtime locally at `http://localhost:8788`.

### Option 2: Live Server or Simple HTTP Server

```bash
# Using Python
python -m http.server 8080

# Using Node.js
npx serve .
```

---

## Deploying to Cloudflare Pages

### 1. Direct Deployment via Wrangler CLI

```bash
npx wrangler pages deploy . --project-name=arcforge-designs-website
```

### 2. Git Integration (GitHub / GitLab)

1. Push this repository to GitHub or GitLab.
2. In the [Cloudflare Dashboard](https://dash.cloudflare.com/), navigate to **Compute (Workers & Pages)** > **Create application** > **Pages** > **Connect to Git**.
3. Select your repository.
4. Set **Build output directory** to `/` or `.` (or Cloudflare will read `wrangler.jsonc` automatically).
5. Click **Save and Deploy**.

