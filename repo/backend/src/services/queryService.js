'use strict';

const { getDb } = require('../db/pool');
const { buildSelectQuery } = require('./queryBuilder');

async function executeQuery(definition) {
  const db = getDb();
  const { dataSql, dataParams, countSql, countParams, limit, offset } =
    buildSelectQuery(definition);

  const [dataRes, countRes] = await Promise.all([
    db.query(dataSql, dataParams),
    db.query(countSql, countParams)
  ]);

  return {
    rows:   dataRes.rows,
    total:  Number(countRes.rows[0].total),
    limit,
    offset
  };
}

module.exports = { executeQuery };
