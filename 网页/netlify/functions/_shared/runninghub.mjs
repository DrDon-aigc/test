const appId = "2032114994288005121";

export const jsonResponse = (payload, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

export const getApiKey = () => {
  const apiKey =
    typeof Netlify !== "undefined" ? Netlify.env.get("RUNNINGHUB_API_KEY") : null;

  if (!apiKey) {
    throw new Error("RUNNINGHUB_API_KEY is not configured.");
  }

  return apiKey;
};

export const getAppId = () => appId;

export const runninghubRequest = async (path, init = {}) => {
  const response = await fetch(`https://www.runninghub.cn${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      ...(init.headers || {}),
    },
  });

  const text = await response.text();
  let payload = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const message =
      payload?.errorMessage ||
      payload?.message ||
      payload?.raw ||
      `RunningHub request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload;
};

export const handleError = (error) =>
  jsonResponse(
    {
      error: error instanceof Error ? error.message : "Unexpected server error",
    },
    500
  );
