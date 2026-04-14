'use strict';

// ExcelJS lazy-loaded: only needed for xlsx imports
let _ExcelJS = null;
function getExcelJS() { return _ExcelJS || (_ExcelJS = require('exceljs')); }

function splitCsvLine(line) {
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; continue; }
    if (c === '"') { inQ = !inQ; continue; }
    if (c === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

function parseCsvBuffer(buf) {
  const text = buf.toString('utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(l => {
    const cells = splitCsvLine(l);
    const obj = {};
    headers.forEach((h, i) => obj[h] = cells[i]);
    return obj;
  });
}

async function parseXlsxBuffer(buf) {
  const wb = new (getExcelJS()).Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  const headers = [];
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, idx) => {
    const values = row.values.slice(1);
    if (idx === 1) values.forEach(v => headers.push(String(v).trim()));
    else {
      const obj = {};
      headers.forEach((h, i) => obj[h] = values[i] == null ? '' : String(values[i]));
      rows.push(obj);
    }
  });
  return rows;
}

function mapWechatState(type) {
  const t = String(type || '').toLowerCase();
  if (t.includes('pre') || t.includes('auth'))   return 'pre_auth';
  if (t.includes('deposit'))                     return 'deposit';
  return 'full';
}

function normalizeWechat(row) {
  return {
    externalId:   row['transaction_id'] || row['Transaction ID'],
    provider:     'wechat_pay',
    merchantId:   row['merchant_id']    || row['Merchant ID'],
    orderId:      row['order_id']       || row['Order ID'],
    state:        mapWechatState(row['type'] || row['Type']),
    grossAmount:  Number(row['amount']  || row['Amount']),
    occurredAt:   new Date(row['time']  || row['Time'])
  };
}

function normalizeBank(row) {
  return {
    externalId:   row['reference']      || row['Reference'],
    provider:     'bank',
    merchantId:   row['beneficiary']    || row['Beneficiary'],
    orderId:      row['memo']           || row['Memo'],
    state:        'full',
    grossAmount:  Number(row['amount']  || row['Amount']),
    occurredAt:   new Date(row['posted_at'] || row['Posted At'])
  };
}

async function parseBuffer(buf, format, source) {
  const rows = format === 'xlsx' ? await parseXlsxBuffer(buf) : parseCsvBuffer(buf);
  const normalizer = source === 'wechat_pay' ? normalizeWechat : normalizeBank;
  return rows.map(normalizer).filter(r => r.externalId && !isNaN(r.grossAmount));
}

module.exports = { parseBuffer };
