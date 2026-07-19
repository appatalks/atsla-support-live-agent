import argparse
import os
from pathlib import Path

from .service import VoiceCloner


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate speech using a reference voice.")
    parser.add_argument("text", help="Text to synthesize.")
    parser.add_argument(
        "--reference",
        type=Path,
        default=os.getenv("VOICE_CLONE_REFERENCE"),
        help="Reference audio path, or VOICE_CLONE_REFERENCE.",
    )
    parser.add_argument("-o", "--output", type=Path, default=Path("cloned-voice.wav"))
    parser.add_argument("--device", default=os.getenv("VOICE_CLONE_DEVICE", "auto"))
    parser.add_argument(
        "--exaggeration",
        type=float,
        default=float(os.getenv("VOICE_CLONE_EXAGGERATION", "0.5")),
    )
    parser.add_argument(
        "--cfg-weight",
        type=float,
        default=float(os.getenv("VOICE_CLONE_CFG_WEIGHT", "0.5")),
    )
    args = parser.parse_args()

    if args.reference is None:
        parser.error("--reference or VOICE_CLONE_REFERENCE is required")

    cloner = VoiceCloner(
        reference_audio=args.reference,
        device=args.device,
        exaggeration=args.exaggeration,
        cfg_weight=args.cfg_weight,
    )
    output = cloner.save(args.text, args.output)
    print(f"Wrote {output}")


if __name__ == "__main__":
    main()
