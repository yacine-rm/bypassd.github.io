# bypassd.cc

A custom Jekyll blog inspired by the compact, editorial layout of Sam Curry's site. It keeps the content workflow simple: articles live in `_posts` and standalone pages live in `_tabs`.

## Write an article

Create a file named `_posts/YYYY-MM-DD-slug.md`:

```markdown
---
title: "Article title"
date: 2026-11-18 10:00:00 +0100
description: "Summary shown on the blog index and search previews."
cover_image: "/assets/images/example.png"
cover_alt: "Description of the cover image"
categories:
  - security
tags:
  - web
---

Your Markdown starts here.
```

The article URL is generated from the filename. For example, `_posts/2026-11-18-my-finding.md` is published at `/my-finding/`.

`image` and `image_alt` also work as aliases for Chirpy-style front matter:

```yaml
image: "/assets/images/example.png"
image_alt: "Description of the cover image"
```

## Pages

- About page: `_tabs/about.md`
- Archive page: `_tabs/archives.md`
- Add another page by creating a Markdown file in `_tabs` with a `title` and `permalink`.

## Local preview

If Ruby is installed:

```bash
bundle install
bundle exec jekyll serve
```

Then open <http://localhost:4000>.

Without Ruby installed, use the Jekyll container:

```bash
docker run --rm --volume "$PWD:/srv/jekyll" -p 4000:4000 jekyll/jekyll jekyll serve --livereload
```

## GitHub Pages

1. Create a GitHub repository and push this project to its `main` branch.
2. In the repository, open **Settings → Pages** and set the source to **GitHub Actions**.
3. Push to `main`. The included workflow builds and deploys the site.
4. Keep the `CNAME` file set to `bypassd.cc`, and point the domain's DNS records to GitHub Pages as required by GitHub.

Do not use a GitHub Pages "theme" setting. This project includes all layouts and styles directly.

