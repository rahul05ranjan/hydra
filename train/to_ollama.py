import argparse
import subprocess
import sys
import tempfile
from pathlib import Path

def modelfile(merged_dir: Path) -> str:
    return (
        f"FROM {merged_dir}\n"
        "TEMPLATE {{ .Prompt }}\n"
        "PARAMETER temperature 0\n"
        "PARAMETER num_predict 512\n"
        "PARAMETER repeat_penalty 1.1\n"
    )

def main() -> int:
    parser = argparse.ArgumentParser(description="Install fused model into Ollama")
    parser.add_argument("--model-dir", required=True, help="Path to fused model folder")
    parser.add_argument("--name", default="hydra-nano:git", help="Ollama model name")
    parser.add_argument("--bits", default="int8", help="Quantization level (default int8)")
    args = parser.parse_args()

    merged = Path(args.model_dir).resolve()
    if not (merged / "model.safetensors").exists() and not (merged / "model.safetensors.index.json").exists():
        # Check for multiple shards
        shards = list(merged.glob("model-*.safetensors"))
        if not shards:
            sys.exit(f"safetensors missing in {merged}")

    with tempfile.TemporaryDirectory() as folder:
        mf = Path(folder) / "Modelfile"
        mf.write_text(modelfile(merged), encoding="utf-8")
        cmd = ["ollama", "create", args.name, "-f", str(mf), "-q", args.bits]
        print(f"Running: {' '.join(cmd)}")
        res = subprocess.run(cmd)
        if res.returncode != 0:
            sys.exit(f"ollama create failed with exit code {res.returncode}")

    print(f"Successfully installed {args.name} into Ollama!")
    return 0

if __name__ == "__main__":
    sys.exit(main())
