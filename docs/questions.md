
# Business Gaps, Hypotheses, and Solutions

## Question: How to handle expired matches?
- **Hypothesis:** Auto-cancel after 3 mins per prompt.
- **Solution:** Implemented background cleanup logic.

---

## Question: How to ensure data privacy for sensitive financial fields?
- **Hypothesis:** Mask sensitive fields in UI, encrypt at rest.
- **Solution:** Use AES-256 encryption with OS-protected key store; mask all but last 4 digits in UI.

---

## Question: What is the process for handling moderation appeals?
- **Hypothesis:** Immutable decision log with appeal tracking.
- **Solution:** Moderators can hide/restore content, all actions logged with timestamps and user IDs.

---

## Question: How to prevent spam in engagement features?
- **Hypothesis:** Throttle comment/image rates, filter sensitive words.
- **Solution:** Max 30 comments/hour/user, 5 images/comment, 10MB/image, local dictionary for filtering.

---

## Question: How to support offline updates and rollback?
- **Hypothesis:** Manual import/export of update packages, migration checkpoints.
- **Solution:** Version management with rollback to prior version and DB migration checkpoints.
