/**
 * Pure text-scan logic for inferring n_layers/head_dim from a Python
 * model-load call (e.g. `AutoModelForCausalLM.from_pretrained("...")`,
 * `mlx_lm.load(...)`). Not an AST parse or a model download — it only reads
 * config kwargs/values already spelled out literally in the source. No
 * `vscode` dependency so it can be unit-tested directly; editor lookup lives
 * in modelInference.ts.
 */
export interface InferredModelShape {
  nLayers?: number;
  headDim?: number;
  source: string;
}

const MODEL_LOAD_PATTERN = /\b(from_pretrained|mlx_lm\s*\.\s*load|AutoModelForCausalLM|AutoConfig)\s*\(/;

const NUM_LAYERS_PATTERN = /\b(?:num_hidden_layers|n_layers|num_layers)\s*=\s*(\d+)/;
const HIDDEN_SIZE_PATTERN = /\bhidden_size\s*=\s*(\d+)/;
const NUM_HEADS_PATTERN = /\b(?:num_attention_heads|n_heads|num_heads)\s*=\s*(\d+)/;
const HEAD_DIM_PATTERN = /\bhead_dim\s*=\s*(\d+)/;

/**
 * Scans the given text for a recognizable model-load call and any nearby
 * config-shaped kwargs. `head_dim` is preferred if present literally;
 * otherwise it's derived from hidden_size / num_attention_heads when both
 * are found.
 */
export function inferModelShapeFromText(text: string): InferredModelShape | undefined {
  if (!MODEL_LOAD_PATTERN.test(text)) {
    return undefined;
  }

  const nLayersMatch = NUM_LAYERS_PATTERN.exec(text);
  const headDimMatch = HEAD_DIM_PATTERN.exec(text);
  const hiddenSizeMatch = HIDDEN_SIZE_PATTERN.exec(text);
  const numHeadsMatch = NUM_HEADS_PATTERN.exec(text);

  const nLayers = nLayersMatch ? Number(nLayersMatch[1]) : undefined;
  let headDim = headDimMatch ? Number(headDimMatch[1]) : undefined;

  if (headDim === undefined && hiddenSizeMatch && numHeadsMatch) {
    const hiddenSize = Number(hiddenSizeMatch[1]);
    const numHeads = Number(numHeadsMatch[1]);
    if (numHeads > 0 && hiddenSize % numHeads === 0) {
      headDim = hiddenSize / numHeads;
    }
  }

  if (nLayers === undefined && headDim === undefined) {
    return undefined;
  }

  return { nLayers, headDim, source: 'active Python file' };
}
