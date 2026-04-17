import {
  jsonResponse,
  runninghubRequest,
  handleError,
  getAppId,
} from "./_shared/runninghub.mjs";

export default async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  try {
    const body = await req.json();
    const fileName = body?.fileName;

    if (!fileName) {
      return jsonResponse({ error: "fileName is required." }, 400);
    }

    const payload = await runninghubRequest(`/openapi/v2/run/ai-app/${getAppId()}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        nodeInfoList: [
          {
            nodeId: "206",
            fieldName: "audio",
            fieldValue: fileName,
            description: "audio",
          },
        ],
        instanceType: "default",
        usePersonalQueue: false,
      }),
    });

    return jsonResponse(payload);
  } catch (error) {
    return handleError(error);
  }
};

export const config = {
  path: "/api/start-task",
  method: ["POST"],
};
