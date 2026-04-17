import { jsonResponse, runninghubRequest, handleError } from "./_shared/runninghub.mjs";

export default async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  try {
    const contentType = req.headers.get("content-type") || "audio/webm";
    const arrayBuffer = await req.arrayBuffer();

    if (!arrayBuffer.byteLength) {
      return jsonResponse({ error: "Audio payload is empty." }, 400);
    }

    if (arrayBuffer.byteLength > 5 * 1024 * 1024) {
      return jsonResponse({ error: "Audio file is too large." }, 413);
    }

    const extension = contentType.includes("mp4")
      ? "m4a"
      : contentType.includes("ogg")
        ? "ogg"
        : contentType.includes("wav")
          ? "wav"
          : "webm";

    const file = new Blob([arrayBuffer], { type: contentType });
    const formData = new FormData();
    formData.append("file", file, `voice-reply.${extension}`);

    const payload = await runninghubRequest("/openapi/v2/media/upload/binary", {
      method: "POST",
      body: formData,
    });

    return jsonResponse({
      fileName: payload?.data?.fileName || payload?.data?.download_url || null,
      downloadUrl: payload?.data?.download_url || null,
      size: payload?.data?.size || null,
    });
  } catch (error) {
    return handleError(error);
  }
};

export const config = {
  path: "/api/upload-audio",
  method: ["POST"],
};
