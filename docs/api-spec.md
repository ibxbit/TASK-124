# API Specification

## Authentication
- `POST /api/auth/login` — User login
- `POST /api/auth/logout` — User logout

## Query & Analytics
- `GET /api/queries` — List saved queries
- `POST /api/queries` — Save new query
- `GET /api/analytics/settlement` — Get settlement analytics (filters: date, provider, SKU, etc.)
- `GET /api/analytics/experiments` — Get experiment metrics (offline/online)

## Moderation
- `GET /api/moderation/queue` — Get moderation queue
- `POST /api/moderation/decision` — Submit moderation decision (approve/hide/restore)
- `POST /api/moderation/appeal` — Submit appeal

## Engagement
- `POST /api/engagement/comment` — Post comment (with anti-spam checks)
- `POST /api/engagement/like` — Like/favorite item
- `POST /api/engagement/follow` — Follow/unfollow user

## Export
- `POST /api/export` — Export data (CSV/Excel, up to 200,000 rows)

## System
- `GET /api/system/status` — App health/status
- `POST /api/system/update` — Import offline update package
- `POST /api/system/rollback` — Rollback to previous version
