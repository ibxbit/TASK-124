'use strict';

const { getDb } = require('../db/pool');

async function follow(followerId, followeeId) {
  if (followerId === followeeId) { const e = new Error('Cannot follow self'); e.status = 400; throw e; }
  await getDb().query(
    `INSERT INTO follows (follower_id, followee_id) VALUES ($1,$2)
     ON CONFLICT DO NOTHING`,
    [followerId, followeeId]);
  return { followerId, followeeId };
}

async function unfollow(followerId, followeeId) {
  await getDb().query(
    `DELETE FROM follows WHERE follower_id=$1 AND followee_id=$2`,
    [followerId, followeeId]);
  return { followerId, followeeId };
}

async function listFollowers(userId) {
  const { rows } = await getDb().query(
    `SELECT follower_id, created_at FROM follows WHERE followee_id=$1`, [userId]);
  return rows;
}

async function listFollowing(userId) {
  const { rows } = await getDb().query(
    `SELECT followee_id, created_at FROM follows WHERE follower_id=$1`, [userId]);
  return rows;
}

module.exports = { follow, unfollow, listFollowers, listFollowing };
