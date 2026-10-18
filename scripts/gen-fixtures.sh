#!/usr/bin/env bash
# Capture the veloxquant-mlx CLI JSON the extension parses.
# Usage: scripts/gen-fixtures.sh [X.Y.Z]   (default: latest on PyPI)
# Output: test/fixtures/veloxquant-X.Y.Z/*.json
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
spec="veloxquant-mlx${1:+==$1}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

python3 -m venv "$work/venv"
"$work/venv/bin/pip" install -q "$spec"
version="$("$work/venv/bin/python" -c 'import importlib.metadata as m; print(m.version("veloxquant-mlx"))')"
out="$root/test/fixtures/veloxquant-$version"
mkdir -p "$out"

# A small, fixed Llama-style config keeps the planner outputs deterministic.
cat > "$work/config.json" <<'JSON'
{"architectures":["LlamaForCausalLM"],"num_hidden_layers":32,"num_attention_heads":32,"num_key_value_heads":8,"hidden_size":4096,"max_position_embeddings":8192}
JSON

vq() { "$work/venv/bin/python" -m veloxquant_mlx "$@"; }

vq methods --json > "$out/methods.json"
vq recommend --chip M4 --ram-gb 32 --model-class 7B --goal everyday --json > "$out/recommend-legacy.json"
vq recommend --auto --no-probe --json --model-config "$work/config.json" > "$out/recommend-auto.json"
vq recommend --dump-ruleset --json > "$out/ruleset.json"
vq estimate-memory --json --model-config "$work/config.json" > "$out/estimate-memory.json"
vq auto-config --json --head-dim 128 --seq-len 8192 --n-layers 32 --batch-size 1 --n-kv-heads 8 > "$out/auto-config.json"
# Host-specific values (chip, memory, bandwidth) are scrubbed so the fixture only drifts with the schema.
vq profile-hardware --json > "$out/profile-hardware.json"

echo "wrote $out"
