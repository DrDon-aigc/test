const globalState = {
  hasPermission: false,
  recognitionSupported: Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
  isFileMode: window.location.protocol === "file:",
  activeRecordingPanelId: null,
};

const runtimeNote = document.querySelector("#runtimeNote");
const permissionButton = document.querySelector("#permissionButton");
const panelElements = [...document.querySelectorAll("[data-panel-id]")];

const panels = panelElements.map((root) => createPanelController(root));

function createPanelController(root) {
  const state = {
    id: root.dataset.panelId,
    root,
    statusEl: root.querySelector('[data-role="status"]'),
    replyButton: root.querySelector('[data-role="replyButton"]'),
    recordButton: root.querySelector('[data-role="recordButton"]'),
    timerEl: root.querySelector('[data-role="timer"]'),
    transcriptInput: root.querySelector('[data-role="transcriptInput"]'),
    audioCard: root.querySelector('[data-role="audioCard"]'),
    audioPlayer: root.querySelector('[data-role="audioPlayer"]'),
    progressText: root.querySelector('[data-role="progressText"]'),
    loadingView: root.querySelector('[data-role="loadingView"]'),
    videoShell: root.querySelector('[data-role="videoShell"]'),
    resultVideo: root.querySelector('[data-role="resultVideo"]'),
    meterEl: root.querySelector('[data-role="meter"]'),
    meterBars: [],
    isRecording: false,
    isBusy: false,
    activePointerId: null,
    stream: null,
    mediaRecorder: null,
    audioContext: null,
    analyser: null,
    meterId: null,
    timerId: null,
    startedAt: null,
    audioBlob: null,
    audioUrl: "",
    transcript: "",
    chunks: [],
    pollId: null,
    taskId: null,
    recognition: null,
  };

  for (let index = 0; index < 24; index += 1) {
    const bar = document.createElement("span");
    bar.style.height = "10px";
    state.meterEl.appendChild(bar);
    state.meterBars.push(bar);
  }

  state.recordButton.addEventListener("pointerdown", (event) => beginPress(state, event));
  state.recordButton.addEventListener("pointerup", (event) => endPress(state, event));
  state.recordButton.addEventListener("pointercancel", (event) => endPress(state, event));
  state.recordButton.addEventListener("lostpointercapture", async () => {
    state.activePointerId = null;
    await stopRecording(state);
  });
  state.recordButton.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  state.replyButton.addEventListener("click", async () => {
    try {
      state.transcript = state.transcriptInput.value.trim();
      await uploadAudioAndStartTask(state);
    } catch (error) {
      state.isBusy = false;
      syncButtons();
      setStatus(state, "未连接");
      setText(state.progressText, error instanceof Error ? error.message : "发生了未知错误。");
    }
  });

  setStatus(state, "等待授权");
  setText(state.progressText, "先按住录音，松手检查后再点击回复。");
  setOutputMode(state, { loading: true });
  stopMeters(state);
  return state;
}

function setText(element, value) {
  element.textContent = value;
}

function setStatus(panel, value) {
  setText(panel.statusEl, value);
}

