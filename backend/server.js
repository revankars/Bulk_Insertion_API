const path = require("node:path");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
require("dotenv").config();

const app = express();
const port = Number(process.env.PORT || 3000);
const adobeApiBaseUrl = (process.env.ADOBE_API_BASE_URL ||
  "https://analytics-collection.adobe.io").replace(/\/+$/, "");
const allowedOrigin = process.env.ALLOWED_ORIGIN || "http://localhost:8080";
const maxUploadMb = Number(process.env.MAX_UPLOAD_MB || 100);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: maxUploadMb * 1024 * 1024,
  },
});

app.disable("x-powered-by");
app.use(cors({
  origin: allowedOrigin,
  methods: ["GET", "POST"],
  allowedHeaders: [
    "Accept",
    "Authorization",
    "Content-Type",
    "x-api-key",
    "x-adobe-vgid",
    "x-adobe-idempotency-key",
  ],
}));
app.use(express.json({ limit: "16kb" }));
app.use(express.static(path.resolve(__dirname, "..")));

const defaultTokenEndpoint = process.env.ADOBE_TOKEN_ENDPOINT ||
  "https://ims-na1.adobelogin.com/ims/token/v3";

/**
 * Restricts token requests to Adobe IMS hosts so the proxy cannot be used
 * to forward credentials to an arbitrary destination.
 */
function resolveTokenEndpoint(requested) {
  const candidate = requested || defaultTokenEndpoint;
  let parsed;

  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith("adobelogin.com")) {
    return null;
  }
  return parsed.toString();
}

function requireAdobeCredentials(request, response, next) {
  const authorization = request.get("authorization");
  const clientId = request.get("x-api-key");

  if (!authorization?.startsWith("Bearer ")) {
    return response.status(400).json({
      error: "Missing or invalid Authorization header.",
    });
  }
  if (!clientId) {
    return response.status(400).json({
      error: "Missing x-api-key header.",
    });
  }
  return next();
}

function adobeHeaders(request, includeIdempotencyKey = false) {
  const headers = {
    Accept: "application/json",
    Authorization: request.get("authorization"),
    "x-api-key": request.get("x-api-key"),
  };

  const visitorGroupId = request.get("x-adobe-vgid");
  if (visitorGroupId) {
    headers["x-adobe-vgid"] = visitorGroupId;
  }
  if (includeIdempotencyKey) {
    headers["x-adobe-idempotency-key"] = request.get("x-adobe-idempotency-key");
  }
  return headers;
}

async function forwardAdobeResponse(adobeResponse, response) {
  const body = await adobeResponse.text();
  const contentType = adobeResponse.headers.get("content-type");

  response.status(adobeResponse.status);
  if (contentType) {
    response.type(contentType);
  }
  response.send(body);
}

async function postFileToAdobe(request, response, endpoint, includeIdempotencyKey = false) {
  if (!request.file) {
    return response.status(400).json({ error: "A gzip file is required in the file field." });
  }
  if (includeIdempotencyKey && !request.get("x-adobe-idempotency-key")) {
    return response.status(400).json({ error: "Missing x-adobe-idempotency-key header." });
  }
  if (includeIdempotencyKey && !request.get("x-adobe-vgid")) {
    return response.status(400).json({ error: "Missing x-adobe-vgid header." });
  }

  const form = new FormData();
  form.append(
    "file",
    new Blob([request.file.buffer], { type: request.file.mimetype || "application/gzip" }),
    request.file.originalname
  );

  const adobeResponse = await fetch(`${adobeApiBaseUrl}${endpoint}`, {
    method: "POST",
    headers: adobeHeaders(request, includeIdempotencyKey),
    body: form,
  });
  return forwardAdobeResponse(adobeResponse, response);
}

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});

/**
 * Exchanges Server-to-Server credentials for an IMS access token.
 * The client secret is read from the request body, forwarded once to Adobe,
 * and never logged, echoed back, or written to disk.
 */
app.post("/api/adobe/token", async (request, response, next) => {
  const { client_id: clientId, client_secret: clientSecret, scope } = request.body || {};

  if (!clientId || !clientSecret) {
    return response.status(400).json({
      error: "client_id and client_secret are required.",
    });
  }

  const tokenEndpoint = resolveTokenEndpoint(request.body?.token_endpoint);
  if (!tokenEndpoint) {
    return response.status(400).json({
      error: "token_endpoint must be an HTTPS Adobe IMS adobelogin.com URL.",
    });
  }

  try {
    const imsResponse = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope: String(scope || "").replace(/\s+/g, ""),
      }),
    });

    const rawBody = await imsResponse.text();
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return response.status(imsResponse.status).json({
        error: "Adobe IMS returned an unexpected response format.",
      });
    }

    if (!imsResponse.ok || !payload.access_token) {
      return response.status(imsResponse.status || 502).json({
        error: payload.error_description || payload.error || "Token request failed.",
      });
    }

    // Only token material the browser needs is returned.
    return response.json({
      access_token: payload.access_token,
      token_type: payload.token_type || "bearer",
      expires_in: payload.expires_in,
    });
  } catch (error) {
    return next(error);
  }
});

app.post(
  "/api/adobe/validate",
  requireAdobeCredentials,
  upload.single("file"),
  async (request, response, next) => {
    try {
      await postFileToAdobe(request, response, "/aa/collect/v1/events/validate");
    } catch (error) {
      next(error);
    }
  }
);

app.post(
  "/api/adobe/upload",
  requireAdobeCredentials,
  upload.single("file"),
  async (request, response, next) => {
    try {
      await postFileToAdobe(request, response, "/aa/collect/v1/events", true);
    } catch (error) {
      next(error);
    }
  }
);

app.get(
  "/api/adobe/status/:idempotencyKey",
  requireAdobeCredentials,
  async (request, response, next) => {
    try {
      const key = encodeURIComponent(request.params.idempotencyKey);
      const adobeResponse = await fetch(
        `${adobeApiBaseUrl}/aa/collect/v1/events/key/${key}`,
        {
          method: "GET",
          headers: adobeHeaders(request),
        }
      );
      await forwardAdobeResponse(adobeResponse, response);
    } catch (error) {
      next(error);
    }
  }
);

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError) {
    return response.status(400).json({
      error: error.code === "LIMIT_FILE_SIZE"
        ? `File exceeds the ${maxUploadMb} MB proxy limit.`
        : error.message,
    });
  }

  console.error("Adobe proxy request failed without logging credentials.");
  return response.status(502).json({
    error: "The proxy could not complete the Adobe API request.",
  });
});

app.listen(port, () => {
  console.log(`Bulk insertion proxy listening on http://localhost:${port}`);
});
