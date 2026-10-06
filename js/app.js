import { compressFileToGzip } from "./compressor.js";
import { createIdempotencyKey } from "./hash.js";
import { inspectCsv } from "./csv.js";
import { requestAccessToken } from "./auth.js";
import {
  CONFIG,
  validateFile,
  uploadFile,
  checkIngestionStatus,
  isFileReceived,
  isFileNotFound,
} from "./adobe-api.js";
import {
  getElements,
  showFileSummary,
  showFileError,
  clearFileError,
  setStep,
  setBusy,
  setButtons,
  showResponse,
  showLocalResponse,
  setIdempotencyKey,
  copyText,
  copyLastResponse,
  showToast,
  resetFileUi,
  setAuthMethod,
  setTokenStatus,
  formatCountdown,
  showReportSuiteVerification,
  showUploadReceipt,
} from "./ui.js";

const elements = getElements();

const state = {
  file: null,
  compressedFile: null,
  inspection: null,
  idempotencyKey: "",
  validated: false,
  uploaded: false,
  busy: false,
  authMethod: "generate",
  generatedToken: "",
  tokenExpiresAt: 0,
};

let tokenCountdownTimer;

function credentials() {
  const accessToken = state.authMethod === "generate"
    ? state.generatedToken
    : elements.accessToken.value.trim();

  return {
    accessToken,
    clientId: elements.clientId.value.trim(),
  };
}

function uploadReceiptData(payload) {
  const data = payload && typeof payload === "object" ? payload : {};
  return {
    ...data,
    status_code: data.status_code || "UPLOADED",
    idempotency_key: data.idempotency_key || state.idempotencyKey,
  };
}

function settings() {
  return {
    proxyBaseUrl: elements.proxyBaseUrl.value.trim(),
    visitorGroupId: elements.visitorGroupId.value.trim(),
  };
}

function verifyRequestConfiguration() {
  const auth = credentials();
  if (!auth.accessToken) {
    throw new Error(
      state.authMethod === "generate"
        ? "Generate an Adobe OAuth access token before making API requests."
        : "Please enter your Adobe OAuth access token."
    );
  }
  if (!auth.clientId) {
    throw new Error("Please enter your Adobe Client ID.");
  }
  if (!settings().proxyBaseUrl) {
    throw new Error("Please enter the backend proxy URL.");
  }
  if (!settings().visitorGroupId) {
    throw new Error(
      "Please enter a Visitor Group ID. Adobe requires it as the x-adobe-vgid header."
    );
  }
  if (state.authMethod === "generate" && state.tokenExpiresAt && Date.now() >= state.tokenExpiresAt) {
    throw new Error("The generated access token has expired. Generate a new token.");
  }
  return auth;
}

function stopTokenCountdown() {
  window.clearInterval(tokenCountdownTimer);
  tokenCountdownTimer = undefined;
}

function startTokenCountdown() {
  stopTokenCountdown();
  const tick = () => {
    const secondsLeft = (state.tokenExpiresAt - Date.now()) / 1000;
    if (secondsLeft <= 0) {
      state.generatedToken = "";
      state.tokenExpiresAt = 0;
      setTokenStatus("Access token expired. Generate a new token.", "error");
      stopTokenCountdown();
      refreshButtons();
      return;
    }
    setTokenStatus(`Access token active — expires in ${formatCountdown(secondsLeft)}.`, "success");
  };
  tick();
  tokenCountdownTimer = window.setInterval(tick, 1000);
}

