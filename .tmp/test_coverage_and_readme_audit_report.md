# Test Coverage Audit

## Project Type Detection
- Declared in `repo/README.md:3` as `fullstack`.
- Static structure confirms fullstack: backend (`repo/backend/src`), frontend (`repo/frontend/src`), desktop shell (`repo/electron/src`).

## Backend Endpoint Inventory
Resolved from `repo/backend/src/server.js:83-90` and `repo/backend/src/routes/*.js`.

Total endpoints: **95**

1. `POST /auth/login`
2. `POST /auth/register`
3. `GET /auth/me`
4. `GET /health`
5. `POST /queries/execute`
6. `GET /queries/saved`
7. `POST /queries/saved`
8. `GET /queries/saved/:id`
9. `DELETE /queries/saved/:id`
10. `POST /exports`
11. `GET /exports`
12. `GET /exports/:id`
13. `GET /exports/:id/download`
14. `GET /experiments`
15. `POST /experiments`
16. `POST /experiments/:id/versions`
17. `GET /experiments/:id/assignment`
18. `GET /experiments/:id/metrics`
19. `POST /recommendations/evaluate`
20. `POST /experiments/events/ingest`
21. `POST /recommendations/runs/ingest`
22. `POST /reviews`
23. `GET /reviews`
24. `GET /reviews/:id`
25. `POST /reviews/:id/hide`
26. `POST /reviews/:id/restore`
27. `POST /reviews/:id/appeals`
28. `GET /appeals`
29. `POST /appeals/:id/resolve`
30. `GET /reviews/:id/decisions`
31. `POST /follows`
32. `DELETE /follows/:followeeId`
33. `GET /users/:id/followers`
34. `GET /users/:id/following`
35. `POST /likes`
36. `DELETE /likes`
37. `GET /likes/count`
38. `POST /comments`
39. `GET /comments`
40. `POST /reports`
41. `GET /reports`
42. `POST /reports/:id/resolve`
43. `POST /reports/:id/appeals`
44. `GET /content-appeals`
45. `POST /content-appeals/:id/resolve`
46. `GET /admin/blacklists`
47. `POST /admin/blacklists`
48. `DELETE /admin/blacklists/:id`
49. `GET /admin/throttle-policies`
50. `PUT /admin/throttle-policies/:key`
51. `POST /vault/credentials`
52. `GET /vault/credentials`
53. `GET /vault/credentials/:label/reveal`
54. `POST /vault/financial-tokens`
55. `GET /vault/financial-tokens`
56. `GET /vault/financial-tokens/:id/reveal`
57. `POST /finance/imports`
58. `POST /finance/payments`
59. `POST /finance/payments/:id/transition`
60. `GET /finance/commission-rates`
61. `PUT /finance/commission-rates`
62. `POST /settlement/run`
63. `GET /settlement/cycles`
64. `GET /settlement/cycles/:id/lines`
65. `POST /refunds/issue`
66. `GET /refunds`
67. `PATCH /refunds/:id`
68. `POST /refunds/:id/approve`
69. `POST /refunds/:id/reject`
70. `POST /refunds/:id/execute`
71. `GET /refunds/:id/audit`
72. `GET /risk-rules`
73. `PUT /risk-rules/:key`
74. `GET /reconciliation/export`
75. `GET /admin/versions`
76. `GET /admin/updates/current`
77. `GET /admin/updates`
78. `POST /admin/updates/import`
79. `POST /admin/updates/:id/apply`
80. `GET /admin/updates/:id/rollback/validate`
81. `POST /admin/updates/:id/rollback`
82. `GET /admin/snapshots`
83. `POST /admin/snapshots`
84. `GET /admin/checkpoints/recent`
85. `GET /admin/checkpoints/:kind/:key/latest`
86. `POST /admin/checkpoints/run-now`
87. `POST /admin/recovery/restore`
88. `GET /admin/recovery/events`
89. `GET /admin/health`
90. `GET /admin/memory/status`
91. `GET /admin/memory/alerts`
92. `POST /admin/memory/housekeeping`
93. `GET /admin/lan-allowlist`
94. `POST /admin/lan-allowlist`
95. `DELETE /admin/lan-allowlist/:id`

## API Test Mapping Table

Evidence baseline for HTTP layer realism:
- App bootstrap uses real Fastify app factory (`build`) and migrations from backend: `repo/API_tests/helpers.js:19-30`.
- Requests go through `app.inject(...)`: e.g., `repo/API_tests/auth.test.js:11-14`.
- No `jest.mock`, `vi.mock`, `sinon.stub`, proxyquire, or DI override patterns found in `repo/API_tests/**/*.js`.

