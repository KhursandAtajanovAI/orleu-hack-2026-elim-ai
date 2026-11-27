// Копирует рантайм ONNX (wasm) в public/ort — ИИ распознаёт фото прямо в браузере (без сервера ИИ).
import { cpSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const dist = join(dirname(createRequire(import.meta.url).resolve('onnxruntime-web')), '.');
const out = new URL('../public/ort/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
for (const f of ['ort.wasm.min.js', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) cpSync(join(dist, f), join(out, f));
console.log('ort →', out);
