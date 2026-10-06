const elements = {
  accessToken: document.querySelector("#accessToken"),
  showToken: document.querySelector("#showToken"),
  clientId: document.querySelector("#clientId"),
  clientSecret: document.querySelector("#clientSecret"),
  showSecret: document.querySelector("#showSecret"),
  orgId: document.querySelector("#orgId"),
  scopes: document.querySelector("#scopes"),
  tokenEndpoint: document.querySelector("#tokenEndpoint"),
  tabGenerate: document.querySelector("#tabGenerate"),
  tabExisting: document.querySelector("#tabExisting"),
  generatePanel: document.querySelector("#generatePanel"),
  existingPanel: document.querySelector("#existingPanel"),
  generateTokenButton: document.querySelector("#generateTokenButton"),
  clearCredentialsButton: document.querySelector("#clearCredentialsButton"),
  tokenStatus: document.querySelector("#tokenStatus"),
  reportSuiteId: document.querySelector("#reportSuiteId"),
  visitorGroupId: document.querySelector("#visitorGroupId"),
  verifySuiteButton: document.querySelector("#verifySuiteButton"),
  suiteVerification: document.querySelector("#suiteVerification"),
  verifyBadge: document.querySelector("#verifyBadge"),
  verifyMessage: document.querySelector("#verifyMessage"),
  verifyColumn: document.querySelector("#verifyColumn"),
  verifyDetected: document.querySelector("#verifyDetected"),
  verifyMatch: document.querySelector("#verifyMatch"),
  uploadReceipt: document.querySelector("#uploadReceipt"),
  receiptBadge: document.querySelector("#receiptBadge"),
  receiptMessage: document.querySelector("#receiptMessage"),
  receiptFileId: document.querySelector("#receiptFileId"),
  receiptStatusCode: document.querySelector("#receiptStatusCode"),
  receiptStatus: document.querySelector("#receiptStatus"),
  receiptUploadName: document.querySelector("#receiptUploadName"),
  receiptVisitorGroup: document.querySelector("#receiptVisitorGroup"),
  receiptRows: document.querySelector("#receiptRows"),
  receiptInvalidRows: document.querySelector("#receiptInvalidRows"),
  receiptSize: document.querySelector("#receiptSize"),
  receiptReceived: document.querySelector("#receiptReceived"),
  receiptIdempotencyKey: document.querySelector("#receiptIdempotencyKey"),
  receiptLog: document.querySelector("#receiptLog"),
  proxyBaseUrl: document.querySelector("#proxyBaseUrl"),
  modeBadge: document.querySelector("#modeBadge"),
  fileInput: document.querySelector("#fileInput"),
  dropZone: document.querySelector("#dropZone"),
  fileSummary: document.querySelector("#fileSummary"),
  fileName: document.querySelector("#fileName"),
  fileSize: document.querySelector("#fileSize"),
  rowCount: document.querySelector("#rowCount"),
  fileReportSuite: document.querySelector("#fileReportSuite"),
  compressedSize: document.querySelector("#compressedSize"),
  fileError: document.querySelector("#fileError"),
  validateButton: document.querySelector("#validateButton"),
  uploadButton: document.querySelector("#uploadButton"),
  statusButton: document.querySelector("#statusButton"),
  resetButton: document.querySelector("#resetButton"),
  activityBar: document.querySelector("#activityBar"),
  operationMessage: document.querySelector("#operationMessage"),
  idempotencyKey: document.querySelector("#idempotencyKey"),
  copyKeyButton: document.querySelector("#copyKeyButton"),
  copyResponseButton: document.querySelector("#copyResponseButton"),
  responseKind: document.querySelector("#responseKind"),
  responseStatus: document.querySelector("#responseStatus"),
  responseTime: document.querySelector("#responseTime"),
  responseViewer: document.querySelector("#responseViewer"),
  progressTracker: document.querySelector("#progressTracker"),
  toast: document.querySelector("#toast"),
};

let lastResponseText = "";
let toastTimer;

export function getElements() {
  return elements;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "—";
  }
  if (bytes === 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** unitIndex)).toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function showFileSummary(file, inspection, compressedFile) {
  elements.fileName.textContent = file.name;
  elements.fileSize.textContent = formatBytes(file.size);
  elements.rowCount.textContent = inspection.rowCount.toLocaleString();
  elements.fileReportSuite.textContent = inspection.reportSuite;
  elements.compressedSize.textContent = formatBytes(compressedFile.size);
  elements.fileSummary.classList.remove("hidden");
}

export function showFileError(message) {
  elements.fileError.textContent = message;
  elements.fileError.classList.remove("hidden");
}

