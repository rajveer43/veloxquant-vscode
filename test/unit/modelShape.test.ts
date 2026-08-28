import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inferModelShapeFromText } from '../../src/insert/modelShape';

test('inferModelShapeFromText: returns undefined when no model-load call present', () => {
  const result = inferModelShapeFromText('x = 1 + 1\nprint(x)\n');
  assert.equal(result, undefined);
});

test('inferModelShapeFromText: reads n_layers directly when literal', () => {
  const text = `
model = AutoModelForCausalLM.from_pretrained(
    "some/model",
    num_hidden_layers=32,
)
`;
  const result = inferModelShapeFromText(text);
  assert.ok(result);
  assert.equal(result!.nLayers, 32);
});

test('inferModelShapeFromText: reads head_dim directly when literal', () => {
  const text = `
config = AutoConfig.from_pretrained("some/model", head_dim=128)
`;
  const result = inferModelShapeFromText(text);
  assert.ok(result);
  assert.equal(result!.headDim, 128);
});

test('inferModelShapeFromText: derives head_dim from hidden_size / num_attention_heads', () => {
  const text = `
model, tokenizer = mlx_lm.load(
    "some/model",
    hidden_size=4096,
    num_attention_heads=32,
)
`;
  const result = inferModelShapeFromText(text);
  assert.ok(result);
  assert.equal(result!.headDim, 128);
});

test('inferModelShapeFromText: returns undefined when model call present but no config fields found', () => {
  const text = `model = AutoModelForCausalLM.from_pretrained("some/model")`;
  const result = inferModelShapeFromText(text);
  assert.equal(result, undefined);
});
