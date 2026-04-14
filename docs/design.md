# Design Overview

## Architecture
- Electron desktop app (Windows 11, Svelte UI)
- Local Fastify REST API for UI and LAN access
- Embedded PostgreSQL for local data persistence
- AES-256 encryption for sensitive fields

## UI/UX
- Multi-window: Queue (moderation), Experiment Lab (A/B), Settlement Workbench (finance)
- Keyboard-first navigation (configurable shortcuts)
- Right-click context menus, deep clipboard support
- System tray mode for background jobs

## Key Flows
- Moderation: Reports/appeals routed to queue, actions logged immutably
- Analytics: Analysts build queries, filter/sort, export reports
- Settlement: Finance runs cycles, issues refunds, exports statements
- Engagement: Users comment, like, follow, with anti-spam and moderation

## Security & Reliability
- Encrypted-at-rest fields, masked UI display
- Crash recovery: periodic checkpoints, auto-restore
- Offline update/rollback with DB migration checkpoints

## Performance
- App starts in <5s, runs 30 days with <20% memory growth
- Export and dashboard limits enforced for performance
