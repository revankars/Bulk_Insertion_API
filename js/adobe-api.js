export const CONFIG = Object.freeze({
  API_BASE_URL: "https://analytics-collection.adobe.io",
  VALIDATE_ENDPOINT: "/aa/collect/v1/events/validate",
  UPLOAD_ENDPOINT: "/aa/collect/v1/events",
  STATUS_ENDPOINT: "/aa/collect/v1/events/key",
  STATUS_POLL_INTERVAL: 5000,
  MAX_STATUS_ATTEMPTS: 12,
  DEFAULT_VISITOR_GROUP_ID: "bulk-insertion-api",
});

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, "");
}

function buildRequestUrl(settings, endpoint, idempotencyKey = "") {
  const proxyBaseUrl = normalizeBaseUrl(settings.proxyBaseUrl);
  const routes = {
    [CONFIG.VALIDATE_ENDPOINT]: "/api/adobe/validate",
    [CONFIG.UPLOAD_ENDPOINT]: "/api/adobe/upload",
    [CONFIG.STATUS_ENDPOINT]: "/api/adobe/status",
  };
  const proxyRoute = routes[endpoint];
  return idempotencyKey
    ? `${proxyBaseUrl}${proxyRoute}/${encodeURIComponent(idempotencyKey)}`
    : `${proxyBaseUrl}${proxyRoute}`;
}

function buildHeaders(credentials, idempotencyKey, visitorGroupId) {
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${credentials.accessToken}`,
    "x-api-key": credentials.clientId,
  };
  if (visitorGroupId) {
    headers["x-adobe-vgid"] = visitorGroupId;
  }
  if (idempotencyKey) {
    headers["x-adobe-idempotency-key"] = idempotencyKey;
  }
  return headers;
}

async function parseResponse(response) {
  const rawBody = await response.text();
  let data = rawBody;

  if (rawBody) {
    try {
      data = JSON.parse(rawBody);
    } catch {
      // Preserve unexpected plain-text responses.
    }
  } else {
    data = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers: Object.fromEntries(response.headers.entries()),
    data,
    timestamp: new Date().toISOString(),
  };
}

async function sendFile(endpoint, compressedFile, credentials, settings, idempotencyKey) {
  const formData = new FormData();
  formData.append("file", compressedFile, compressedFile.name);

  const response = await fetch(buildRequestUrl(settings, endpoint), {
    method: "POST",
    headers: buildHeaders(credentials, idempotencyKey, settings.visitorGroupId),
    body: formData,
  });

  return parseResponse(response);
}

export function validateFile(compressedFile, credentials, settings) {
  return sendFile(CONFIG.VALIDATE_ENDPOINT, compressedFile, credentials, settings);
}

export function uploadFile(compressedFile, idempotencyKey, credentials, settings) {
  return sendFile(
    CONFIG.UPLOAD_ENDPOINT,
    compressedFile,
    credentials,
    settings,
    idempotencyKey
  );
}

export async function checkIngestionStatus(idempotencyKey, credentials, settings) {
  const response = await fetch(
    buildRequestUrl(settings, CONFIG.STATUS_ENDPOINT, idempotencyKey),
    {
      method: "GET",
      headers: buildHeaders(credentials),
    }
  );
  return parseResponse(response);
}

export function isFileReceived(result) {
  return result.ok &&
    typeof result.data === "object" &&
    result.data !== null &&
    Boolean(result.data.file_id);
}

export function isFileNotFound(result) {
  if (result.status === 404) {
    return true;
  }
  return typeof result.data === "object" &&
    result.data !== null &&
    String(result.data.error || "").toLowerCase() === "file not found";
}
