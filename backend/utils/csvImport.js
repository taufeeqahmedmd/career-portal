// Minimal RFC-4180 CSV reader: quoted fields, escaped quotes, CRLF, BOM.
// Each returned row carries `__line`, the 1-based physical line it started on,
// so error messages can point at the right row of the user's spreadsheet.
// Blank lines are skipped and a quoted field may span several lines, so the
// index of a surviving record is not the same thing as its line number.
function parseCsvRows(text) {
  const clean = String(text == null ? '' : text)
    .replace(/^﻿/, '')
    // Classic-Mac lone CR line endings would otherwise collapse the whole file
    .replace(/\r(?!\n)/g, '\n');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let hasContent = false;
  let line = 1;
  let rowStartLine = 1;

  const endRow = () => {
    row.push(field);
    if (hasContent) {
      row.__line = rowStartLine;
      rows.push(row);
    }
    row = [];
    field = '';
    hasContent = false;
    rowStartLine = line;
  };

  for (let i = 0; i < clean.length; i += 1) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        // A newline inside a quoted cell is data, but it still advances the
        // physical line counter. Excel writes CRLF here; keeping the CR would
        // leave a stray character in every multi-line value.
        if (c === '\n') {
          line += 1;
          field += '\n';
        } else if (c !== '\r') {
          field += c;
        }
      }
      hasContent = true;
    } else if (c === '"') {
      inQuotes = true;
      hasContent = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
      hasContent = true;
    } else if (c === '\n') {
      line += 1;
      endRow();
    } else if (c !== '\r') {
      field += c;
      hasContent = true;
    }
  }
  if (hasContent) endRow();

  // An unterminated quote swallows everything after it into one cell, which
  // silently loses records. Report it instead.
  if (inQuotes) rows.unterminatedQuote = true;
  return rows;
}

const normalizeHeader = (h) =>
  String(h || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');

// Returns { rows: [{header: value, __row}], headers, error }.
// `__row` is the physical line number in the user's file.
function parseCsvFile(buffer) {
  // A spreadsheet saved as UTF-16 (an easy mis-click in Excel) decodes to
  // headers that still look plausible, then every value carries NUL bytes that
  // PostgreSQL rejects - which surfaced as a 500 halfway through the import.
  if (buffer.includes(0)) {
    return {
      rows: [],
      error:
        'This file is not plain UTF-8 text. In Excel choose "CSV UTF-8 (Comma delimited)" when saving.',
    };
  }

  const text = buffer.toString('utf8');
  // Lone surrogates and other unpaired code units would also fail to store
  if (text.includes('�') && !buffer.toString('latin1').includes('�')) {
    return {
      rows: [],
      error: 'This file is not valid UTF-8. Re-save it as "CSV UTF-8 (Comma delimited)".',
    };
  }

  const raw = parseCsvRows(text);
  if (raw.unterminatedQuote) {
    return {
      rows: [],
      error:
        'A quoted value is never closed, so the rest of the file cannot be read. Check for a stray " character.',
    };
  }
  if (!raw.length) return { rows: [], error: 'The file is empty.' };

  const headers = raw[0].map(normalizeHeader);
  if (!headers.some(Boolean)) return { rows: [], error: 'No column headers found.' };

  const duplicate = headers.filter((h, i) => h && headers.indexOf(h) !== i);
  if (duplicate.length) {
    return {
      rows: [],
      error: `The column "${duplicate[0]}" appears more than once. Give each column a distinct name.`,
    };
  }

  const rows = raw.slice(1).map((cells) => {
    const record = { __row: cells.__line };
    headers.forEach((h, i) => {
      if (h) record[h] = (cells[i] == null ? '' : String(cells[i])).trim();
    });
    return record;
  });
  return { rows, headers: headers.filter(Boolean), error: null };
}

// Column aliases each importer understands, shared so the header check and the
// value reader can never drift apart
const ALIASES = {
  email: ['email', 'email_id', 'e_mail', 'e_mail_id', 'mail', 'mail_id'],
  personName: ['name', 'full_name', 'user_name'],
  branch: ['branch', 'branch_name'],
  position: ['position', 'job_title', 'job_role'],
  label: ['label', 'name', 'role', 'position', 'value', 'title'],
};

// Guards against importing the wrong file. Checking for "any recognised column"
// was not enough: `name`, `role`, `position` and `title` are aliases in more
// than one importer, so the users template imported cleanly into openings
// (creating openings named after a role) and into the roles list (creating
// roles named after people), both reported as success.
//
// Each importer therefore states the columns it must have AND the columns that
// identify a different template.
function checkHeaders(headers = [], { requireAll = [], requireAny = [], forbid = [] }) {
  for (const group of requireAll) {
    if (!headers.some((h) => group.aliases.includes(h))) {
      return `This file has no "${group.name}" column, so it does not match the ${group.of} template.`;
    }
  }
  if (requireAny.length && !requireAny.some((g) => headers.some((h) => g.aliases.includes(h)))) {
    const names = requireAny.map((g) => `"${g.name}"`).join(' or ');
    return `This file has no ${names} column.`;
  }
  for (const group of forbid) {
    const found = headers.find((h) => group.aliases.includes(h));
    if (found) {
      return `This file has a "${found}" column, which belongs to the ${group.of} template. Download the correct template and try again.`;
    }
  }
  return null;
}

// Reads the first present alias, so templates can use friendly names
const pick = (row, ...aliases) => {
  for (const a of aliases) {
    if (row[a]) return row[a];
  }
  return '';
};

const MAX_ROWS = 1000;

// The three importers' header contracts, in one place
const HEADER_RULES = {
  users: {
    requireAll: [{ name: 'email', of: 'users', aliases: ALIASES.email }],
  },
  openings: {
    requireAll: [
      { name: 'position', of: 'openings', aliases: ALIASES.position },
      { name: 'branch', of: 'openings', aliases: ALIASES.branch },
    ],
    forbid: [{ of: 'users', aliases: ALIASES.email }],
  },
  flowOptions: {
    requireAny: [{ name: 'label', aliases: ALIASES.label }],
    forbid: [
      { of: 'users', aliases: ALIASES.email },
      { of: 'openings', aliases: ALIASES.branch },
    ],
  },
};

module.exports = {
  parseCsvFile,
  parseCsvRows,
  pick,
  MAX_ROWS,
  checkHeaders,
  HEADER_RULES,
  ALIASES,
};