async function generateToken() {
  clearFileError();

  const clientId = elements.clientId.value.trim();
  const clientSecret = elements.clientSecret.value;
  const connection = settings();

  if (!clientId) {
    setTokenStatus("Enter the Adobe Client ID.", "error");
    return;
  }
  if (!clientSecret) {
    setTokenStatus("Enter the Adobe Client Secret.", "error");
    return;
  }
  if (!connection.proxyBaseUrl) {
    setTokenStatus("Enter the backend proxy URL.", "error");
    return;
  }

  elements.generateTokenButton.disabled = true;
  setTokenStatus("Requesting access token from Adobe IMS...", "pending");

  try {
    const result = await requestAccessToken(
      {
        clientId,
        clientSecret,
        scopes: elements.scopes.value.trim(),
        tokenEndpoint: elements.tokenEndpoint.value.trim(),
      },
      connection
    );

    // The raw token is never rendered; only redacted metadata reaches the viewer.
    showResponse(
      "Access Token Request",
      result,
      result.ok
        ? "Access token generated. The token value is redacted in this view."
        : "Adobe IMS did not return an access token."
    );

    if (!result.ok) {
      state.generatedToken = "";
      state.tokenExpiresAt = 0;
      stopTokenCountdown();
      setTokenStatus(`Token request failed (HTTP ${result.status}).`, "error");
      return;
    }

    state.generatedToken = result.accessToken;
    state.tokenExpiresAt = Date.now() + Math.max(result.expiresIn, 0) * 1000;
    // The secret is discarded immediately after a successful exchange.
    elements.clientSecret.value = "";
    startTokenCountdown();
    showToast("Access token generated");
  } catch (error) {
    const message = error instanceof TypeError && String(error.message).includes("fetch")
      ? "The backend proxy could not be reached. Start it with `npm start` in bulk_insertion_api/backend and confirm the proxy URL."
      : error.message || String(error);
    state.generatedToken = "";
    state.tokenExpiresAt = 0;
    stopTokenCountdown();
    setTokenStatus(message, "error");
    showLocalResponse("Access Token Request", 0, { error: message });
  } finally {
    elements.generateTokenButton.disabled = false;
    refreshButtons();
  }
}

function clearCredentials() {
  stopTokenCountdown();
  state.generatedToken = "";
  state.tokenExpiresAt = 0;
  elements.clientId.value = "";
  elements.clientSecret.value = "";
  elements.orgId.value = "";
  elements.accessToken.value = "";
  setTokenStatus("Credentials cleared.", "neutral");
  refreshButtons();
  showToast("Credentials cleared");
}

function refreshButtons() {
  setButtons({
    canValidate: Boolean(state.compressedFile && state.inspection?.reportSuiteCheck?.ok),
    canUpload: state.validated,
    canCheckStatus: Boolean(state.idempotencyKey),
    busy: state.busy,
  });
  elements.verifySuiteButton.disabled = state.busy || !state.file;
}

function beginOperation(message) {
  state.busy = true;
  setBusy(true, message);
  refreshButtons();
}

function endOperation(message) {
  state.busy = false;
  setBusy(false, message);
  refreshButtons();
}

function operationError(error, step) {
  const message = error instanceof TypeError && String(error.message).includes("fetch")
    ? "The API request could not be completed. Direct browser mode may be blocked by CORS; try backend proxy mode."
    : error.message || String(error);
  if (step) {
    setStep(step, "error", "Failed");
  }
  showFileError(message);
  showLocalResponse("Application Error", 0, { error: message });
  endOperation(message);
}

async function selectFile(file) {
  resetFileState();
  clearFileError();

  if (!file) {
    return;
  }

  state.file = file;
  setStep("selected", "complete", file.name);
  beginOperation("Inspecting CSV...");

  try {
    const reportSuite = elements.reportSuiteId.value.trim();
    if (!reportSuite) {
      throw new Error("Please enter a Report Suite ID before selecting the CSV.");
    }

    state.inspection = await inspectCsv(file, reportSuite);
    setStep("inspected", "complete", `${state.inspection.rowCount.toLocaleString()} rows`);

    const check = state.inspection.reportSuiteCheck;
    showReportSuiteVerification(check);

    if (!check.ok) {
      setStep("suite", "error", check.columnPresent ? "Mismatch" : "Column missing");
      throw new Error(check.message);
    }
    setStep("suite", "complete", `${reportSuite} verified`);

    setStep("compressed", "active", "Compressing");
    state.compressedFile = await compressFileToGzip(file);
    setStep("compressed", "complete", "Gzip complete");

    state.idempotencyKey = await createIdempotencyKey(file);
    setIdempotencyKey(state.idempotencyKey);
    showFileSummary(file, state.inspection, state.compressedFile);
    endOperation("CSV inspected and report suite verified. Ready for Adobe validation.");
  } catch (error) {
    let step = "inspected";
    if (state.inspection?.reportSuiteCheck && !state.inspection.reportSuiteCheck.ok) {
      step = "suite";
    } else if (state.inspection) {
      step = "compressed";
    }
    operationError(error, step);
  }
}

