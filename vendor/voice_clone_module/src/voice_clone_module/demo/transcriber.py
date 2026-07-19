from pathlib import Path
from typing import Any

from ..service import choose_device


class LocalTranscriber:
    """Lazy local speech-to-text service backed by faster-whisper."""

    def __init__(
        self,
        model_id: str = "Systran/faster-whisper-small.en",
        *,
        device: str = "auto",
    ) -> None:
        self.model_id = model_id
        self.device = choose_device(device)
        self.compute_type = "float16" if self.device == "cuda" else "int8"
        self._model: Any | None = None

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def _load(self) -> None:
        if self._model is None:
            from faster_whisper import WhisperModel

            self._model = WhisperModel(
                self.model_id,
                device=self.device,
                compute_type=self.compute_type,
            )

    def transcribe(self, audio_path: str | Path) -> str:
        self._load()
        segments, _info = self._model.transcribe(
            str(audio_path),
            beam_size=5,
            vad_filter=True,
        )
        text = " ".join(segment.text.strip() for segment in segments).strip()
        return text