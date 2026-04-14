'use strict';

const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/pool');
const wordFilter = require('./sensitiveWordFilter');
const admin = require('./adminControlService');
const spam = require('./spamService');
const config = require('../config');

const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

const COMMENT_UPLOAD_DIR = path.join(config.uploadDir, 'comments');
if (!fs.existsSync(COMMENT_UPLOAD_DIR)) fs.mkdirSync(COMMENT_UPLOAD_DIR, { recursive: true });

function extractMentions(body) {
  const out = new Set();
  const re = /(^|[^a-zA-Z0-9_])@([a-zA-Z0-9_]{2,32})\b/g;
  let m;
  while ((m = re.exec(body))) out.add(m[2]);
  return [...out];
}

// checkThrottle moved into spamService.evaluateCommentCreate (sliding-window
// + device-burst + duplicate-content + user-score gate in one evaluation).

function validateImages(images = []) {
  if (images.length > MAX_IMAGES) {
    const e = new Error(`Too many images (max ${MAX_IMAGES})`); e.status = 400; throw e;
  }
  for (const img of images) {
    if (!ALLOWED_MIME.has(img.mime))   { const e = new Error(`Unsupported image type: ${img.mime}`); e.status = 400; throw e; }
    if (img.size > MAX_IMAGE_BYTES)    { const e = new Error(`Image exceeds 10MB`);                   e.status = 400; throw e; }
  }
}

function saveImages(images) {
  const saved = [];
  for (const img of images) {
    const ext = img.mime.split('/')[1];
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const fullPath = path.join(COMMENT_UPLOAD_DIR, filename);
    fs.writeFileSync(fullPath, img.buffer);
    saved.push({ path: fullPath, size: img.size, mime: img.mime });
  }
  return saved;
}

async function createComment(authorId, input) {
  const body = String(input.body || '').trim();
  if (!body && !(input.images && input.images.length)) {
    const e = new Error('body or images required'); e.status = 400; throw e;
  }
  if (!input.targetType || !input.targetId) {
    const e = new Error('targetType and targetId required'); e.status = 400; throw e;
  }

  if (await admin.isUserBlacklisted(authorId)) {
    await spam.applySignal(authorId, 'blacklisted_user');
    const e = new Error('User is blacklisted'); e.status = 403; throw e;
  }

  const hits = await wordFilter.scan(body);
  if (hits.length) {
    await spam.applySignal(authorId, 'sensitive_word');
    const e = new Error(`Content blocked: sensitive terms (${hits.join(', ')})`);
    e.status = 422; throw e;
  }

  // Unified anti-spam gate: sliding-window rate limit + device-burst +
  // duplicate-content + user spam-score threshold.
  const policy = await admin.getThrottlePolicy('comments_per_hour');
  const gate = await spam.evaluateCommentCreate({
    userId:     authorId,
    deviceId:   input.deviceId || null,
    targetType: input.targetType,
    body,
    throttlePolicy: policy
  });
  if (gate.action === 'block') {
    const e = new Error(`Comment blocked: ${gate.reason}`);
    e.status = gate.status;
    e.details = gate.details;
    e.reason = gate.reason;
    throw e;
  }

  const images = input.images || [];
  validateImages(images);
  const saved = saveImages(images);
  const mentions = extractMentions(body);

  const db = getDb();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO comments (parent_id, author_id, target_type, target_id, body)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, parent_id, author_id, target_type, target_id, body, status, created_at`,
      [input.parentId || null, authorId, input.targetType, input.targetId, body]);
    const comment = ins.rows[0];
    for (const m of mentions) {
      await client.query(
        `INSERT INTO comment_mentions (comment_id, mentioned_user_id) VALUES ($1,$2)
         ON CONFLICT DO NOTHING`, [comment.id, m]);
    }
    for (const img of saved) {
      await client.query(
        `INSERT INTO comment_images (comment_id, file_path, size_bytes, mime_type)
         VALUES ($1,$2,$3,$4)`, [comment.id, img.path, img.size, img.mime]);
    }
    await client.query('COMMIT');
    return {
      ...comment,
      mentions,
      images: saved.map(s => ({ size: s.size, mime: s.mime }))
    };
  } catch (err) {
    await client.query('ROLLBACK'); throw err;
  } finally { client.release(); }
}

async function listThread(targetType, targetId) {
  const { rows } = await getDb().query(
    `SELECT id, parent_id, author_id, target_type, target_id, body, status, created_at
     FROM comments
     WHERE target_type=$1 AND target_id=$2 AND status <> 'removed'
     ORDER BY created_at ASC`,
    [targetType, targetId]);
  const byId = new Map(rows.map(r => [r.id, { ...r, children: [] }]));
  const roots = [];
  for (const r of byId.values()) {
    if (r.parent_id && byId.has(r.parent_id)) byId.get(r.parent_id).children.push(r);
    else roots.push(r);
  }
  return roots;
}

async function setStatus(commentId, status) {
  await getDb().query(`UPDATE comments SET status=$1 WHERE id=$2`, [status, commentId]);
  return { commentId, status };
}

module.exports = { createComment, listThread, setStatus, MAX_IMAGES, MAX_IMAGE_BYTES };