async function reverifyReportSuite() {
  if (state.file) {
    await selectFile(state.file);
  }
}

async function validateSelectedFile() {
  clearFileError();
  let auth;
  try {
    auth = verifyRequestConfiguration();
  } catch (error) {
    operationError(error);
    return;
  }

  beginOperation("Validating compressed file with Adobe...");
  setStep("validated", "active", "Validating");

  try {
    const result = await validateFile(state.compressedFile, auth, settings());
    const adobeValid = result.ok &&
      typeof result.data === "object" &&
      result.data !== null &&
      String(result.data.success || "").toLowerCase() === "file is valid";

    showResponse(
      "Validation Result",
      result,
      adobeValid ? "Adobe accepted the file format." : "Adobe rejected the file. Upload has been stopped."
    );

    state.validated = adobeValid;
    setStep("validated", adobeValid ? "complete" : "error", adobeValid ? "Adobe accepted" : "Rejected");
    endOperation(
      adobeValid
        ? "Validation successful. Ready to upload."
        : "Validation failed. Fix the CSV before uploading."
    );
  } catch (error) {
    operationError(error, "validated");
  }
}

async function uploadSelectedFile() {
  clearFileError();
  let auth;
  try {
    auth = verifyRequestConfiguration();
  } catch (error) {
    operationError(error);
    return;
  }

  beginOperation("Checking for a previous upload...");
  setStep("uploaded", "active", "Duplicate check");

  try {
    const existing = await checkIngestionStatus(state.idempotencyKey, auth, settings());
    if (isFileReceived(existing)) {
      state.uploaded = true;
      showResponse(
        "Idempotency Lookup",
        existing,
        "Adobe already received this exact file. Duplicate upload prevented."
      );
      setStep("uploaded", "complete", "Duplicate skipped");
      setStep("status", "complete", "Received");
      endOperation("Adobe already received this file; no duplicate upload was sent.");
      return;
    }
    if (!isFileNotFound(existing)) {
      showResponse("Idempotency Lookup", existing, "Unable to verify duplicate status. Upload stopped.");
      throw new Error("Idempotency lookup failed, so upload was stopped to prevent a possible duplicate.");
    }

    setStep("uploaded", "active", "Uploading");
    setBusy(true, "Uploading compressed file...");
    let result;
    try {
      result = await uploadFile(
        state.compressedFile,
        state.idempotencyKey,
        auth,
        settings()
      );
    } catch (uploadError) {
      setBusy(true, "Upload response was unavailable. Checking whether Adobe received the file...");
      const confirmation = await checkIngestionStatus(
        state.idempotencyKey,
        auth,
        settings()
      );
      if (isFileReceived(confirmation)) {
        state.uploaded = true;
        showResponse(
          "Ingestion Status",
          confirmation,
          "Adobe received the file even though the upload response was unavailable."
        );
        setStep("uploaded", "complete", "Received");
        setStep("status", "complete", "Confirmed");
        endOperation("Adobe confirmed that the file was received.");
        return;
      }
      throw uploadError;
    }
    const receipt = result.ok ? uploadReceiptData(result.data) : result.data;
    showResponse("Upload Result", { ...result, data: receipt });

    if (!result.ok) {
      throw new Error("Adobe rejected the upload. Review the response before retrying.");
    }

    showUploadReceipt(receipt);

    const invalidRows = Number(receipt.invalid_rows);
    const hasInvalidRows = Number.isFinite(invalidRows) && invalidRows > 0;

    state.uploaded = true;
    setStep("uploaded", "complete", hasInvalidRows ? "Partial" : "Submitted");
    endOperation(
      hasInvalidRows
        ? `Upload submitted, but Adobe dropped ${invalidRows.toLocaleString()} invalid row(s). Checking ingestion status...`
        : "Upload submitted. Checking Adobe ingestion status..."
    );
    await pollStatus(auth, true);
  } catch (error) {
    operationError(error, "uploaded");
  }
}

