function escapeCsv(value) {
  if (value == null) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows, columns) {
  const header = columns.map(escapeCsv).join(',');
  const body = rows.map(r => columns.map(c => escapeCsv(r[c])).join(',')).join('\r\n');
  return header + '\r\n' + body;
}

export async function copyAsCsv(rows, columns) {
  const csv = toCsv(rows, columns);
  if (window.desktop && window.desktop.clipboard) window.desktop.clipboard.writeText(csv);
  else await navigator.clipboard.writeText(csv);
  return csv;
}

export async function copyCell(value) {
  const text = value == null ? '' : String(value);
  if (window.desktop && window.desktop.clipboard) window.desktop.clipboard.writeText(text);
  else await navigator.clipboard.writeText(text);
}
