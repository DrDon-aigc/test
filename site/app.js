const state = {
  hasPermission: false,
  isRecording: false,
  isBusy: false,
  stream: null,
  mediaRecorder: null,
  analyser: null,
  audioContext: null,
  audioBlob: null,
  audioUrl: "",
  recognition: null,
  recognitionSupported: false,
  transcript: "",
  chunks: [],
  meterBars: [],
  meterId: null,
  timerId: null,
  startedAt: null,
  pollId: null,
  taskId: null,
  pollIntervalMs: 4000,
  isFileMode: window.location.protocol === "file:",
  activePointerId: null,
};

const permissionButton = document.querySelector("#permissionButton");
const replyButton = document.querySelector("#replyButton");
const recordButton = document.querySelector("#recordButton");
const timer = document.querySelector("#timer");
const runtimeNote = document.querySelector("#runtimeNote");
const statusLine = document.querySelector("#statusLine");
const transcriptInput = document.querySelector("#transcriptInput");
const audioCard = document.querySelector("#audioCard");
const audioPlayer = document.querySelector("#audioPlayer");
const progressText = document.querySelector("#progressText");
const loadingView = document.querySelector("#loadingView");
const videoShell = document.querySelector("#videoShell");
const resultVideo = document.querySelector("#resultVideo");
const meter = document.querySelector("#meter");

for (let index = 0; index < 24; index += 1) {
  const bar = document.createElement("span");
  bar.style.height = "10px";
  meter.appendChild(bar);
  state.meterBars.push(bar);
}

const setText = (element, value) => {
  element.textContent = value;
};

const formatDuration = (elapsedMs) => {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
};

const setStatus = (value) => {
  setText(statusLine, value);
};

const releaseAudioUrl = () => {
  if (state.audioUrl) {
    URL.revokeObjectURL(state.audioUrl);
    state.audioUrl = "";
  }
};

const syncButtons = () => {
  permissionButton.disabled = state.isBusy || state.isRecording;
  recordButton.disabled = !state.hasPermission || state.isBusy;
  replyButton.disabled = state.isBusy || !state.audioBlob;
  recordButton.querySelector(".record-button-text").textContent = state.isRecording
    ? "松手停止"
    : "长按录音";
};

const setOutputMode = ({ loading = true, videoUrl = "" } = {}) => {
  loadingView.classList.toggle("hidden", !loading);
  videoShell.classList.toggle("hidden", loading);

  if (videoUrl) {
    resultVideo.src = videoUrl;
    resultVideo.load();
    const tryPlay = () => {
      resultVideo.play().catch(() => {
        // Autoplay can be blocked by the browser; controls remain available.
      });
    };
    resultVideo.onloadeddata = tryPlay;
  }
};

const stopMeters = () => {
  if (state.meterId) {
    cancelAnimationFrame(state.meterId);
    state.meterId = null;
  }

  state.meterBars.forEach((bar, index) => {
    bar.style.height = `${10 + (index % 3) * 2}px`;
    bar.style.opacity = "0.18";
  });
};

const startMeters = () => {
  if (!state.analyser) {
    return;
  }

  const buffer = new Uint8Array(state.analyser.frequencyBinCount);

  const draw = () => {
    state.analyser.getByteFrequencyData(buffer);

    state.meterBars.forEach((bar, index) => {
      const bucket = buffer[index * 2] || 0;
      const height = Math.max(10, (bucket / 255) * 48 + 8);
      bar.style.height = `${height}px`;
      bar.style.opacity = String(0.18 + (bucket / 255) * 0.72);
    });

    state.meterId = requestAnimationFrame(draw);
  };

  draw();
};

const resetTaskView = () => {
  if (state.pollId) {
    clearInterval(state.pollId);
    state.pollId = null;
  }

  state.taskId = null;
  resultVideo.pause();
  resultVideo.removeAttribute("src");
  resultVideo.load();
  setOutputMode({ loading: true });
  setText(progressText, "先长按录音，松手后检查，再点击回复。");
};

const clearCurrentTake = () => {
  state.audioBlob = null;
  state.transcript = "";
  releaseAudioUrl();
  audioPlayer.removeAttribute("src");
  audioPlayer.load();
  audioCard.classList.add("hidden");
  transcriptInput.value = "";
  timer.textContent = "00:00";
  resetTaskView();
  syncButtons();
};

const stopRecognition = () => {
  if (!state.recognition) {
    return;
  }

  state.recognition.onresult = null;
  state.recognition.onend = null;
  state.recognition.onerror = null;

  try {
    state.recognition.stop();
  } catch {
    // Ignore browser-specific stop errors.
  }
};