export function clearFileError() {
  elements.fileError.textContent = "";
  elements.fileError.classList.add("hidden");
}

export function setStep(step, status, detail) {
  const item = elements.progressTracker.querySelector(`[data-step="${step}"]`);
  if (!item) {
    return;
  }
  item.classList.remove("active", "complete", "error");
  if (status) {
    item.classList.add(status);
  }
  item.querySelector("small").textContent = detail || {
    active: "In progress",
    complete: "Complete",
    error: "Failed",
  }[status] || "Waiting";
}

export function resetSteps() {
  elements.progressTracker.querySelectorAll("li").forEach((item) => {
    item.classList.remove("active", "complete", "error");
    item.querySelector("small").textContent = "Waiting";
  });
}

export function setBusy(isBusy, message = "") {
  elements.activityBar.classList.toggle("hidden", !isBusy);
  elements.operationMessage.textContent = message || (isBusy ? "Working..." : "Ready.");
  elements.fileInput.disabled = isBusy;
  elements.dropZone.disabled = isBusy;
  elements.resetButton.disabled = isBusy;
}

export function setButtons({ canValidate, canUpload, canCheckStatus, busy }) {
  elements.validateButton.disabled = busy || !canValidate;
  elements.uploadButton.disabled = busy || !canUpload;
  elements.statusButton.disabled = busy || !canCheckStatus;
}

function friendlyHttpMessage(result) {
  const messages = {
    401: "Authentication failed. Verify your OAuth access token and client ID.",
    403: "Adobe rejected the request due to authorization or permissions.",
    429: "Adobe rate limit reached. Please wait and retry.",
  };
  return messages[result.status] || "";
}

export function showResponse(kind, result, contextualMessage = "") {
  const friendlyMessage = friendlyHttpMessage(result);
  const display = {
    request: kind,
    httpStatus: `${result.status} ${result.statusText || ""}`.trim(),
    message: [contextualMessage, friendlyMessage].filter(Boolean).join(" "),
    responseHeaders: result.headers,
    adobeResponse: result.data,
    timestamp: result.timestamp,
  };

  lastResponseText = JSON.stringify(display, null, 2);
  elements.responseKind.textContent = kind;
  elements.responseStatus.textContent = `HTTP ${result.status}`;
  elements.responseStatus.className = `status ${result.ok ? "success" : "error"}`;
  elements.responseTime.textContent = new Date(result.timestamp).toLocaleString();
  elements.responseViewer.textContent = lastResponseText;
  elements.copyResponseButton.disabled = false;
}

export function showLocalResponse(kind, status, data) {
  showResponse(kind, {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Local validation error",
    headers: {},
    data,
    timestamp: new Date().toISOString(),
  });
}

export function setIdempotencyKey(key) {
  elements.idempotencyKey.textContent = key || "Generated after file selection";
  elements.copyKeyButton.disabled = !key;
}

export async function copyText(text, successMessage) {
  await navigator.clipboard.writeText(text);
  showToast(successMessage);
}

export function copyLastResponse() {
  return copyText(lastResponseText, "Response copied");
}

export function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("visible"), 2200);
}

export function resetFileUi() {
  clearFileError();
  resetSteps();
  resetReportSuiteVerification();
  resetUploadReceipt();
  elements.fileInput.value = "";
  elements.fileSummary.classList.add("hidden");
  elements.fileName.textContent = "—";
  elements.fileSize.textContent = "—";
  elements.rowCount.textContent = "—";
  elements.fileReportSuite.textContent = "—";
  elements.compressedSize.textContent = "—";
  setIdempotencyKey("");
  elements.operationMessage.textContent = "Select a CSV file to begin.";
  lastResponseText = "";
  elements.responseKind.textContent = "No request made";
  elements.responseStatus.textContent = "—";
  elements.responseStatus.className = "status neutral";
  elements.responseTime.textContent = "";
  elements.responseViewer.textContent = "Adobe API responses will appear here.";
  elements.copyResponseButton.disabled = true;
}

export function setAuthMethod(method) {
  const generating = method === "generate";
  elements.generatePanel.classList.toggle("hidden", !generating);
  elements.existingPanel.classList.toggle("hidden", generating);
  elements.tabGenerate.classList.toggle("active", generating);
  elements.tabExisting.classList.toggle("active", !generating);
  elements.tabGenerate.setAttribute("aria-selected", String(generating));
  elements.tabExisting.setAttribute("aria-selected", String(!generating));
}

