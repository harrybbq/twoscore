import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ModelCard, ModelJson } from '@/lib/scoring/model';

export interface LoadedModels {
  a: ModelJson;
  b: ModelJson;
  card: ModelCard;
}

let cached: LoadedModels | null = null;

const MODEL_DIR = path.join(process.cwd(), 'models');

/**
 * Load the fitted coefficients.  Returns null rather than throwing when the
 * models have not been fitted yet, so every page can render a "not fitted"
 * state instead of a stack trace.
 */
export async function loadModels(): Promise<LoadedModels | null> {
  if (cached) return cached;
  try {
    const [a, b, card] = await Promise.all([
      readFile(path.join(MODEL_DIR, 'model_a.json'), 'utf8'),
      readFile(path.join(MODEL_DIR, 'model_b.json'), 'utf8'),
      readFile(path.join(MODEL_DIR, 'model_card.json'), 'utf8'),
    ]);
    cached = { a: JSON.parse(a), b: JSON.parse(b), card: JSON.parse(card) };
    return cached;
  } catch {
    return null;
  }
}

export function clearModelCache() {
  cached = null;
}