const setupRecognition = () => {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!Recognition) {
    state.recognitionSupported = false;
    transcriptInput.placeholder = "当前浏览器不支持实时转写，你仍然可以录音和回放。";
    return;
  }

  state.recognitionSupported = true;
  state.recognition = new Recognition();
  state.recognition.lang = "zh-CN";
  state.recognition.interimResults = true;
  state.recognition.continuous = true;

  state.recognition.onresult = (event) => {
    let finalText = "";
    let interimText = "";

    for (let index = 0; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = result[0]?.transcript || "";

      if (result.isFinal) {
        finalText += transcript;
      } else {
        interimText += transcript;
      }
    }

    state.transcript = `${finalText}${interimText}`.trim();
    transcriptInput.value = state.transcript;
  };

  state.recognition.onerror = () => {
    if (!transcriptInput.value) {
      transcriptInput.placeholder = "实时转写中断了，但录音仍可正常使用。";
    }
  };

  state.recognition.onend = () => {
    if (state.isRecording) {
      try {
        state.recognition.start();
      } catch {
        // Ignore restart timing issues.
      }
    }
  };
};

const ensureRuntime = () => {
  if (!state.isFileMode) {
    return;
  }

  runtimeNote.classList.add("is-warning");
  setText(runtimeNote, "当前是文件预览，真正可用版本请部署到 Netlify");
  setStatus("请先部署到 Netlify");
  setText(progressText, "部署后你会获得 HTTPS 和稳定的麦克风权限。");
};

const updateTimer = () => {
  timer.textContent = formatDuration(Date.now() - state.startedAt);
};

const cleanupStream = async () => {
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;

  if (state.audioContext && state.audioContext.state !== "closed") {
    await state.audioContext.close();
  }

  state.audioContext = null;
  state.analyser = null;
};

const startRecording = async () => {
  if (!state.hasPermission || state.isBusy || state.isRecording) {
    return;
  }

  clearCurrentTake();
  setStatus("按住录音中");
  transcriptInput.placeholder = "松手后，你可以在这里检查转写。";
  state.chunks = [];
  state.transcript = "";

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  state.stream = stream;

  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";

  state.mediaRecorder = new MediaRecorder(stream, { mimeType });
  state.mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      state.chunks.push(event.data);
    }
  };

  state.mediaRecorder.onstop = async () => {
    const blob = new Blob(state.chunks, { type: state.mediaRecorder.mimeType });
    state.audioBlob = blob;
    releaseAudioUrl();
    state.audioUrl = URL.createObjectURL(blob);
    audioPlayer.src = state.audioUrl;
    audioCard.classList.remove("hidden");

    await cleanupStream();
    stopMeters();
    stopRecognition();

    state.isRecording = false;
    setStatus("检查文字和音频，再点回复");
    setText(progressText, "确认无误后，点击回复开始任务。");
    syncButtons();
  };

  state.audioContext = new AudioContext();
  const source = state.audioContext.createMediaStreamSource(stream);
  state.analyser = state.audioContext.createAnalyser();
  state.analyser.fftSize = 64;
  source.connect(state.analyser);
  startMeters();

  state.startedAt = Date.now();
  updateTimer();
  state.timerId = setInterval(updateTimer, 250);
  state.isRecording = true;
  recordButton.classList.add("is-recording");
  syncButtons();

  state.mediaRecorder.start();

  if (state.recognitionSupported) {
    try {
      state.recognition.start();
    } catch {
      transcriptInput.placeholder = "实时转写暂时没有启动。";
    }
  }
};

const stopRecording = async () => {
  if (!state.isRecording || !state.mediaRecorder) {
    return;
  }

  if (state.timerId) {
    clearInterval(state.timerId);
    state.timerId = null;
  }

  recordButton.classList.remove("is-recording");

  if (state.mediaRecorder.state !== "inactive") {
    state.mediaRecorder.stop();
  }
};

const requestPermission = async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("当前浏览器不支持麦克风访问。");
  }

  if (!window.isSecureContext) {
    throw new Error("当前页面不是安全环境，请通过 Netlify HTTPS 地址打开。");
  }

  permissionButton.disabled = true;
  setStatus("请求权限中");
  setText(progressText, "浏览器可能会弹出麦克风授权，请点击允许。");
  setText(permissionButton, "请求权限中...");

  try {
    const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    tempStream.getTracks().forEach((track) => track.stop());
    state.hasPermission = true;
    setStatus("已授权，可以长按录音");
    setText(progressText, "按住左侧录音键，松手后检查，再点击回复。");
    setText(permissionButton, "已开启录音权限");
  } catch (error) {
    state.hasPermission = false;
    setText(permissionButton, "开启录音权限");
    throw error;
  } finally {
    syncButtons();
  }
};

