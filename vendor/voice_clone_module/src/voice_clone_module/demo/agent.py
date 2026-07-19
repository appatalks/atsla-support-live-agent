from dataclasses import dataclass
from typing import Any

import torch

from ..service import choose_device


CHAT_MODELS = {
    "qwen3-0.6b": {
        "label": "Qwen3 0.6B - fastest",
        "model_id": "Qwen/Qwen3-0.6B",
    },
    "smollm2-1.7b": {
        "label": "SmolLM2 1.7B - balanced",
        "model_id": "HuggingFaceTB/SmolLM2-1.7B-Instruct",
    },
    "qwen2.5-1.5b": {
        "label": "Qwen2.5 1.5B - capable",
        "model_id": "Qwen/Qwen2.5-1.5B-Instruct",
    },
    "qwen2.5-7b": {
        "label": "Qwen2.5 7B - advanced (4-bit)",
        "model_id": "Qwen/Qwen2.5-7B-Instruct",
        "quantize_4bit": True,
    },
    "qwen3-8b": {
        "label": "Qwen3 8B - highest quality (4-bit)",
        "model_id": "Qwen/Qwen3-8B",
        "quantize_4bit": True,
    },
    "qwen2.5-72b": {
        "label": "Qwen2.5 72B - near frontier",
        "model_id": "Qwen/Qwen2.5-72B-Instruct",
    },
}
DEFAULT_MODEL_KEY = "qwen2.5-1.5b"


@dataclass(frozen=True)
class ChatAgentConfig:
    model_id: str = "Qwen/Qwen2.5-1.5B-Instruct"
    device: str = "auto"
    max_new_tokens: int = 160
    temperature: float = 0.7
    top_p: float = 0.9
    quantize_4bit: bool = False
    system_prompt: str = (
        "You are a concise, helpful local AI assistant. "
        "Answer naturally and do not mention that you are a small model."
    )


class LocalChatAgent:
    """A small Hugging Face chat model kept in memory between requests."""

    def __init__(self, config: ChatAgentConfig | None = None) -> None:
        self.config = config or ChatAgentConfig()
        self.device = choose_device(self.config.device)
        self._tokenizer: Any | None = None
        self._model: Any | None = None

    @property
    def loaded(self) -> bool:
        return self._model is not None and self._tokenizer is not None

    def _load(self) -> None:
        if self.loaded:
            return

        from transformers import AutoModelForCausalLM, AutoTokenizer

        dtype = torch.bfloat16 if self.device == "cuda" else torch.float32
        self._tokenizer = AutoTokenizer.from_pretrained(self.config.model_id)
        load_kwargs: dict[str, Any] = {"torch_dtype": dtype}
        if self.config.quantize_4bit and self.device == "cuda":
            from transformers import BitsAndBytesConfig

            load_kwargs.update(
                {
                    "device_map": {"": self.device},
                    "quantization_config": BitsAndBytesConfig(
                        load_in_4bit=True,
                        bnb_4bit_compute_dtype=torch.bfloat16,
                        bnb_4bit_quant_type="nf4",
                        bnb_4bit_use_double_quant=True,
                    ),
                }
            )

        self._model = AutoModelForCausalLM.from_pretrained(self.config.model_id, **load_kwargs)
        if not self.config.quantize_4bit or self.device != "cuda":
            self._model.to(self.device)
        self._model.eval()

    def respond(self, messages: list[dict[str, str]]) -> str:
        """Return an assistant response for an OpenAI-style message list."""
        self._load()
        assert self._model is not None
        assert self._tokenizer is not None

        conversation = [
            {"role": "system", "content": self.config.system_prompt},
            *messages[-12:],
        ]
        try:
            prompt = self._tokenizer.apply_chat_template(
                conversation,
                tokenize=False,
                add_generation_prompt=True,
                enable_thinking=False,
            )
        except TypeError:
            prompt = self._tokenizer.apply_chat_template(
                conversation,
                tokenize=False,
                add_generation_prompt=True,
            )

        inputs = self._tokenizer(prompt, return_tensors="pt").to(self.device)
        with torch.inference_mode():
            output = self._model.generate(
                **inputs,
                max_new_tokens=self.config.max_new_tokens,
                do_sample=True,
                temperature=self.config.temperature,
                top_p=self.config.top_p,
                pad_token_id=self._tokenizer.eos_token_id,
            )

        prompt_length = inputs["input_ids"].shape[-1]
        response = self._tokenizer.decode(
            output[0][prompt_length:],
            skip_special_tokens=True,
        ).strip()
        return response or "I was not able to form a response."
