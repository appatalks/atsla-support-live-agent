import os
import tempfile
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from ..service import VoiceCloner
from .agent import CHAT_MODELS, DEFAULT_MODEL_KEY, ChatAgentConfig, LocalChatAgent
from .transcriber import LocalTranscriber


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
DEFAULT_OUTPUT_DIR = Path(os.getenv("VOICE_DEMO_OUTPUT_DIR", "output/demo"))


class ChatTurn(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=1, max_length=4000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    history: list[ChatTurn] = Field(default_factory=list)
    model_key: str = DEFAULT_MODEL_KEY


def create_app(
    *,
    reference_audio: str | Path | None = None,
    model_id: str | None = None,
    device: str = "auto",
    output_dir: str | Path = DEFAULT_OUTPUT_DIR,
) -> FastAPI:
    """Create the demo app with one cached language model and voice model."""
    resolved_reference = reference_audio or os.getenv("VOICE_CLONE_REFERENCE")
    configured_model_id = model_id or os.getenv("VOICE_DEMO_MODEL")
    if configured_model_id:
        configured_key = next(
            (key for key, option in CHAT_MODELS.items() if option["model_id"] == configured_model_id),
            DEFAULT_MODEL_KEY,
        )
    else:
        configured_key = os.getenv("VOICE_DEMO_MODEL_KEY", DEFAULT_MODEL_KEY)
    if configured_key not in CHAT_MODELS:
        configured_key = DEFAULT_MODEL_KEY
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    agents: dict[str, LocalChatAgent] = {}
    voice = VoiceCloner(resolved_reference, device=device) if resolved_reference else None
    transcriber = LocalTranscriber(
        os.getenv("VOICE_TRANSCRIBE_MODEL", "Systran/faster-whisper-small.en"),
        device=device,
    )
    app = FastAPI(title="Voice Clone Agent")
    app.state.agents = agents
    app.state.voice = voice
    app.state.transcriber = transcriber
    app.state.output_dir = output_path

    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
    app.mount("/audio", StaticFiles(directory=output_path), name="audio")

    @app.get("/", response_class=FileResponse)
    async def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    @app.get("/api/health")
    async def health() -> dict[str, object]:
        loaded_models = [key for key, agent in agents.items() if agent.loaded]
        return {
            "ok": True,
            "llm_loaded": bool(loaded_models),
            "voice_configured": voice is not None,
            "transcriber_loaded": transcriber.loaded,
            "device": device,
            "model_options": CHAT_MODELS,
            "default_model": configured_key,
            "loaded_models": loaded_models,
        }

    @app.get("/api/models")
    async def models() -> dict[str, object]:
        return {"models": CHAT_MODELS, "default_model": configured_key}

    @app.post("/api/chat")
    def chat(request: ChatRequest) -> dict[str, str]:
        if voice is None:
            raise HTTPException(
                status_code=503,
                detail="Set VOICE_CLONE_REFERENCE to a reference audio file before chatting.",
            )

        if request.model_key not in CHAT_MODELS:
            raise HTTPException(status_code=400, detail="Unknown local chat model.")

        agent = agents.setdefault(
            request.model_key,
            LocalChatAgent(
                ChatAgentConfig(
                    model_id=CHAT_MODELS[request.model_key]["model_id"],
                    device=device,
                    quantize_4bit=CHAT_MODELS[request.model_key].get("quantize_4bit", False),
                )
            ),
        )
        messages = [turn.model_dump() for turn in request.history]
        messages.append({"role": "user", "content": request.message})
        try:
            reply = agent.respond(messages)
            filename = f"{uuid4().hex}.wav"
            voice.save(reply, output_path / filename)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        return {"reply": reply, "audio_url": f"/audio/{filename}"}

    @app.post("/api/transcribe")
    def transcribe(audio: UploadFile = File(...)) -> dict[str, str]:
        if not audio.content_type or not audio.content_type.startswith("audio/"):
            raise HTTPException(status_code=415, detail="Upload an audio recording.")

        suffix = Path(audio.filename or "recording.webm").suffix or ".webm"
        with tempfile.NamedTemporaryFile(suffix=suffix) as temporary:
            data = audio.file.read()
            if not data:
                raise HTTPException(status_code=400, detail="The audio recording is empty.")
            if len(data) > 25 * 1024 * 1024:
                raise HTTPException(status_code=413, detail="The audio recording is too large.")
            temporary.write(data)
            temporary.flush()
            try:
                text = transcriber.transcribe(temporary.name)
            except Exception as exc:
                raise HTTPException(status_code=500, detail=str(exc)) from exc

        if not text:
            raise HTTPException(status_code=422, detail="No speech was detected.")
        return {"text": text}

    return app


def run() -> None:
    import uvicorn

    host = os.getenv("VOICE_DEMO_HOST", "127.0.0.1")
    port = int(os.getenv("VOICE_DEMO_PORT", "8000"))
    uvicorn.run(create_app(device=os.getenv("VOICE_CLONE_DEVICE", "auto")), host=host, port=port)


if __name__ == "__main__":
    run()
