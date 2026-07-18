#!/usr/bin/env python3
"""Loopback-only AppaTalks voice bridge with persistent greeting prewarming."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import NamedTemporaryFile
from threading import Lock
from typing import Any

MAX_INPUT_CHARS = 12_000


class VoiceService:
    def __init__(self, reference: Path, cache_dir: Path, warm_texts: set[str]) -> None:
        self.reference = reference
        self.cache_dir = cache_dir
        self.warm_texts = warm_texts
        self.engine: Any | None = None
        self.load_error: str | None = None
        self.lock = Lock()

    def health(self) -> dict[str, object]:
        try:
            from voice_clone_module import VoiceCloner  # noqa: F401
            backend_available = True
        except Exception as error:
            backend_available = False
            self.load_error = str(error)
        return {
            "ok": True,
            "engine_loaded": self.engine is not None,
            "backend_available": backend_available,
            "reference_readable": self.reference.is_file(),
            "reference_path": str(self.reference),
            "load_error": self.load_error,
            "expression_controls": ["exaggeration", "cfg_weight"],
            "greeting_cache_entries": len(list(self.cache_dir.glob("*.wav"))),
        }

    def warm(self, text: str, exaggeration: float, cfg_weight: float) -> None:
        self.warm_texts.add(text)
        self.synthesize(text, exaggeration, cfg_weight)

    def synthesize(self, text: str, exaggeration: float, cfg_weight: float) -> bytes:
        if not text.strip():
            raise ValueError("input must not be empty")
        if len(text) > MAX_INPUT_CHARS:
            raise ValueError(f"input must be {MAX_INPUT_CHARS} characters or fewer")
        if not self.reference.is_file():
            raise RuntimeError("the configured voice reference is unavailable")
        with self.lock:
            cache_path = self.cache_path(text, exaggeration, cfg_weight) if text in self.warm_texts else None
            if cache_path and cache_path.is_file():
                return cache_path.read_bytes()
            if self.engine is None:
                from voice_clone_module import VoiceCloner
                self.engine = VoiceCloner(
                    reference_audio=self.reference,
                    device=os.getenv("VOICE_CLONE_DEVICE", "auto"),
                    exaggeration=exaggeration,
                    cfg_weight=cfg_weight,
                )
            with NamedTemporaryFile(suffix=".wav", delete=False) as output:
                output_path = Path(output.name)
            try:
                self.engine.save(text, output_path, exaggeration=exaggeration, cfg_weight=cfg_weight)
                audio = output_path.read_bytes()
                if cache_path:
                    self.cache_dir.mkdir(parents=True, exist_ok=True)
                    cache_path.write_bytes(audio)
                return audio
            finally:
                output_path.unlink(missing_ok=True)

    def cache_path(self, text: str, exaggeration: float, cfg_weight: float) -> Path:
        reference_state = self.reference.stat()
        key = json.dumps({
            "text": text,
            "exaggeration": exaggeration,
            "cfg_weight": cfg_weight,
            "reference": str(self.reference),
            "reference_size": reference_state.st_size,
            "reference_mtime_ns": reference_state.st_mtime_ns,
        }, sort_keys=True).encode()
        return self.cache_dir / f"{hashlib.sha256(key).hexdigest()}.wav"


class Handler(BaseHTTPRequestHandler):
    service: VoiceService

    def send_json(self, status: HTTPStatus, body: dict[str, object]) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/") != "/health":
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        self.send_json(HTTPStatus.OK, self.service.health())

    def do_POST(self) -> None:  # noqa: N802
        if self.path.rstrip("/") != "/v1/speech":
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length))
            text = payload.get("input")
            if not isinstance(text, str):
                raise ValueError("request must contain string input")
            exaggeration = max(0.0, min(1.0, float(payload.get("exaggeration", 0.5))))
            cfg_weight = max(0.0, min(1.0, float(payload.get("cfg_weight", 0.5))))
            audio = self.service.synthesize(text, exaggeration, cfg_weight)
        except ValueError as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        except Exception as error:
            self.send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)})
            return
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(audio)))
        self.end_headers()
        self.wfile.write(audio)

    def log_message(self, format: str, *args: object) -> None:
        return


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8090)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--cache-dir", type=Path, default=Path.home() / ".cache" / "atsla" / "greetings")
    parser.add_argument("--warm-text", default="")
    parser.add_argument("--warm-exaggeration", type=float, default=0.65)
    parser.add_argument("--warm-cfg-weight", type=float, default=0.35)
    args = parser.parse_args()
    handler = type("VoiceHandler", (Handler,), {})
    handler.service = VoiceService(args.reference.expanduser().resolve(), args.cache_dir.expanduser().resolve(), set())
    if args.warm_text:
        try:
            handler.service.warm(args.warm_text, args.warm_exaggeration, args.warm_cfg_weight)
            print("AppaTalks Standard Greeting cache ready", flush=True)
        except Exception as error:
            print(f"AppaTalks Standard Greeting cache unavailable: {error}", flush=True)
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"AppaTalks TTS listening on http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
