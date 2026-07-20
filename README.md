# dosya web

The official web application for [dosya.dev](https://dosya.dev) — files, sharing, and
workspaces in the browser. This is the code running at
[app.dosya.dev](https://app.dosya.dev).

## Features

- **File manager** — Upload, preview, organize; file detail panel, version history,
  favourites, locked/hidden files
- **Previews & editing** — Image editing (Pintura), HEIC support, video, and a
  syntax-highlighted code viewer/editor (CodeMirror + Shiki)
- **Sharing** — Share links with passwords and expiry, plus a "shared with me" view
- **Workspaces & teams** — Members, custom roles, and per-workspace settings
- **Uploads** — Resumable multipart uploads with progress and parallelism
- **Photo map** — Geotagged photos on an interactive map (MapLibre + clustering)
- **Search** — Full-text search across files and folders
- **Activity feed** — Who did what, when, from where
- **Comments & file requests** — Collaborate on files, receive files from external users
- **Notifications** — In-app inbox and web push
- **Account** — Profile, settings, billing, and two-factor login

## Tech Stack

- **React 19** + **TypeScript** — UI
- **Vite 8** — Build tooling
- **Tailwind CSS 4** — Styling
- **Zustand** — State management
- **React Router 7** — Routing
- **Cloudflare Pages** — Hosting

## Development

### Prerequisites

- Node.js >= 18
- npm

### Commands

```bash
npm install        # Install dependencies
npm run dev        # Start dev server
npm run build      # Typecheck + production build
npm run test       # Run vitest suite
npm run preview    # Preview the production build
```

The app talks to the dosya.dev API (`api.dosya.dev`).

## Transparency

Every dosya.dev client is source-available. Your files are yours — this repository lets
you verify exactly what the app sends to and receives from our servers: what gets
uploaded, what metadata travels with it, and what comes back. If a claim we make about
privacy or sync behavior can't be verified in this code, open an issue and call it out.

## License

Source-available under the [Dosya Source Available License 1.0](LICENSE):

- **You can** read and audit the code, build and run it with the official
  [dosya.dev](https://dosya.dev) service, and contribute improvements.
- **You can't** redistribute it, use it with any backend other than dosya.dev, or offer
  it as a service.

See [LICENSE](LICENSE) for the exact terms.

## Contributing

Issues and pull requests are welcome. By submitting a contribution you license it to
dosya.dev under the contribution terms in [LICENSE](LICENSE).

## Security

Found a vulnerability? Please report it privately via
[GitHub private vulnerability reporting](../../security/advisories/new) rather than a
public issue.

## The dosya.dev client family

| Repository | What it is | License |
|---|---|---|
| [desktop](https://github.com/dosya-dev/desktop) | Desktop client — sync, upload, manage | Source-available |
| [cli](https://github.com/dosya-dev/cli) | Command-line interface | Source-available |
| [app.dosya.dev](https://github.com/dosya-dev/app.dosya.dev) | Web application | Source-available |
| [shared](https://github.com/dosya-dev/shared) | Shared TypeScript types & utilities | Source-available |
| [dosya-js](https://github.com/dosya-dev/dosya-js) | Official JavaScript SDK | MIT |
| [dosya-java](https://github.com/dosya-dev/dosya-java) | Official Java SDK | MIT |