| Endpoint | Covered | Test Type | Test Files | Evidence |
|---|---|---|---|---|
| `POST /auth/login` | yes | true no-mock HTTP | `repo/API_tests/auth.test.js` | `POST /auth/login...returns token` (`repo/API_tests/auth.test.js:9`) |
| `POST /auth/register` | yes | true no-mock HTTP | `repo/API_tests/auth.test.js` | `POST /auth/register...creates a new user` (`repo/API_tests/auth.test.js:58`) |
| `GET /auth/me` | yes | true no-mock HTTP | `repo/API_tests/auth.test.js`, `repo/API_tests/http_coverage_closure.test.js` | `GET /auth/me...returns user object` (`repo/API_tests/auth.test.js:47`) |
| `GET /health` | yes | true no-mock HTTP | `repo/API_tests/health.test.js`, `repo/API_tests/server_boot.test.js` | `GET /health is public...` (`repo/API_tests/health.test.js:9`) |
| `POST /queries/execute` | yes | true no-mock HTTP | `repo/API_tests/analytics.test.js`, `repo/API_tests/rbac.test.js` | `POST /queries/execute returns rows...` (`repo/API_tests/analytics.test.js:9`) |
| `GET /queries/saved` | yes | true no-mock HTTP | `repo/API_tests/analytics.test.js` | `GET /queries/saved returns array...` (`repo/API_tests/analytics.test.js:40`) |
| `POST /queries/saved` | yes | true no-mock HTTP | `repo/API_tests/analytics.test.js` | `POST /queries/saved creates...` (`repo/API_tests/analytics.test.js:25`) |
| `GET /queries/saved/:id` | yes | true no-mock HTTP | `repo/API_tests/saved_queries.test.js` | `GET /queries/saved/:id returns...` (`repo/API_tests/saved_queries.test.js:34`) |
| `DELETE /queries/saved/:id` | yes | true no-mock HTTP | `repo/API_tests/saved_queries.test.js`, `repo/API_tests/http_coverage_closure.test.js` | `DELETE /queries/saved/:id removes...` (`repo/API_tests/saved_queries.test.js:61`) |
| `POST /exports` | yes | true no-mock HTTP | `repo/API_tests/analytics.test.js`, `repo/API_tests/authorized_list_endpoints.test.js` | `POST /exports validates format...` (`repo/API_tests/analytics.test.js:51`) |
| `GET /exports` | yes | true no-mock HTTP | `repo/API_tests/authorized_list_endpoints.test.js` | `GET /exports returns analyst's job list...` (`repo/API_tests/authorized_list_endpoints.test.js:16`) |
| `GET /exports/:id` | yes | true no-mock HTTP | `repo/API_tests/http_coverage_closure.test.js` | `GET /exports/:id returns...` (`repo/API_tests/http_coverage_closure.test.js:318`) |
| `GET /exports/:id/download` | yes | true no-mock HTTP | `repo/API_tests/http_coverage_closure.test.js`, `repo/API_tests/reconciliation_exports.test.js` | `GET /exports/:id/download streams...` (`repo/API_tests/http_coverage_closure.test.js:343`) |
| `GET /experiments` | yes | true no-mock HTTP | `repo/API_tests/experiments.test.js`, `repo/API_tests/rbac.test.js` | `GET /experiments returns array` (`repo/API_tests/experiments.test.js:77`) |
| `POST /experiments` | yes | true no-mock HTTP | `repo/API_tests/experiments.test.js`, `repo/API_tests/identity_binding.test.js` | `POST /experiments creates...` (`repo/API_tests/experiments.test.js:9`) |
| `POST /experiments/:id/versions` | yes | true no-mock HTTP | `repo/API_tests/experiments.test.js`, `repo/API_tests/http_coverage_closure.test.js` | `...creates a version` (`repo/API_tests/experiments.test.js:23`) |
| `GET /experiments/:id/assignment` | yes | true no-mock HTTP | `repo/API_tests/experiments.test.js`, `repo/API_tests/http_coverage_closure.test.js` | `...returns deterministic bucket` (`repo/API_tests/experiments.test.js:45`) |
| `GET /experiments/:id/metrics` | yes | true no-mock HTTP | `repo/API_tests/experiment_ingestion.test.js` | `metrics with low impressions...` (`repo/API_tests/experiment_ingestion.test.js:126`) |
| `POST /recommendations/evaluate` | yes | true no-mock HTTP | `repo/API_tests/http_coverage_closure.test.js` | `...returns metrics for seeded run` (`repo/API_tests/http_coverage_closure.test.js:489`) |
| `POST /experiments/events/ingest` | yes | true no-mock HTTP | `repo/API_tests/experiments.test.js`, `repo/API_tests/experiment_ingestion.test.js` | `...inserts events` (`repo/API_tests/experiments.test.js:90`) |
| `POST /recommendations/runs/ingest` | yes | true no-mock HTTP | `repo/API_tests/experiments.test.js`, `repo/API_tests/experiment_ingestion.test.js` | `...creates a run...` (`repo/API_tests/experiments.test.js:173`) |
| `POST /reviews` | yes | true no-mock HTTP | `repo/API_tests/reviews.test.js`, `repo/API_tests/moderation.test.js` | `POST /reviews creates a review...` (`repo/API_tests/reviews.test.js:15`) |
| `GET /reviews` | yes | true no-mock HTTP | `repo/API_tests/authorized_list_endpoints.test.js`, `repo/API_tests/reviews.test.js` | `GET /reviews returns array...` (`repo/API_tests/authorized_list_endpoints.test.js:77`) |
| `GET /reviews/:id` | yes | true no-mock HTTP | `repo/API_tests/http_coverage_closure.test.js` | `GET /reviews/:id returns...` (`repo/API_tests/http_coverage_closure.test.js:756`) |
| `POST /reviews/:id/hide` | yes | true no-mock HTTP | `repo/API_tests/reviews.test.js`, `repo/API_tests/http_coverage_closure.test.js` | `...moves review to hidden` (`repo/API_tests/http_coverage_closure.test.js:787`) |
| `POST /reviews/:id/restore` | yes | true no-mock HTTP | `repo/API_tests/reviews.test.js`, `repo/API_tests/http_coverage_closure.test.js` | `...moves hidden review back...` (`repo/API_tests/http_coverage_closure.test.js:812`) |
| `POST /reviews/:id/appeals` | yes | true no-mock HTTP | `repo/API_tests/reviews.test.js`, `repo/API_tests/http_coverage_closure.test.js` | `...creates appeal...` (`repo/API_tests/http_coverage_closure.test.js:826`) |
| `GET /appeals` | yes | true no-mock HTTP | `repo/API_tests/moderation.test.js` | `GET /appeals returns array...` (`repo/API_tests/moderation.test.js:71`) |
| `POST /appeals/:id/resolve` | yes | true no-mock HTTP | `repo/API_tests/reviews.test.js`, `repo/API_tests/http_coverage_closure.test.js` | `...resolve with overturned...` (`repo/API_tests/http_coverage_closure.test.js:853`) |
| `GET /reviews/:id/decisions` | yes | true no-mock HTTP | `repo/API_tests/reviews.test.js`, `repo/API_tests/http_coverage_closure.test.js` | `...returns immutable log` (`repo/API_tests/reviews.test.js:92`) |
| `POST /follows` | yes | true no-mock HTTP | `repo/API_tests/cross_user_access.test.js` | `...follow and unfollow are scoped...` (`repo/API_tests/cross_user_access.test.js:68`) |
| `DELETE /follows/:followeeId` | yes | true no-mock HTTP | `repo/API_tests/cross_user_access.test.js` | same test scope (`repo/API_tests/cross_user_access.test.js:68`) |
| `GET /users/:id/followers` | yes | true no-mock HTTP | `repo/API_tests/http_coverage_closure.test.js` | `...returns follower rows` (`repo/API_tests/http_coverage_closure.test.js:369`) |
| `GET /users/:id/following` | yes | true no-mock HTTP | `repo/API_tests/http_coverage_closure.test.js` | `...returns followee rows` (`repo/API_tests/http_coverage_closure.test.js:384`) |
| `POST /likes` | yes | true no-mock HTTP | `repo/API_tests/cross_user_access.test.js` | like ownership test (`repo/API_tests/cross_user_access.test.js:107`) |
| `DELETE /likes` | yes | true no-mock HTTP | `repo/API_tests/cross_user_access.test.js` | like ownership test (`repo/API_tests/cross_user_access.test.js:107`) |
| `GET /likes/count` | yes | true no-mock HTTP | `repo/API_tests/cross_user_access.test.js` | like count check (`repo/API_tests/cross_user_access.test.js:107`) |
| `POST /comments` | yes | true no-mock HTTP | `repo/API_tests/antispam.test.js`, `repo/API_tests/identity_binding.test.js` | `normal comment creation succeeds` (`repo/API_tests/antispam.test.js:16`) |
| `GET /comments` | yes | true no-mock HTTP | `repo/API_tests/antispam.test.js` | `GET /comments returns thread...` (`repo/API_tests/antispam.test.js:184`) |
| `POST /reports` | yes | true no-mock HTTP | `repo/API_tests/engagement_appeals.test.js`, `repo/API_tests/moderation.test.js` | `...create a content report` (`repo/API_tests/engagement_appeals.test.js:16`) |
| `GET /reports` | yes | true no-mock HTTP | `repo/API_tests/moderation.test.js`, `repo/API_tests/engagement_appeals.test.js` | `GET /reports returns open reports...` (`repo/API_tests/moderation.test.js:12`) |
| `POST /reports/:id/resolve` | yes | true no-mock HTTP | `repo/API_tests/engagement_appeals.test.js` | `...resolve a report...` (`repo/API_tests/engagement_appeals.test.js:44`) |
| `POST /reports/:id/appeals` | yes | true no-mock HTTP | `repo/API_tests/engagement_appeals.test.js` | `...submit an appeal...` (`repo/API_tests/engagement_appeals.test.js:123`) |
| `GET /content-appeals` | yes | true no-mock HTTP | `repo/API_tests/engagement_appeals.test.js` | permission test (`repo/API_tests/engagement_appeals.test.js:274`) |
| `POST /content-appeals/:id/resolve` | yes | true no-mock HTTP | `repo/API_tests/engagement_appeals.test.js` | `...resolve an appeal...` (`repo/API_tests/engagement_appeals.test.js:167`) |
| `GET /admin/blacklists` | yes | true no-mock HTTP | `repo/API_tests/antispam.test.js` | blacklist access tests (`repo/API_tests/antispam.test.js:172`) |
| `POST /admin/blacklists` | yes | true no-mock HTTP | `repo/API_tests/antispam.test.js` | blacklist add in setup flow (`repo/API_tests/antispam.test.js:85`) |
| `DELETE /admin/blacklists/:id` | yes | true no-mock HTTP | `repo/API_tests/http_coverage_closure.test.js` | `...removes blacklist entry` (`repo/API_tests/http_coverage_closure.test.js:408`) |
| `GET /admin/throttle-policies` | yes | true no-mock HTTP | `repo/API_tests/antispam.test.js` | `admin can list throttle policies` (`repo/API_tests/antispam.test.js:139`) |
| `PUT /admin/throttle-policies/:key` | yes | true no-mock HTTP | `repo/API_tests/antispam.test.js` | `admin can set a throttle policy` (`repo/API_tests/antispam.test.js:150`) |
| `POST /vault/credentials` | yes | true no-mock HTTP | `repo/API_tests/vault.test.js` | `...store credentials` (`repo/API_tests/vault.test.js:11`) |
| `GET /vault/credentials` | yes | true no-mock HTTP | `repo/API_tests/vault.test.js` | `...list own credentials...` (`repo/API_tests/vault.test.js:25`) |
| `GET /vault/credentials/:label/reveal` | yes | true no-mock HTTP | `repo/API_tests/vault.test.js` | reveal permission test (`repo/API_tests/vault.test.js:42`) |
| `POST /vault/financial-tokens` | yes | true no-mock HTTP | `repo/API_tests/vault.test.js`, `repo/API_tests/vault_boundaries.test.js` | `finance can store...` (`repo/API_tests/vault.test.js:70`) |
| `GET /vault/financial-tokens` | yes | true no-mock HTTP | `repo/API_tests/vault.test.js` | list permission test (`repo/API_tests/vault.test.js:93`) |
| `GET /vault/financial-tokens/:id/reveal` | yes | true no-mock HTTP | `repo/API_tests/vault.test.js`, `repo/API_tests/vault_boundaries.test.js` | owner/admin boundary tests (`repo/API_tests/vault.test.js:111`) |
| `POST /finance/imports` | yes | true no-mock HTTP | `repo/API_tests/http_coverage_closure.test.js` | multipart ingest test (`repo/API_tests/http_coverage_closure.test.js:540`) |
| `POST /finance/payments` | yes | true no-mock HTTP | `repo/API_tests/finance.test.js`, `repo/API_tests/settlement_run.test.js` | `...creates a payment...` (`repo/API_tests/finance.test.js:11`) |
| `POST /finance/payments/:id/transition` | yes | true no-mock HTTP | `repo/API_tests/finance.test.js`, `repo/API_tests/http_coverage_closure.test.js` | transition test (`repo/API_tests/finance.test.js:49`) |
| `GET /finance/commission-rates` | yes | true no-mock HTTP | `repo/API_tests/finance.test.js` | `...returns rates...` (`repo/API_tests/finance.test.js:94`) |
| `PUT /finance/commission-rates` | yes | true no-mock HTTP | `repo/API_tests/finance.test.js`, `repo/API_tests/rbac.test.js` | update rate test (`repo/API_tests/finance.test.js:107`) |
| `POST /settlement/run` | yes | true no-mock HTTP | `repo/API_tests/finance.test.js`, `repo/API_tests/settlement_run.test.js` | settlement run test (`repo/API_tests/finance.test.js:132`) |
| `GET /settlement/cycles` | yes | true no-mock HTTP | `repo/API_tests/finance.test.js`, `repo/API_tests/settlement_run.test.js` | list cycles test (`repo/API_tests/finance.test.js:121`) |
| `GET /settlement/cycles/:id/lines` | yes | true no-mock HTTP | `repo/API_tests/settlement_run.test.js`, `repo/API_tests/http_coverage_closure.test.js` | lines test (`repo/API_tests/settlement_run.test.js:61`) |
| `POST /refunds/issue` | yes | true no-mock HTTP | `repo/API_tests/refunds.test.js`, `repo/API_tests/authorized_list_endpoints.test.js` | issue refund test (`repo/API_tests/refunds.test.js:23`) |
| `GET /refunds` | yes | true no-mock HTTP | `repo/API_tests/refunds.test.js`, `repo/API_tests/authorized_list_endpoints.test.js` | list refunds test (`repo/API_tests/authorized_list_endpoints.test.js:141`) |
| `PATCH /refunds/:id` | yes | true no-mock HTTP | `repo/API_tests/http_coverage_closure.test.js` | patch refund test (`repo/API_tests/http_coverage_closure.test.js:617`) |
| `POST /refunds/:id/approve` | yes | true no-mock HTTP | `repo/API_tests/refunds.test.js`, `repo/API_tests/http_coverage_closure.test.js` | approve test (`repo/API_tests/http_coverage_closure.test.js:645`) |
| `POST /refunds/:id/reject` | yes | true no-mock HTTP | `repo/API_tests/refunds.test.js`, `repo/API_tests/http_coverage_closure.test.js` | reject test (`repo/API_tests/http_coverage_closure.test.js:671`) |
| `POST /refunds/:id/execute` | yes | true no-mock HTTP | `repo/API_tests/refunds.test.js`, `repo/API_tests/http_coverage_closure.test.js` | execute test (`repo/API_tests/http_coverage_closure.test.js:696`) |
| `GET /refunds/:id/audit` | yes | true no-mock HTTP | `repo/API_tests/refunds.test.js`, `repo/API_tests/http_coverage_closure.test.js` | audit trail test (`repo/API_tests/refunds.test.js:126`) |
| `GET /risk-rules` | yes | true no-mock HTTP | `repo/API_tests/refunds.test.js`, `repo/API_tests/authorized_list_endpoints.test.js` | risk rules list (`repo/API_tests/refunds.test.js:146`) |
| `PUT /risk-rules/:key` | yes | true no-mock HTTP | `repo/API_tests/refunds.test.js`, `repo/API_tests/authorized_list_endpoints.test.js` | update test (`repo/API_tests/authorized_list_endpoints.test.js:201`) |
| `GET /reconciliation/export` | yes | true no-mock HTTP | `repo/API_tests/reconciliation.test.js`, `repo/API_tests/reconciliation_exports.test.js` | reconciliation export checks (`repo/API_tests/reconciliation.test.js:9`) |
| `GET /admin/versions` | yes | true no-mock HTTP | `repo/API_tests/versioning.test.js` | `GET /admin/versions...` (`repo/API_tests/versioning.test.js:15`) |
| `GET /admin/updates/current` | yes | true no-mock HTTP | `repo/API_tests/versioning.test.js` | current version test (`repo/API_tests/versioning.test.js:48`) |
| `GET /admin/updates` | yes | true no-mock HTTP | `repo/API_tests/versioning.test.js` | updates list test (`repo/API_tests/versioning.test.js:64`) |
| `POST /admin/updates/import` | yes | true no-mock HTTP | `repo/API_tests/versioning.test.js`, `repo/API_tests/versioning_permissions.test.js` | multipart rejection test (`repo/API_tests/versioning.test.js:146`) |
| `POST /admin/updates/:id/apply` | yes | true no-mock HTTP | `repo/API_tests/versioning_permissions.test.js` | nonexistent apply test (`repo/API_tests/versioning_permissions.test.js:93`) |
| `GET /admin/updates/:id/rollback/validate` | yes | true no-mock HTTP | `repo/API_tests/versioning.test.js` | validate rollback test (`repo/API_tests/versioning.test.js:131`) |
| `POST /admin/updates/:id/rollback` | yes | true no-mock HTTP | `repo/API_tests/versioning_permissions.test.js` | rollback permission/error path (`repo/API_tests/versioning_permissions.test.js:135`) |
| `GET /admin/snapshots` | yes | true no-mock HTTP | `repo/API_tests/versioning.test.js` | snapshots list (`repo/API_tests/versioning.test.js:82`) |
| `POST /admin/snapshots` | yes | true no-mock HTTP | `repo/API_tests/versioning.test.js` | create snapshot (`repo/API_tests/versioning.test.js:99`) |
| `GET /admin/checkpoints/recent` | yes | true no-mock HTTP | `repo/API_tests/admin_routes.test.js`, `repo/API_tests/health.test.js` | checkpoints list (`repo/API_tests/admin_routes.test.js:62`) |
| `GET /admin/checkpoints/:kind/:key/latest` | yes | true no-mock HTTP | `repo/API_tests/admin_routes.test.js` | latest checkpoint test (`repo/API_tests/admin_routes.test.js:84`) |
| `POST /admin/checkpoints/run-now` | yes | true no-mock HTTP | `repo/API_tests/admin_routes.test.js`, `repo/API_tests/navigation_flow.test.js` | run-now test (`repo/API_tests/admin_routes.test.js:73`) |
| `POST /admin/recovery/restore` | yes | true no-mock HTTP | `repo/API_tests/crash_recovery.test.js` | manual restore test (`repo/API_tests/crash_recovery.test.js:17`) |
| `GET /admin/recovery/events` | yes | true no-mock HTTP | `repo/API_tests/crash_recovery.test.js`, `repo/API_tests/health.test.js` | events visible test (`repo/API_tests/crash_recovery.test.js:36`) |
| `GET /admin/health` | yes | true no-mock HTTP | `repo/API_tests/admin_routes.test.js` | admin health test (`repo/API_tests/admin_routes.test.js:14`) |
| `GET /admin/memory/status` | yes | true no-mock HTTP | `repo/API_tests/admin_routes.test.js` | memory status test (`repo/API_tests/admin_routes.test.js:27`) |
| `GET /admin/memory/alerts` | yes | true no-mock HTTP | `repo/API_tests/admin_routes.test.js` | memory alerts test (`repo/API_tests/admin_routes.test.js:37`) |
| `POST /admin/memory/housekeeping` | yes | true no-mock HTTP | `repo/API_tests/admin_routes.test.js` | housekeeping test (`repo/API_tests/admin_routes.test.js:48`) |
| `GET /admin/lan-allowlist` | yes | true no-mock HTTP | `repo/API_tests/admin_routes.test.js` | allowlist list (`repo/API_tests/admin_routes.test.js:120`) |
| `POST /admin/lan-allowlist` | yes | true no-mock HTTP | `repo/API_tests/admin_routes.test.js` | roundtrip create/list/delete (`repo/API_tests/admin_routes.test.js:131`) |
| `DELETE /admin/lan-allowlist/:id` | yes | true no-mock HTTP | `repo/API_tests/http_coverage_closure.test.js`, `repo/API_tests/admin_routes.test.js` | delete allowlist test (`repo/API_tests/http_coverage_closure.test.js:271`) |

