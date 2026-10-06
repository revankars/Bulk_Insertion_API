export const TOKEN_CONFIG = Object.freeze({
  DEFAULT_TOKEN_ENDPOINT: "https://ims-na1.adobelogin.com/ims/token/v3",
  DEFAULT_SCOPES: "openid, AdobeID, additional_info.projectedProductContext",
  ALLOWED_TOKEN_HOSTS: ["ims-na1.adobelogin.com", "ims-na1-stg1.adobelogin.com"],
});

function assertTokenEndpoint(tokenEndpoint) {
  let parsed;
  try {
    parsed = new URL(tokenEndpoint);
  } catch {
    throw new Error("The token endpoint is not a valid URL.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("The token endpoint must use HTTPS.");
  }
  if (!parsed.hostname.endsWith("adobelogin.com")) {
    throw new Error("The token endpoint must be an Adobe IMS adobelogin.com host.");
  }
  return parsed.toString();
}

/**
 * Removes token material so a response can be displayed safely.
 */
function redactTokenPayload(payload) {
  if (typeof payload !== "object" || payload === null) {
    return payload;
  }

  const redacted = { ...payload };
  for (const key of ["access_token", "refresh_token", "id_token"]) {
    if (key in redacted) {
      redacted[key] = "<redacted>";
    }
  }
  return redacted;
}

async function readTokenResponse(response) {
  const rawBody = await response.text();
  let data = rawBody || null;

  if (rawBody) {
    try {
      data = JSON.parse(rawBody);
    } catch {
      // Preserve unexpected plain-text responses.
    }
  }

  const accessToken = typeof data === "object" && data !== null ? data.access_token : "";
  const expiresIn = typeof data === "object" && data !== null ? Number(data.expires_in) : 0;

  return {
    ok: response.ok && Boolean(accessToken),
    status: response.status,
    statusText: response.statusText,
    headers: {},
    accessToken: accessToken || "",
    expiresIn: Number.isFinite(expiresIn) ? expiresIn : 0,
    data: redactTokenPayload(data),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Exchanges Server-to-Server credentials for a short-lived IMS access token.
 * The request always goes through the backend proxy because Adobe IMS does not
 * return CORS headers for browser origins. The client secret is used for this
 * request only and is never returned or stored.
 */
export async function requestAccessToken(credentials, settings) {
  const tokenEndpoint = assertTokenEndpoint(
    credentials.tokenEndpoint || TOKEN_CONFIG.DEFAULT_TOKEN_ENDPOINT
  );
  const scope = (credentials.scopes || TOKEN_CONFIG.DEFAULT_SCOPES).replace(/\s+/g, "");
  const proxyBaseUrl = settings.proxyBaseUrl.replace(/\/+$/, "");

  const response = await fetch(`${proxyBaseUrl}/api/adobe/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      scope,
      token_endpoint: tokenEndpoint,
    }),
  });
  return readTokenResponse(response);
}
