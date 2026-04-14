'use strict';

const path = require('path');
const os = require('os');

function envInt(name, dflt) {
  const v = process.env[name];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : dflt;
}

const dataRoot = process.env.MERCHANT_DATA_DIR
  || path.join(process.env.PROGRAMDATA || os.homedir(), 'MerchantConsole');

module.exports = {
  apiHost:       process.env.API_HOST || '0.0.0.0',
  apiPort:       envInt('API_PORT', 3131),
  lanOnly:       process.env.LAN_ONLY === 'true',

  pg: {
    host:     process.env.PGHOST     || '127.0.0.1',
    port:     envInt('PGPORT', 54329),
    user:     process.env.PGUSER     || 'merchant_app',
    password: process.env.PGPASSWORD || 'merchant_app',
    database: process.env.PGDATABASE || 'merchant_console',
    dataDir:  process.env.PGDATA     || path.join(dataRoot, 'pgdata')
  },

  jwtSecret:   process.env.JWT_SECRET || null,

  dataRoot,
  uploadDir:   process.env.UPLOAD_DIR   || path.join(dataRoot, 'uploads'),
  exportDir:   process.env.EXPORT_DIR   || path.join(dataRoot, 'exports'),
  updateDir:   process.env.UPDATE_DIR   || path.join(dataRoot, 'updates'),

  migrationsDir: path.resolve(__dirname, '..', '..', 'database'),
  dictionaryDir: path.resolve(__dirname, '..', 'dictionaries')
};
