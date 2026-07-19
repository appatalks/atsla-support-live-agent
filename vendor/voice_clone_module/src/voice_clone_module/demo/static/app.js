const form = document.querySelector("#chat-form");
const input = document.querySelector("#message");
const send = document.querySelector("#send");
const status = document.querySelector("#status");
const conversation = document.querySelector("#conversation");
const modelSelect = document.querySelector("#model");
const record = document.querySelector("#record");
const recordLabel = document.querySelector("#record-label");
const history = [];
let recorder = null;
let recordingChunks = [];

function addTurn(role, content, audioUrl = null) {
  const empty = conversation.querySelector(".empty-state");
  if (empty) empty.remove();

  const turn = document.createElement("div");
  turn.className = `turn ${role}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  const text = document.createElement("p");
  text.textContent = content;
  bubble.appendChild(text);
  if (audioUrl) {
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.autoplay = true;
    audio.src = `${audioUrl}?t=${Date.now()}`;
    bubble.appendChild(audio);
  }
  turn.appendChild(bubble);
  conversation.appendChild(turn);
  conversation.scrollTop = conversation.scrollHeight;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message) return;

  addTurn("user", message);
  input.value = "";
  input.focus();
  send.disabled = true;
  status.textContent = "Thinking";

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history, model_key: modelSelect.value }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || "The agent could not respond.");
    addTurn("assistant", payload.reply, payload.audio_url);
    history.push({ role: "user", content: message });
    history.push({ role: "assistant", content: payload.reply });
    status.textContent = "Ready";
  } catch (error) {
    addTurn("assistant", error.message);
    status.textContent = "Needs attention";
  } finally {
    send.disabled = false;
  }
});

async function loadModels() {
  const response = await fetch("/api/models");
  const payload = await response.json();
  for (const [key, option] of Object.entries(payload.models)) {
    const item = document.createElement("option");
    item.value = key;
    item.textContent = option.label;
    modelSelect.appendChild(item);
  }
  modelSelect.value = payload.default_model;
}

record.addEventListener("click", async () => {
  if (recorder?.state === "recording") {
    recorder.stop();
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    status.textContent = "Microphone unavailable";
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordingChunks = [];
    recorder = new MediaRecorder(stream);
    recorder.addEventListener("dataavailable", (event) => recordingChunks.push(event.data));
    recorder.addEventListener("stop", async () => {
      stream.getTracks().forEach((track) => track.stop());
      record.classList.remove("recording");
      record.setAttribute("aria-pressed", "false");
      record.disabled = true;
      recordLabel.textContent = "Transcribing...";
      status.textContent = "Listening complete";
      const blob = new Blob(recordingChunks, { type: recorder.mimeType || "audio/webm" });
      const formData = new FormData();
      formData.append("audio", blob, "recording.webm");
      try {
        const response = await fetch("/api/transcribe", { method: "POST", body: formData });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || "Transcription failed.");
        input.value = payload.text;
        input.focus();
        status.textContent = "Ready to send";
      } catch (error) {
        status.textContent = error.message;
      } finally {
        record.disabled = false;
        recordLabel.textContent = "Speak";
      }
    });
    recorder.start();
    record.classList.add("recording");
    record.setAttribute("aria-pressed", "true");
    recordLabel.textContent = "Stop";
    status.textContent = "Listening...";
  } catch (error) {
    status.textContent = "Microphone permission needed";
  }
});

loadModels().catch(() => { status.textContent = "Models unavailable"; });

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});
