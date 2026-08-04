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
  const lines = [csvHeader(columns)];
  for (const row of rows) lines.push(csvRow(row, columns));
  return lines.join('\r\n') + '\r\n';
}

// Row-at-a-time equivalents, for exports large enough that building the whole
// file in memory first is not an option.
const csvHeader = (columns) => columns.map(([, header]) => escapeCell(header)).join(',');
const csvRow = (row, columns) => columns.map(([key]) => escapeCell(row[key])).join(',');

module.exports = { toCsv, csvHeader, csvRow, escapeCell };
