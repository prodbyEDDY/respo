# Security Policy

## Supported versions

Only the latest 0.1.x release is supported with security fixes. Please update before
reporting a problem to confirm it's still present.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting instead of opening a public issue:

<https://github.com/prodbyEDDY/respo/security/advisories/new>

Do not open a public issue for security problems.

When reporting, please include:

- A description of the vulnerability and its impact
- Steps to reproduce, or a proof of concept
- The Respo version and Windows version you tested on
- Any relevant log output (from `main.log`, via ⋯ → About Respo → Open logs folder —
  remove anything private first)

**Response target:** acknowledgement within 7 days, best effort. Respo is a
volunteer-maintained project, so response and fix times aren't guaranteed, but reports
are taken seriously and worked through as soon as possible.

## Scope notes

A few things worth knowing about how Respo is built, so reports can be scoped
accurately:

- Respo loads arbitrary web pages for preview inside sandboxed `WebContentsView`
  instances, with context isolation enabled and no Node integration.
- Permission requests (camera, location, notifications, etc.) from previewed pages are
  asked per site, not granted by default.
- The "Allow invalid certificates" option applies only to device preview views, and is
  off by default.
- The auto-updater pulls releases only from GitHub Releases over HTTPS, and verifies
  the release manifest's SHA-512 before applying an update.
- Builds are not currently code-signed. Windows SmartScreen will show a warning on
  install — this is expected until signing is set up, and is not itself a
  vulnerability report.

## Bug bounty

There is no bug bounty program for this project.
