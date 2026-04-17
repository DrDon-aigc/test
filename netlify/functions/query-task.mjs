import { jsonResponse, runninghubRequest, handleError } from "./_shared/runninghub.mjs";

export default async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  try {
    const body = await req.json();
    const taskId = body?.taskId;

    if (!taskId) {
      return jsonResponse({ error: "taskId is required." }, 400);
    }

    const payload = await runninghubRequest("/openapi/v2/query", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ taskId }),
    });

    return jsonResponse(payload);
  } catch (error) {
    return handleError(error);
  }
};

export const config = {
  path: "/api/query-task",
  method: ["POST"],
};