function formatDuration(elapsedMs) {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function anyPanelRecording() {
  return panels.some((panel) => panel.isRecording);
}

function releaseAudioUrl(panel) {
  if (panel.audioUrl) {
    URL.revokeObjectURL(panel.audioUrl);
    panel.audioUrl = "";
  }
}

function syncButtons() {
  const recordingPanel = panels.find((panel) => panel.isRecording);

  permissionButton.disabled = panels.some((panel) => panel.isBusy || panel.isRecording);
  permissionButton.textContent = globalState.hasPermission ? "录音权限已开启" : "开启录音权限";

  panels.forEach((panel) => {
    const blockedByOtherRecording =
      Boolean(recordingPanel) && recordingPanel.id !== panel.id && !panel.isRecording;

    panel.recordButton.disabled =
      !globalState.hasPermission || panel.isBusy || blockedByOtherRecording;
    panel.replyButton.disabled = panel.isBusy || !panel.audioBlob;
    panel.recordButton.querySelector(".record-button-text").textContent = panel.isRecording
      ? "松手停止"
      : "长按录音";
  });
}

function setOutputMode(panel, { loading = true, videoUrl = "" } = {}) {
  panel.loadingView.classList.toggle("hidden", !loading);
  panel.videoShell.classList.toggle("hidden", loading);

  if (videoUrl) {
    panel.resultVideo.onloadeddata = null;
    panel.resultVideo.src = videoUrl;
    panel.resultVideo.load();
    panel.resultVideo.onloadeddata = () => {
      panel.resultVideo.play().catch(() => {
        // Autoplay can be blocked by the browser; controls remain available.
      });
    };
  }
}

function stopMeters(panel) {
  if (panel.meterId) {
    cancelAnimationFrame(panel.meterId);
    panel.meterId = null;
  }

  panel.meterBars.forEach((bar, index) => {
    bar.style.height = `${10 + (index % 3) * 2}px`;
    bar.style.opacity = "0.18";
  });
}

function startMeters(panel) {
  if (!panel.analyser) {
    return;
  }

  const buffer = new Uint8Array(panel.analyser.frequencyBinCount);

  const draw = () => {
    panel.analyser.getByteFrequencyData(buffer);

    panel.meterBars.forEach((bar, index) => {
      const bucket = buffer[index * 2] || 0;
      const height = Math.max(10, (bucket / 255) * 48 + 8);
      bar.style.height = `${height}px`;
      bar.style.opacity = String(0.18 + (bucket / 255) * 0.72);
    });

    panel.meterId = requestAnimationFrame(draw);
  };

  draw();
}

function resetTaskView(panel) {
  if (panel.pollId) {
    clearInterval(panel.pollId);
    panel.pollId = null;
  }

  panel.taskId = null;
  panel.resultVideo.pause();
  panel.resultVideo.removeAttribute("src");
  panel.resultVideo.load();
  setOutputMode(panel, { loading: true });
  setText(panel.progressText, "先按住录音，松手检查后再点击回复。");
}

function clearCurrentTake(panel) {
  panel.audioBlob = null;
  panel.transcript = "";
  releaseAudioUrl(panel);
  panel.audioPlayer.removeAttribute("src");
  panel.audioPlayer.load();
  panel.audioCard.classList.add("hidden");
  panel.transcriptInput.value = "";
  panel.timerEl.textContent = "00:00";
  resetTaskView(panel);
  syncButtons();
}

function createRecognition(panel) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!Recognition) {
    return null;
  }

  const recognition = new Recognition();
  recognition.lang = "zh-CN";
  recognition.interimResults = true;
  recognition.continuous = true;

  recognition.onresult = (event) => {
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

    panel.transcript = `${finalText}${interimText}`.trim();
    panel.transcriptInput.value = panel.transcript;
  };

  recognition.onerror = () => {
    if (!panel.transcriptInput.value) {
      panel.transcriptInput.placeholder = "实时转写暂时中断了，你也可以手动补充文字。";
    }
  };

  recognition.onend = () => {
    if (panel.isRecording && panel.recognition === recognition) {
      try {
        recognition.start();
      } catch {
        // Ignore restart timing issues.
      }
    }
  };

  return recognition;
}

function stopRecognition(panel) {
  if (!panel.recognition) {
    return;
  }

  const recognition = panel.recognition;
  panel.recognition = null;
  recognition.onresult = null;
  recognition.onend = null;
  recognition.onerror = null;

  try {
    recognition.stop();
  } catch {
    // Ignore browser-specific stop errors.
  }
}

function updateTimer(panel) {
  panel.timerEl.textContent = formatDuration(Date.now() - panel.startedAt);
}

async function cleanupStream(panel) {
  panel.stream?.getTracks().forEach((track) => track.stop());
  panel.stream = null;

  if (panel.audioContext && panel.audioContext.state !== "closed") {
    await panel.audioContext.close();
  }

  panel.audioContext = null;
  panel.analyser = null;
}

