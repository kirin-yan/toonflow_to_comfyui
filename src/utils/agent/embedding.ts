import * as ONNX_WEB from "onnxruntime-web";
import { pipeline, env as transformersEnv, FeatureExtractionPipeline } from "@huggingface/transformers";
import path from "path";
import fs from "fs";
import getPath from "@/utils/getPath";
import db from "@/utils/db";

// ── 模型配置 ──
// const modelOnnxFile = ["all-MiniLM-L6-v2", "onnx", "model_fp16.onnx"]; // 模型文件路径
// const modelDtype = "fp16" as const; // 量化类型：fp32
let extractor: FeatureExtractionPipeline | null = null;
let embeddingUnavailableReason: string | null = null;
let initializationAttempt: Promise<void> | null = null;

function fallbackEmbedding(text: string, dimensions = 384): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const normalized = text.normalize("NFKC").toLowerCase();
  const tokens = [...normalized, ...Array.from({ length: Math.max(0, normalized.length - 1) }, (_, index) => normalized.slice(index, index + 2))];
  for (const token of tokens) {
    let hash = 2166136261;
    for (const char of token) {
      hash ^= char.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 16777619);
    }
    vector[(hash >>> 0) % dimensions] += 1;
  }
  const norm = Math.hypot(...vector);
  return norm > 0 ? vector.map((value) => value / norm) : vector;
}

export async function initEmbedding(): Promise<void> {
  if (extractor) return;

  const modelConfigData = await db("o_setting").whereIn("key", ["modelOnnxFile", "modelDtype"]);
  const modelObj: Record<string, string> = {};
  modelConfigData.forEach((item) => {
    if (item.key && item.value) modelObj[item.key] = item.value;
  });
  const modelOnnxFile = modelObj.modelOnnxFile
    ? JSON.parse(modelObj.modelOnnxFile)
    : ["all-MiniLM-L6-v2", "onnx", "model_fp16.onnx"]; // 模型文件路径
  const modelDtype = modelObj.modelDtype ?? ("fp16" as const); // 量化类型：fp32
  const onnxPath = path.join(getPath("models"), ...modelOnnxFile);
  if (!fs.existsSync(onnxPath)) {
    throw new Error(`Embedding 模型文件不存在: ${onnxPath}`);
  }

  transformersEnv.allowRemoteModels = false;
  transformersEnv.allowLocalModels = true;
  transformersEnv.localModelPath = getPath("models").replace(/\\/g, "/") + "/";

  const modelFolder = modelOnnxFile[0];
  // @ts-ignore - pipeline 重载联合类型过于复杂
  extractor = await pipeline("feature-extraction", modelFolder, { dtype: modelDtype });
}

export async function getEmbedding(text: string): Promise<number[]> {
  if (!extractor && !embeddingUnavailableReason) {
    initializationAttempt ??= initEmbedding();
    try {
      await initializationAttempt;
    } catch (error) {
      if (!embeddingUnavailableReason) {
        embeddingUnavailableReason = error instanceof Error ? error.message : String(error);
        console.warn(`[Embedding] ${embeddingUnavailableReason}，已切换到本地词法向量降级模式`);
      }
    }
  }
  if (!extractor) return fallbackEmbedding(text);
  const output = await extractor!(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;
  let dot = 0;
  for (let index = 0; index < length; index++) dot += a[index] * b[index];
  return Number.isFinite(dot) ? dot : 0;
}

export async function disposeEmbedding(): Promise<void> {
  await extractor?.dispose?.();
  extractor = null;
  embeddingUnavailableReason = null;
  initializationAttempt = null;
}
