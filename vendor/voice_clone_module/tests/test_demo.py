from fastapi.testclient import TestClient

from voice_clone_module.demo.server import create_app


def test_demo_exposes_local_models_without_loading_weights(tmp_path) -> None:
    app = create_app(
        reference_audio=tmp_path / "reference.wav",
        device="cpu",
        output_dir=tmp_path / "output",
    )
    client = TestClient(app)

    health = client.get("/api/health")
    models = client.get("/api/models")
    invalid_upload = client.post(
        "/api/transcribe",
        files={"audio": ("note.txt", b"not audio", "text/plain")},
    )

    assert health.status_code == 200
    assert health.json()["llm_loaded"] is False
    assert health.json()["transcriber_loaded"] is False
    assert len(models.json()["models"]) == 6
    assert models.json()["default_model"] == "qwen2.5-1.5b"
    assert models.json()["models"]["qwen2.5-7b"]["model_id"] == "Qwen/Qwen2.5-7B-Instruct"
    assert models.json()["models"]["qwen2.5-7b"]["quantize_4bit"] is True
    assert models.json()["models"]["qwen3-8b"]["model_id"] == "Qwen/Qwen3-8B"
    assert models.json()["models"]["qwen3-8b"]["quantize_4bit"] is True
    assert models.json()["models"]["qwen2.5-72b"]["model_id"] == "Qwen/Qwen2.5-72B-Instruct"
    assert invalid_upload.status_code == 415