## API Test Classification

1. **True No-Mock HTTP**
   - `repo/API_tests/admin_routes.test.js`
   - `repo/API_tests/admin_security.test.js`
   - `repo/API_tests/analytics.test.js`
   - `repo/API_tests/antispam.test.js`
   - `repo/API_tests/auth.test.js`
   - `repo/API_tests/authorized_list_endpoints.test.js`
   - `repo/API_tests/crash_recovery.test.js`
   - `repo/API_tests/cross_user_access.test.js`
   - `repo/API_tests/engagement_appeals.test.js`
   - `repo/API_tests/experiment_ingestion.test.js`
   - `repo/API_tests/experiments.test.js`
   - `repo/API_tests/finance.test.js`
   - `repo/API_tests/health.test.js`
   - `repo/API_tests/http_coverage_closure.test.js`
   - `repo/API_tests/identity_binding.test.js`
   - `repo/API_tests/moderation.test.js`
   - `repo/API_tests/rbac.test.js`
   - `repo/API_tests/reconciliation.test.js`
   - `repo/API_tests/reconciliation_exports.test.js`
   - `repo/API_tests/refunds.test.js`
   - `repo/API_tests/reviews.test.js`
   - `repo/API_tests/saved_queries.test.js`
   - `repo/API_tests/settlement_run.test.js`
   - `repo/API_tests/settlement_timing.test.js`
   - `repo/API_tests/vault.test.js`
   - `repo/API_tests/vault_boundaries.test.js`
   - `repo/API_tests/versioning.test.js`
   - `repo/API_tests/versioning_permissions.test.js`

