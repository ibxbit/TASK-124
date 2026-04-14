'use strict';

const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/pool');
const config = require('../config');

const DICT_PATH = path.join(config.dictionaryDir, 'sensitive_words.txt');
let dictionary = null;

function loadDictionary() {
  if (dictionary) return dictionary;
  const raw = fs.existsSync(DICT_PATH) ? fs.readFileSync(DICT_PATH, 'utf8') : '';
  dictionary = new Set(
    raw.split(/\r?\n/).map(s => s.trim().toLowerCase()).filter(Boolean)
  );
  return dictionary;
}

function reloadDictionary() { dictionary = null; return loadDictionary(); }

async function getBlacklistedWords() {
  const { rows } = await getDb().query(`SELECT value FROM blacklists WHERE kind='word'`);
  return rows.map(r => r.value.toLowerCase());
}

async function scan(text) {
  const body = String(text || '').toLowerCase();
  const dict = loadDictionary();
  const dbWords = await getBlacklistedWords();
  const all = new Set([...dict, ...dbWords]);
  const hits = [];
  for (const word of all) {
    if (!word) continue;
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'i');
    if (re.test(body)) hits.push(word);
  }
  return hits;
}

module.exports = { scan, reloadDictionary };
