# joshmarr.com

Personal landing page for **Joshua Marr, MD MPH** — hospitalist physician at the
University of Utah.

This is a static site (plain HTML/CSS, no build step) hosted on
[Netlify](https://www.netlify.com/). It replaces the previous Tumblr-hosted page.

## Structure

```
.
├── index.html        # The landing page
├── 404.html          # Custom not-found page
├── styles.css        # All styling
├── netlify.toml      # Netlify config (publish dir, headers, redirects)
└── images/
    ├── background.jpg # Full-screen backcountry photo (White Pine Canyon)
    └── avatar.png     # Profile image / favicon
```

## Editing

- **Links:** edit the `<nav class="links">` block in `index.html`.
- **Name / tagline:** edit `<h1 class="name">` and `<p class="tagline">` in `index.html`.
- **Background photo:** drop a new image into `images/` and update the
  `background` URL in `styles.css`.

No tooling required — open `index.html` in a browser to preview locally.

## Deploying to Netlify

1. Log in to [Netlify](https://app.netlify.com/) and choose **Add new site → Import an existing project**.
2. Connect this GitHub repository (`jmarrmd/joshmarr.com`).
3. Build settings: **leave the build command empty** and set the **publish directory** to `.`
   (Netlify reads this from `netlify.toml` automatically).
4. Deploy. Netlify gives you a `*.netlify.app` URL immediately.

### Custom domain (www.joshmarr.com)

1. In the Netlify site, go to **Domain management → Add a domain** and enter `joshmarr.com`.
2. Either:
   - **Use Netlify DNS** (recommended): point your registrar's nameservers at the
     ones Netlify provides, or
   - **Keep your current DNS**: add a `CNAME` for `www` → your Netlify subdomain and
     an `A`/`ALIAS` record for the apex per Netlify's instructions.
3. Netlify provisions a free Let's Encrypt HTTPS certificate automatically.

> Note: hosting moves from Tumblr to Netlify when DNS is repointed. Make the DNS
> change only after the Netlify deploy looks correct on its `*.netlify.app` URL.
