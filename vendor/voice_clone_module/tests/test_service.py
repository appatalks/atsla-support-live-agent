from pathlib import Path

import torch

from voice_clone_module import VoiceCloner
from voice_clone_module.service import split_synthesis_text


class FakeModel:
    sr = 24000

    def __init__(self) -> None:
        self.calls = []

    def generate(self, text, **kwargs):
        self.calls.append((text, kwargs))
        return torch.zeros(1, 240)


def test_synthesize_uses_reference_and_keeps_model(tmp_path: Path) -> None:
    reference = tmp_path / "reference.wav"
    reference.touch()
    model = FakeModel()
    cloner = VoiceCloner(reference, device="cpu", model=model)

    waveform = cloner.synthesize("Hello")
    second_waveform = cloner.synthesize("Again")

    assert waveform.shape == (1, 240)
    assert second_waveform.shape == (1, 240)
    assert model.calls[0][1]["audio_prompt_path"] == str(reference)
    assert model.calls[0][1]["exaggeration"] == 0.5
    assert model.calls[0][1]["cfg_weight"] == 0.5


def test_save_creates_parent_directory(tmp_path: Path) -> None:
    reference = tmp_path / "reference.wav"
    reference.touch()
    output = tmp_path / "audio" / "reply.wav"
    cloner = VoiceCloner(reference, device="cpu", model=FakeModel())

    result = cloner.save("Hello", output)

    assert result == output
    assert output.is_file()


def test_long_text_is_split_before_synthesis(tmp_path: Path) -> None:
    reference = tmp_path / "reference.wav"
    reference.touch()
    model = FakeModel()
    cloner = VoiceCloner(reference, device="cpu", model=model)
    text = "First sentence. " + ("word " * 140) + "Final sentence."

    waveform = cloner.synthesize(text)

    assert len(model.calls) == len(split_synthesis_text(text))
    assert all(len(call[0]) <= 600 for call in model.calls)
    assert waveform.shape[-1] == 240 * len(model.calls)