2. **HTTP with Mocking**
   - None found.

3. **Non-HTTP (unit/integration without HTTP) or mixed**
   - `repo/API_tests/service/coverage_boost_service.test.js` (direct service calls; comment confirms no `app.inject`, `repo/API_tests/service/coverage_boost_service.test.js:3-5`)
   - `repo/API_tests/service/service_deep.test.js` (direct service-layer execution)
   - `repo/API_tests/service/versioning_lifecycle.test.js` (direct versioning services)
   - `repo/API_tests/service/moderation_service.test.js` (mostly direct service calls; one HTTP setup call)
   - `repo/API_tests/server_boot.test.js` (mixed: one `/health` request plus many direct service calls, `repo/API_tests/server_boot.test.js:26-31`)

## Mock Detection

- `jest.mock`, `vi.mock`, `sinon.stub`: **not detected** in `repo/API_tests/**/*.js`.
- DI overrides / provider stubs in API HTTP path: **not detected**.
- Controller/service bypass in dedicated API test files: **detected** in non-HTTP service tests:
  - `repo/API_tests/server_boot.test.js:26-31`
  - `repo/API_tests/service/coverage_boost_service.test.js:3-5`
  - `repo/API_tests/service/moderation_service.test.js` (direct service invocations)
  - `repo/API_tests/service/service_deep.test.js`
  - `repo/API_tests/service/versioning_lifecycle.test.js`