async function startRecording(panel) {
  if (
    !globalState.hasPermission ||
    panel.isBusy ||
    panel.isRecording ||
    (globalState.activeRecordingPanelId && globalState.activeRecordingPanelId !== panel.id)
  ) {
    return;
  }

  clearCurrentTake(panel);
  panel.chunks = [];
  panel.transcript = "";
  panel.transcriptInput.placeholder = "松手后，这里会显示实时转写，你也可以手动修改。";
  setStatus(panel, "录音中");

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  panel.stream = stream;

  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";

  panel.mediaRecorder = new MediaRecorder(stream, { mimeType });
  panel.mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      panel.chunks.push(event.data);
    }
  };

  panel.mediaRecorder.onstop = async () => {
    const blob = new Blob(panel.chunks, { type: panel.mediaRecorder.mimeType });
    panel.audioBlob = blob;
    releaseAudioUrl(panel);
    panel.audioUrl = URL.createObjectURL(blob);
    panel.audioPlayer.src = panel.audioUrl;
    panel.audioCard.classList.remove("hidden");

    await cleanupStream(panel);
    stopMeters(panel);
    stopRecognition(panel);

    panel.isRecording = false;
    globalState.activeRecordingPanelId = null;
    setStatus(panel, "检查文字和音频");
    setText(panel.progressText, "确认无误后，点击回复开始任务。");
    syncButtons();
  };

  panel.audioContext = new AudioContext();
  const source = panel.audioContext.createMediaStreamSource(stream);
  panel.analyser = panel.audioContext.createAnalyser();
  panel.analyser.fftSize = 64;
  source.connect(panel.analyser);
  startMeters(panel);

  panel.startedAt = Date.now();
  updateTimer(panel);
  panel.timerId = setInterval(() => updateTimer(panel), 250);
  panel.isRecording = true;
  globalState.activeRecordingPanelId = panel.id;
  panel.recordButton.classList.add("is-recording");
  syncButtons();

  panel.mediaRecorder.start();

  if (globalState.recognitionSupported) {
    panel.recognition = createRecognition(panel);
    if (panel.recognition) {
      try {
        panel.recognition.start();
      } catch {
        panel.transcriptInput.placeholder = "实时转写暂时没有启动，你也可以手动补充文字。";
      }
    }
  } else {
    panel.transcriptInput.placeholder = "当前浏览器不支持实时转写，你也可以手动补充文字。";
  }
}

async function stopRecording(panel) {
  if (!panel.isRecording || !panel.mediaRecorder) {
    return;
  }

  if (panel.timerId) {
    clearInterval(panel.timerId);
    panel.timerId = null;
  }

  panel.recordButton.classList.remove("is-recording");

  if (panel.mediaRecorder.state !== "inactive") {
    panel.mediaRecorder.stop();
  }
}

async function requestPermission() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("当前浏览器不支持麦克风访问。");
  }

  if (!window.isSecureContext) {
    throw new Error("当前页面不是安全环境，请通过 Netlify HTTPS 地址打开。");
  }

  permissionButton.disabled = true;
  permissionButton.textContent = "请求权限中...";
  panels.forEach((panel) => {
    setStatus(panel, "请求权限中");
    setText(panel.progressText, "浏览器可能会弹出麦克风授权，请点击允许。");
  });

  try {
    const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    tempStream.getTracks().forEach((track) => track.stop());
    globalState.hasPermission = true;
    panels.forEach((panel) => {
      setStatus(panel, "已授权，可以录音");
      setText(panel.progressText, "按住录音键，松手检查，再点击回复。");
    });
  } finally {
    permissionButton.textContent = globalState.hasPermission ? "录音权限已开启" : "开启录音权限";
    syncButtons();
  }
}

