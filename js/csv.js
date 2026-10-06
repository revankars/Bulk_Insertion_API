function parseRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (quoted) {
      if (character === '"' && nextCharacter === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted) {
    throw new Error("The selected CSV contains an unterminated quoted field.");
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows.filter((candidate) => candidate.some((value) => value.trim() !== ""));
}

export const REPORT_SUITE_COLUMN = "reportSuiteID";

function buildReportSuiteCheck(headers, dataRows, expectedReportSuite) {
  const columnIndex = headers.indexOf(REPORT_SUITE_COLUMN);

  if (columnIndex === -1) {
    const similarHeader = headers.find(
      (header) => header.toLowerCase() === REPORT_SUITE_COLUMN.toLowerCase()
    );
    return {
      ok: false,
      columnPresent: false,
      expected: expectedReportSuite,
      detected: [],
      matchingRows: 0,
      totalRows: dataRows.length,
      mismatchedRows: [],
      message: similarHeader
        ? `The CSV uses a "${similarHeader}" column. Adobe requires the exact column name "${REPORT_SUITE_COLUMN}".`
        : `The CSV does not contain the required ${REPORT_SUITE_COLUMN} column.`,
    };
  }

  const values = dataRows.map((row, index) => ({
    value: (row[columnIndex] ?? "").trim(),
    row: index + 2,
  }));
  const detected = Array.from(new Set(values.map((entry) => entry.value).filter(Boolean)));
  const mismatchedRows = values.filter((entry) => entry.value !== expectedReportSuite);
  const matchingRows = values.length - mismatchedRows.length;

  if (mismatchedRows.length === 0) {
    return {
      ok: true,
      columnPresent: true,
      expected: expectedReportSuite,
      detected,
      matchingRows,
      totalRows: values.length,
      mismatchedRows: [],
      message: `All ${matchingRows.toLocaleString()} data rows insert into "${expectedReportSuite}".`,
    };
  }

  const examples = mismatchedRows
    .slice(0, 3)
    .map(({ value, row }) => `row ${row}: "${value || "(empty)"}"`)
    .join(", ");

  return {
    ok: false,
    columnPresent: true,
    expected: expectedReportSuite,
    detected,
    matchingRows,
    totalRows: values.length,
    mismatchedRows,
    message:
      `Report Suite validation failed. ${mismatchedRows.length.toLocaleString()} of ` +
      `${values.length.toLocaleString()} rows do not target "${expectedReportSuite}". ` +
      `Mismatch: ${examples}.`,
  };
}

export async function inspectCsv(file, expectedReportSuite) {
  if (!file.name.toLowerCase().endsWith(".csv")) {
    throw new Error("The selected file is not a valid CSV file.");
  }

  const text = (await file.text()).replace(/^\uFEFF/, "");
  const rows = parseRows(text);

  if (rows.length < 2) {
    throw new Error("The CSV must contain a header and at least one data row.");
  }

  const headers = rows[0].map((header) => header.trim());
  const dataRows = rows.slice(1);
  const malformedRow = dataRows.findIndex((row) => row.length !== headers.length);
  if (malformedRow !== -1) {
    throw new Error(
      `CSV row ${malformedRow + 2} has ${dataRows[malformedRow].length} columns; expected ${headers.length}.`
    );
  }

  const reportSuiteCheck = buildReportSuiteCheck(headers, dataRows, expectedReportSuite);

  return {
    headers,
    rowCount: dataRows.length,
    reportSuite: expectedReportSuite,
    reportSuites: reportSuiteCheck.detected,
    reportSuiteCheck,
  };
}