async function pollStatus(auth = null, preserveUploadResponse = false) {
  clearFileError();
  try {
    auth = auth || verifyRequestConfiguration();
  } catch (error) {
    operationError(error);
    return;
  }

  state.busy = true;
  refreshButtons();
  setStep("status", "active", "Checking");

  for (let attempt = 1; attempt <= CONFIG.MAX_STATUS_ATTEMPTS; attempt += 1) {
    setBusy(
      true,
      `Checking Adobe ingestion status — attempt ${attempt} of ${CONFIG.MAX_STATUS_ATTEMPTS}...`
    );

    try {
      const result = await checkIngestionStatus(state.idempotencyKey, auth, settings());
      if (isFileReceived(result)) {
        if (!preserveUploadResponse) {
          showResponse("Ingestion Status", result, "Adobe has received the file.");
        }
        setStep("status", "complete", "Received");
        endOperation("Adobe confirmed that the file was received.");
        return;
      }

      if (!preserveUploadResponse) {
        showResponse(
          "Ingestion Status",
          result,
          isFileNotFound(result) ? "Adobe has not reported the file as received yet." : ""
        );
      }

      if (!isFileNotFound(result)) {
        setStep("status", "error", "Lookup failed");
        endOperation("Status lookup failed. Review the Adobe response.");
        return;
      }
    } catch (error) {
      operationError(error, "status");
      return;
    }

    if (attempt < CONFIG.MAX_STATUS_ATTEMPTS) {
      await new Promise((resolve) => window.setTimeout(resolve, CONFIG.STATUS_POLL_INTERVAL));
    }
  }

  setStep("status", "active", "Not found yet");
  endOperation("Adobe has not reported the file as received. Use Check Status to try again.");
}

function resetFileState() {
  state.file = null;
  state.compressedFile = null;
  state.inspection = null;
  state.idempotencyKey = "";
  state.validated = false;
  state.uploaded = false;
  state.busy = false;
  resetFileUi();
  refreshButtons();
}

elements.dropZone.addEventListener("click", () => elements.fileInput.click());
elements.fileInput.addEventListener("change", () => selectFile(elements.fileInput.files[0]));

for (const eventName of ["dragenter", "dragover"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("dragging");
  });
}
elements.dropZone.addEventListener("drop", (event) => selectFile(event.dataTransfer.files[0]));

elements.showToken.addEventListener("change", () => {
  elements.accessToken.type = elements.showToken.checked ? "text" : "password";
});
elements.showSecret.addEventListener("change", () => {
  elements.clientSecret.type = elements.showSecret.checked ? "text" : "password";
});
elements.tabGenerate.addEventListener("click", () => {
  state.authMethod = "generate";
  setAuthMethod("generate");
  refreshButtons();
});
elements.tabExisting.addEventListener("click", () => {
  state.authMethod = "existing";
  setAuthMethod("existing");
  refreshButtons();
});
elements.generateTokenButton.addEventListener("click", generateToken);
elements.clearCredentialsButton.addEventListener("click", clearCredentials);
elements.verifySuiteButton.addEventListener("click", reverifyReportSuite);
elements.reportSuiteId.addEventListener("change", reverifyReportSuite);
elements.validateButton.addEventListener("click", validateSelectedFile);
elements.uploadButton.addEventListener("click", uploadSelectedFile);
elements.statusButton.addEventListener("click", () => pollStatus());
elements.resetButton.addEventListener("click", resetFileState);
elements.copyKeyButton.addEventListener("click", () =>
  copyText(state.idempotencyKey, "Idempotency key copied").catch(() =>
    showToast("Unable to copy")
  )
);
elements.copyResponseButton.addEventListener("click", () =>
  copyLastResponse().catch(() => showToast("Unable to copy"))
);

setAuthMethod(state.authMethod);
resetFileState();