export function setTokenStatus(message, tone = "neutral") {
  elements.tokenStatus.textContent = message;
  elements.tokenStatus.className = `token-status ${tone}`;
}

export function formatCountdown(seconds) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = safeSeconds % 60;
  const paddedMinutes = String(minutes).padStart(2, "0");
  const paddedSeconds = String(remainder).padStart(2, "0");
  return hours > 0
    ? `${hours}:${paddedMinutes}:${paddedSeconds}`
    : `${minutes}:${paddedSeconds}`;
}

export function showReportSuiteVerification(check) {
  elements.suiteVerification.classList.remove("hidden");
  elements.verifyBadge.textContent = check.ok ? "Verified" : "Not verified";
  elements.verifyBadge.className = `status ${check.ok ? "success" : "error"}`;
  elements.verifyMessage.textContent = check.message;
  elements.verifyColumn.textContent = check.columnPresent ? "Present" : "Missing";

  const detected = check.detected.length > 0 ? check.detected.join(", ") : "None found";
  elements.verifyDetected.textContent = detected;
  elements.verifyDetected.title = detected;
  elements.verifyMatch.textContent = check.columnPresent
    ? `${check.matchingRows.toLocaleString()} of ${check.totalRows.toLocaleString()}`
    : "—";
}

export function resetReportSuiteVerification() {
  elements.suiteVerification.classList.add("hidden");
  elements.verifyBadge.textContent = "Not verified";
  elements.verifyBadge.className = "status neutral";
  elements.verifyMessage.textContent =
    "Select a CSV file to verify the destination report suite.";
  elements.verifyColumn.textContent = "—";
  elements.verifyDetected.textContent = "—";
  elements.verifyMatch.textContent = "—";
}

const RECEIPT_FIELDS = [
  ["receiptFileId", "file_id"],
  ["receiptStatusCode", "status_code"],
  ["receiptStatus", "status"],
  ["receiptUploadName", "upload_name"],
  ["receiptVisitorGroup", "visitor_group_id"],
  ["receiptIdempotencyKey", "idempotency_key"],
];

/**
 * Renders the documented Adobe upload receipt. `invalid_rows` is surfaced
 * prominently because Adobe returns HTTP 200 even when some rows are dropped.
 */
export function showUploadReceipt(payload) {
  const data = payload && typeof payload === "object" ? payload : {};
  elements.uploadReceipt.classList.remove("hidden");

  for (const [elementId, field] of RECEIPT_FIELDS) {
    const value = data[field];
    elements[elementId].textContent =
      value === undefined || value === null || value === "" ? "—" : String(value);
  }

  const rows = Number(data.rows);
  const invalidRows = Number(data.invalid_rows);
  const hasInvalidRows = Number.isFinite(invalidRows) && invalidRows > 0;

  elements.receiptRows.textContent = Number.isFinite(rows) ? rows.toLocaleString() : "—";
  elements.receiptInvalidRows.textContent = Number.isFinite(invalidRows)
    ? invalidRows.toLocaleString()
    : "—";
  elements.receiptInvalidRows.classList.toggle("value-warning", hasInvalidRows);
  elements.receiptSize.textContent = formatBytes(Number(data.size));
  elements.receiptReceived.textContent = data.received_date
    ? new Date(Number(data.received_date) * 1000).toLocaleString()
    : "—";

  elements.receiptBadge.textContent = data.status_code || "UPLOADED";
  elements.receiptBadge.className = `status ${hasInvalidRows ? "warning" : "success"}`;
  elements.receiptMessage.textContent = hasInvalidRows
    ? `Adobe accepted the file but dropped ${invalidRows.toLocaleString()} invalid row(s).`
    : data.status || "Adobe accepted the file.";

  const log = typeof data.processing_log === "string" ? data.processing_log.trim() : "";
  elements.receiptLog.textContent = log;
  elements.receiptLog.classList.toggle("hidden", !log);
}

export function resetUploadReceipt() {
  elements.uploadReceipt.classList.add("hidden");
  elements.receiptBadge.textContent = "Not uploaded";
  elements.receiptBadge.className = "status neutral";
  elements.receiptMessage.textContent = "Upload receipt details will appear here.";
  for (const [elementId] of RECEIPT_FIELDS) {
    elements[elementId].textContent = "—";
  }
  elements.receiptRows.textContent = "—";
  elements.receiptInvalidRows.textContent = "—";
  elements.receiptInvalidRows.classList.remove("value-warning");
  elements.receiptSize.textContent = "—";
  elements.receiptReceived.textContent = "—";
  elements.receiptLog.textContent = "";
  elements.receiptLog.classList.add("hidden");
}