## Coverage Summary

- Total endpoints: **95**
- Endpoints with HTTP tests: **95**
- Endpoints with true no-mock HTTP tests: **95**
- HTTP coverage: **100.0%**
- True API coverage: **100.0%**

## Unit Test Analysis

### Backend Unit Tests

Detected backend unit test files (`repo/unit_tests/*.test.js`), with direct module evidence:
- RBAC: `repo/unit_tests/rbac.test.js` -> `backend/src/rbac/roles.js`.
- Core services/math/validation: `bucketing`, `stats`, `queryBuilder`, `reviewValidation`, `spamService`, `offlineMetrics`.
- Finance/export/versioning primitives: `settlementService`, `exportValidation`, `exportService`, `exportRowLimit`, `updateService`, `importParser`.
- Reliability/security: `checkpointIntegrity`, `memoryService`, `startupTimer`, `encryption`.
- Frontend utility in unit suite: `repo/unit_tests/masking.test.js` imports `repo/frontend/src/lib/mask.js`.

Coverage shape by layer:
- Controllers/routes: **no dedicated backend route/controller unit tests** (route behavior covered via API HTTP tests instead).
- Services: **broad but selective**; many service modules tested, many still untested directly.
- Repositories: **no explicit repository layer tests** (no repository module structure detected).
- Auth/guards/middleware: role matrix tested (`repo/unit_tests/rbac.test.js`), but no direct unit file for `backend/src/rbac/middleware.js` or `backend/src/auth/authPlugin.js`.