async function uploadAudioAndStartTask(panel) {
  if (!panel.audioBlob) {
    return;
  }

  panel.isBusy = true;
  setStatus(panel, "上传中");
  setText(panel.progressText, "声音已送出，正在等待回应。");
  setOutputMode(panel, { loading: true });
  syncButtons();

  const uploadResponse = await fetch("/api/upload-audio", {
    method: "POST",
    headers: {
      "Content-Type": panel.audioBlob.type || "audio/webm",
    },
    body: panel.audioBlob,
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

  panel.taskId = startPayload.taskId;
  await queryTask(panel);

  panel.pollId = setInterval(() => {
    queryTask(panel).catch((error) => {
      clearInterval(panel.pollId);
      panel.pollId = null;
      panel.isBusy = false;
      syncButtons();
      setStatus(panel, "已中断");
      setText(panel.progressText, error instanceof Error ? error.message : "查询失败。");
    });
  }, 4000);
}

async function queryTask(panel) {
  if (!panel.taskId) {
    return;
  }

  const response = await fetch("/api/query-task", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId: panel.taskId }),
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || payload.errorMessage || "查询失败。");
  }

  if (payload.status === "FAILED") {
    clearInterval(panel.pollId);
    panel.pollId = null;
    panel.isBusy = false;
    syncButtons();
    setStatus(panel, "生成失败");
    setText(panel.progressText, payload.errorMessage || "这次没有成功返回结果。");
    return;
  }

  if (payload.status === "SUCCESS") {
    clearInterval(panel.pollId);
    panel.pollId = null;
    panel.isBusy = false;
    syncButtons();

    const result =
      payload.results?.find((item) => item.outputType?.toLowerCase() === "mp4") ||
      payload.results?.[0];

    if (!result?.url) {
      throw new Error("任务完成了，但没有拿到视频地址。");
    }

    setStatus(panel, "已完成");
    setText(panel.progressText, "视频已经回来。");
    setOutputMode(panel, { loading: false, videoUrl: result.url });
    return;
  }

  setStatus(panel, "生成中");
  setText(panel.progressText, "正在处理中，请稍等片刻。");
}

async function beginPress(panel, event) {
  event.preventDefault();
  if (panel.recordButton.disabled || panel.activePointerId !== null) {
    return;
  }

  panel.activePointerId = event.pointerId;
  panel.recordButton.setPointerCapture(event.pointerId);

  try {
    await startRecording(panel);
  } catch (error) {
    panel.activePointerId = null;
    panel.isRecording = false;
    globalState.activeRecordingPanelId = null;
    panel.recordButton.classList.remove("is-recording");
    stopMeters(panel);
    await cleanupStream(panel);
    stopRecognition(panel);
    setStatus(panel, "不可用");
    setText(panel.progressText, error instanceof Error ? error.message : "无法开始录音。");
    syncButtons();
  }
}

async function endPress(panel, event) {
  event.preventDefault();
  if (panel.activePointerId !== event.pointerId) {
    return;
  }

  if (panel.recordButton.hasPointerCapture(event.pointerId)) {
    panel.recordButton.releasePointerCapture(event.pointerId);
  }

  panel.activePointerId = null;
  await stopRecording(panel);
}

permissionButton.addEventListener("click", async () => {
  try {
    await requestPermission();
  } catch (error) {
    panels.forEach((panel) => {
      setStatus(panel, "授权失败");
      setText(panel.progressText, error instanceof Error ? error.message : "无法获取麦克风权限。");
    });
    permissionButton.textContent = "开启录音权限";
    syncButtons();
  }
});

function ensureRuntime() {
  if (!globalState.isFileMode) {
    return;
  }

  runtimeNote.classList.add("is-warning");
  setText(runtimeNote, "当前是文件预览，真正可用版本请部署到 Netlify");
  panels.forEach((panel) => {
    setStatus(panel, "请先部署到 Netlify");
    setText(panel.progressText, "部署后你会获得 HTTPS 和稳定的麦克风权限。");
  });
}

ensureRuntime();
syncButtons();