const uploadAudioAndStartTask = async () => {
  if (!state.audioBlob) {
    return;
  }

  state.isBusy = true;
  setStatus("上传中");
  setText(progressText, "声音已送出，正在等待回应。");
  setOutputMode({ loading: true });
  syncButtons();

  const uploadResponse = await fetch("/api/upload-audio", {
    method: "POST",
    headers: {
      "Content-Type": state.audioBlob.type || "audio/webm",
    },
    body: state.audioBlob,
  });
  const uploadPayload = await uploadResponse.json();

  if (!uploadResponse.ok) {
    throw new Error(uploadPayload.error || "上传失败。");
  }

  const startResponse = await fetch("/api/start-task", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: uploadPayload.fileName }),
  });
  const startPayload = await startResponse.json();

  if (!startResponse.ok) {
    throw new Error(startPayload.error || startPayload.errorMessage || "创建任务失败。");
  }

  state.taskId = startPayload.taskId;
  await queryTask();

  state.pollId = setInterval(() => {
    queryTask().catch((error) => {
      clearInterval(state.pollId);
      state.pollId = null;
      state.isBusy = false;
      syncButtons();
      setStatus("已中断");
      setText(progressText, error instanceof Error ? error.message : "查询失败。");
    });
  }, state.pollIntervalMs);
};

const queryTask = async () => {
  if (!state.taskId) {
    return;
  }

  const response = await fetch("/api/query-task", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId: state.taskId }),
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || payload.errorMessage || "查询失败。");
  }

  if (payload.status === "FAILED") {
    clearInterval(state.pollId);
    state.pollId = null;
    state.isBusy = false;
    syncButtons();
    setStatus("生成失败");
    setText(progressText, payload.errorMessage || "这次没有成功返回结果。");
    return;
  }

  if (payload.status === "SUCCESS") {
    clearInterval(state.pollId);
    state.pollId = null;
    state.isBusy = false;
    syncButtons();

    const result =
      payload.results?.find((item) => item.outputType?.toLowerCase() === "mp4") ||
      payload.results?.[0];

    if (!result?.url) {
      throw new Error("任务完成了，但没有拿到视频地址。");
    }

    setStatus("已完成");
    setText(progressText, "视频已经回来。");
    setOutputMode({ loading: false, videoUrl: result.url });
    return;
  }

  setStatus("生成中");
  setText(progressText, "正在处理中，请稍等片刻。");
};

permissionButton.addEventListener("click", async () => {
  try {
    await requestPermission();
  } catch (error) {
    setStatus("授权失败");
    setText(progressText, error instanceof Error ? error.message : "无法获取麦克风权限。");
    syncButtons();
  }
});

const beginPress = async (event) => {
  event.preventDefault();
  if (recordButton.disabled || state.activePointerId !== null) {
    return;
  }

  state.activePointerId = event.pointerId;
  recordButton.setPointerCapture(event.pointerId);

  try {
    await startRecording();
  } catch (error) {
    state.activePointerId = null;
    state.isRecording = false;
    recordButton.classList.remove("is-recording");
    stopMeters();
    await cleanupStream();
    setStatus("不可用");
    setText(progressText, error instanceof Error ? error.message : "无法开始录音。");
    syncButtons();
  }
};

const endPress = async (event) => {
  event.preventDefault();
  if (state.activePointerId !== event.pointerId) {
    return;
  }

  if (recordButton.hasPointerCapture(event.pointerId)) {
    recordButton.releasePointerCapture(event.pointerId);
  }

  state.activePointerId = null;
  await stopRecording();
};

recordButton.addEventListener("pointerdown", beginPress);
recordButton.addEventListener("pointerup", endPress);
recordButton.addEventListener("pointercancel", endPress);
recordButton.addEventListener("lostpointercapture", async () => {
  state.activePointerId = null;
  await stopRecording();
});
recordButton.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

replyButton.addEventListener("click", async () => {
  try {
    state.transcript = transcriptInput.value.trim();
    await uploadAudioAndStartTask();
  } catch (error) {
    state.isBusy = false;
    syncButtons();
    setStatus("未连接");
    setText(progressText, error instanceof Error ? error.message : "发生了未知错误。");
  }
});

ensureRuntime();
setupRecognition();
setOutputMode({ loading: true });
syncButtons();
stopMeters();