Important backend modules not directly unit-tested (evidence: present in `repo/backend/src/services`, absent from `repo/unit_tests` imports):
- `backend/src/services/paymentService.js`
- `backend/src/services/refundService.js`
- `backend/src/services/reviewService.js`
- `backend/src/services/commentService.js`
- `backend/src/services/followService.js`
- `backend/src/services/likeService.js`
- `backend/src/services/contentReportService.js`
- `backend/src/services/queryService.js`
- `backend/src/services/experimentService.js`
- `backend/src/services/recoveryService.js`
- `backend/src/services/snapshotService.js`
- `backend/src/services/rollbackService.js`
- `backend/src/services/lanAllowlistService.js`
- `backend/src/services/adminControlService.js`

### Frontend Unit Tests

Frontend unit tests are **explicitly present** and satisfy strict detection conditions:
- Identifiable files: `repo/frontend_tests/*.test.js` (12 test files).
- Framework/tooling evident: `node:test` (`repo/frontend_tests/App.test.js:8`, etc.), custom Svelte compiler harness (`repo/frontend_tests/_svelte.js:66-100`).
- Real frontend modules/components imported/rendered:
  - Components: `App.svelte`, `LoginView.svelte`, `ContextMenu.svelte`, `AuditLogWindow.svelte`, `QueueWindow.svelte`, `ExperimentLabWindow.svelte`, `SettlementWorkbenchWindow.svelte`.
  - Frontend libs: `api.js`, `router.js`, `shortcuts.js`, `clipboard.js`, `contextActions.js`.

