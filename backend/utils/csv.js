// Spreadsheet apps execute a cell that starts with one of these, so a
// user-supplied value like "=cmd|'/C calc'!A0" must be neutralised.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function formatValue(value) {
  if (value === null || value === undefined) return '';
  // PostgreSQL returns TIMESTAMPTZ as a Date; emit ISO so the "(UTC)" column
  // headers are truthful and the cell parses as a date in Excel/Sheets.
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function escapeCell(value) {
  let str = formatValue(value);
  // Prefix with a single quote so the spreadsheet treats it as text
  if (FORMULA_PREFIX.test(str)) str = `'${str}`;
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// columns: array of [key, header] pairs
function toCsv(rows, columns) {
  const lines = [columns.map(([, header]) => escapeCell(header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map(([key]) => escapeCell(row[key])).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

module.exports = { toCsv, escapeCell };
