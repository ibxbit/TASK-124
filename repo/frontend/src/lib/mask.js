export function maskLast4(value, padChar = '•') {
  if (value == null) return '';
  const s = String(value);
  if (s.length <= 4) return s.padStart(4, padChar);
  return padChar.repeat(Math.max(s.length - 4, 4)) + s.slice(-4);
}

export function formatLast4(last4, prefixLength = 8, padChar = '•') {
  if (!last4) return '';
  return padChar.repeat(prefixLength) + String(last4);
}

export function maskCardToken(value, padChar = '•') {
  if (value == null) return '';
  const s = String(value);
  if (s.length <= 4) return s;
  const visible = s.slice(-4);
  const masked = padChar.repeat(4) + ' ' + padChar.repeat(4) + ' ' + padChar.repeat(4) + ' ' + visible;
  return masked;
}