Covered frontend modules/components:
- `repo/frontend/src/App.svelte`
- `repo/frontend/src/lib/LoginView.svelte`
- `repo/frontend/src/lib/ContextMenu.svelte`
- `repo/frontend/src/windows/AuditLogWindow.svelte`
- `repo/frontend/src/windows/QueueWindow.svelte`
- `repo/frontend/src/windows/ExperimentLabWindow.svelte`
- `repo/frontend/src/windows/SettlementWorkbenchWindow.svelte`
- `repo/frontend/src/lib/api.js`
- `repo/frontend/src/lib/router.js`
- `repo/frontend/src/lib/shortcuts.js`
- `repo/frontend/src/lib/clipboard.js`
- `repo/frontend/src/lib/contextActions.js`
- `repo/frontend/src/lib/mask.js` (tested in `repo/unit_tests/masking.test.js`)

Important frontend modules not tested (or not directly evidenced):
- `repo/frontend/src/main.js` (no direct test file reference found).

**Mandatory Verdict: Frontend unit tests: PRESENT**

### Cross-Layer Observation

- Backend API HTTP coverage is very high (95/95 endpoints).
- Frontend unit/component coverage is present and non-trivial.
- Balance is acceptable; no backend-only skew severe enough for a critical-gap flag.

## API Observability Check

- Strong overall: tests usually include explicit method/path, request payload, status assertions, and response body checks (example: `repo/API_tests/auth.test.js:11-18`, `repo/API_tests/finance.test.js`, `repo/API_tests/refunds.test.js`).
- Minor weakness pockets: some tests are status-only or broad-object assertions without deep response schema checks (`repo/API_tests/server_boot.test.js:18-24`, some permission-denial tests).

Observability verdict: **Mostly strong, with minor weak assertions in a subset.**

## Test Quality & Sufficiency

- Success paths: broadly covered across auth, analytics, experiments, moderation, finance, refunds, admin.
- Failure paths: present (401/403/404/409/validation checks) across many suites.
- Edge cases: present for permissions, duplicate states, multipart validation, idempotency and lifecycle cases.
- Validation/auth: strong; RBAC and role-scoped access frequently tested.
- Integration boundaries: real HTTP + real DB are exercised via shared app bootstrap.
- Superficial/autogenerated risk: low for core API suites; medium in some service coverage-boost files with loose assertions.

`run_tests.sh` check:
- Docker-based workflow supported (`repo/run_tests.sh:5-15` and Compose profile in `repo/docker-compose.yml:47-67`).
- Local dependency path exists and is explicitly referenced (`repo/run_tests.sh:30-38` suggests `npm ci`) -> **FLAG (strict policy)**.

## End-to-End Expectations

- Fullstack expectation: FE<->BE real-flow tests should exist.
- Present:
  - Fetch-shim E2E using real backend handlers and frontend API module (`repo/e2e_tests/helpers.js:4-8`).
  - Real browser Playwright E2E exists (`repo/e2e_tests/browser_realistic.test.js:3-10`).
- Constraint: browser E2E is skip-guarded by environment preconditions (`repo/e2e_tests/browser_realistic.test.js:101-131`), so it may not execute in all CI/runtime setups.

## Tests Check

- Endpoint inventory complete: **yes**.
- API mapping per endpoint: **complete (95/95)**.
- Mock detection completed: **yes**.
- Backend unit tests: **present**.
- Frontend unit tests: **PRESENT**.
- Critical gap rule for missing frontend tests in fullstack/web: **not triggered**.

## Test Coverage Score (0-100)

**91/100**

## Score Rationale

- +45: Full endpoint HTTP coverage and true no-mock API execution path (`95/95`).
- +20: Broad backend unit tests over critical pure/business logic modules.
- +15: Frontend unit/component suite clearly present and tied to real frontend code.
- +6: E2E coverage exists, including a real browser path.
- -4: Some tests rely on shallow assertions or status-only checks.
- -4: Additional non-HTTP service tests in API suite mix concerns and include looser assertion quality.
- -3: `run_tests.sh` includes local dependency path (`npm ci`) under strict Docker-contained policy.

## Key Gaps

1. Local dependency fallback in test runner conflicts with strict Docker-contained expectation (`repo/run_tests.sh:30-38`).
2. Several important backend services lack direct unit tests (payment/refund/review/comment/follow/like/contentReport/recovery/snapshot/rollback/adminControl/lanAllowlist).
3. `repo/frontend/src/main.js` lacks explicit direct test coverage evidence.
4. Minor subset of API tests assert status only, reducing behavioral depth.

## Confidence & Assumptions

- Confidence: **high** for endpoint inventory and HTTP mapping (route files and test files were statically inspected).
- Confidence: **medium-high** for quality scoring (inherently judgment-based).
- Assumption: `backend/src/server.js` is canonical runtime entry (supported by `repo/backend/package.json:5-8`).
- No runtime execution performed; conclusions are static-only.

**Test Coverage Verdict: PASS (with strict-policy flags)**

---

# README Audit

## README Location Check

- Required file exists: `repo/README.md`.

## Hard Gate Evaluation

### Formatting
- Pass. Markdown is structured with headings/tables/code blocks (`repo/README.md`).

### Startup Instructions
- Pass (fullstack requirement). Includes explicit `docker-compose up` at top (`repo/README.md:10-14`).

### Access Method
- Pass. URL + port documented for frontend and backend (`repo/README.md:24-29`).

### Verification Method
- Pass. Includes API verification (`curl` health/auth/RBAC/finance/refund checks) and web UI verification flow (`repo/README.md:133-240`).

### Environment Rules (strict Docker-contained)
- Pass by README content. README explicitly disallows manual install flows and manual DB setup (`repo/README.md:16-18`, `repo/README.md:275-292`).
- Note: cross-file inconsistency exists with `repo/run_tests.sh:30-38` mentioning local `npm ci` fallback (documented below as quality issue, not direct README hard-gate failure).

### Demo Credentials (conditional auth)
- Pass. Auth exists and all roles include username/password (`repo/README.md:30-40`).

## Engineering Quality Review

- Tech stack clarity: strong (`repo/README.md:3`, architecture and structure sections).
- Architecture explanation: strong (service map, routes, data migrations, desktop packaging).
- Testing instructions: strong and concrete (`repo/README.md:109-127`, `repo/README.md:235-240`).
- Security/roles coverage: strong (`repo/README.md:244-272`).
- Workflow clarity: generally strong; one consistency gap with test-runner local fallback.

## High Priority Issues

1. **Claim-to-script inconsistency on Docker-only test flow**: README says no supported manual install/local workflow (`repo/README.md:275-292`), but `repo/run_tests.sh:30-38` explicitly documents local `npm ci` fallback.

## Medium Priority Issues

1. README is very large (600+ lines) and repeats some operational details, which raises maintenance drift risk.
2. Some manual verification guidance references shell pipes/grep commands in prose; these checks can age quickly when log formats change.

## Low Priority Issues

1. Project includes both desktop and web operation details; navigation could be improved with a short quick-start index near top.

## Hard Gate Failures

- **None**.

## README Verdict

**PASS**

---

**Final Combined Verdicts**
- Test Coverage Audit: **PASS (with strict-policy flags)**
- README Audit: **PASS**
