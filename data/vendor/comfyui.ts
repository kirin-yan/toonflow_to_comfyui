/**
 * ComfyUI vendor for Toonflow.
 * Export a workflow from ComfyUI with "File -> Export (API)" and paste the JSON
 * or an HTTP URL to the JSON into the workflow fields below.
 */

type VideoMode =
  | "singleImage"
  | "startEndRequired"
  | "endFrameOptional"
  | "startFrameOptional"
  | "text"
  | (`videoReference:${number}` | `imageReference:${number}` | `audioReference:${number}`)[];

interface TextModel {
  name: string;
  modelName: string;
  type: "text";
  think: boolean;
}

interface ImageModel {
  name: string;
  modelName: string;
  type: "image";
  mode: ("text" | "singleImage" | "multiReference")[];
  associationSkills?: string;
}

interface VideoModel {
  name: string;
  modelName: string;
  type: "video";
  mode: VideoMode[];
  associationSkills?: string;
  audio: "optional" | false | true;
  durationResolutionMap: { duration: number[]; resolution: string[] }[];
}

interface TTSModel {
  name: string;
  modelName: string;
  type: "tts";
  voices: { title: string; voice: string }[];
}

interface VendorConfig {
  id: string;
  version: string;
  name: string;
  author: string;
  description?: string;
  icon?: string;
  inputs: { key: string; label: string; type: "text" | "password" | "url"; required: boolean; placeholder?: string }[];
  inputValues: Record<string, string>;
  models: (TextModel | ImageModel | VideoModel | TTSModel)[];
}

type ReferenceList =
  | { type: "image"; sourceType: "base64"; base64: string }
  | { type: "audio"; sourceType: "base64"; base64: string }
  | { type: "video"; sourceType: "base64"; base64: string };

interface ImageConfig {
  prompt: string;
  referenceList?: Extract<ReferenceList, { type: "image" }>[];
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
}

interface VideoConfig {
  duration: number;
  resolution: string;
  aspectRatio: "16:9" | "9:16";
  prompt: string;
  referenceList?: ReferenceList[];
  audio?: boolean;
  mode: VideoMode[] | VideoMode | string;
}

interface TTSConfig {
  text: string;
  voice: string;
  speechRate: number;
  pitchRate: number;
  volume: number;
  referenceList?: Extract<ReferenceList, { type: "audio" }>[];
}

interface PollResult {
  completed: boolean;
  data?: string;
  error?: string;
}

declare const axios: any;
declare const FormData: any;
declare const Buffer: any;
declare const logger: (msg: string) => void;
declare const urlToBase64: (url: string) => Promise<string>;
declare const pollTask: (fn: () => Promise<PollResult>, interval?: number, timeout?: number) => Promise<PollResult>;
declare const exports: {
  vendor: VendorConfig;
  textRequest: (m: TextModel, t: boolean, tl: 0 | 1 | 2 | 3) => any;
  imageRequest: (c: ImageConfig, m: ImageModel) => Promise<string>;
  videoRequest: (c: VideoConfig, m: VideoModel) => Promise<string>;
  ttsRequest: (c: TTSConfig, m: TTSModel) => Promise<string>;
  checkForUpdates?: () => Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }>;
  updateVendor?: () => Promise<string>;
};

const vendor: VendorConfig = {
  id: "comfyui",
  version: "2.1",
  author: "Toonflow",
  name: "ComfyUI",
  description: [
    "Use ComfyUI as a Toonflow image/video backend.",
    "Provide a ComfyUI API workflow JSON or an HTTP URL for each workflow field.",
    "Supported placeholders include {{prompt}}, {{styledPrompt}}, {{negativePrompt}}, {{animeNegativePrompt}}, {{width}}, {{height}}, {{seed}}, {{filenamePrefix}}, {{image1}}, {{image2}}, {{image3}}, {{startImage}}, {{endImage}}, {{duration}}, {{fps}}, {{frames}}, {{resolution}}, {{aspectRatio}}.",
  ].join("\n\n"),
  inputs: [
    { key: "baseUrl", label: "ComfyUI base URL", type: "url", required: true, placeholder: "http://127.0.0.1:8188" },
    { key: "imageTextWorkflow", label: "Image text workflow", type: "text", required: false, placeholder: "Workflow JSON or http(s) URL" },
    {
      key: "imageSingleReferenceWorkflow",
      label: "Image single-reference workflow",
      type: "text",
      required: false,
      placeholder: "Workflow JSON or http(s) URL",
    },
    {
      key: "imageMultiReferenceWorkflow",
      label: "Image multi-reference workflow",
      type: "text",
      required: false,
      placeholder: "Workflow JSON or http(s) URL",
    },
    {
      key: "imageReferenceWorkflow",
      label: "Image reference workflow (fallback)",
      type: "text",
      required: false,
      placeholder: "Workflow JSON or http(s) URL",
    },
    { key: "videoTextWorkflow", label: "Video text workflow", type: "text", required: false, placeholder: "Workflow JSON or http(s) URL" },
    {
      key: "videoReferenceWorkflow",
      label: "Video reference workflow",
      type: "text",
      required: false,
      placeholder: "Workflow JSON or http(s) URL",
    },
    {
      key: "animePositivePrefix",
      label: "Anime positive prefix",
      type: "text",
      required: false,
      placeholder: "anime style, clean lineart, cel shading, expressive characters",
    },
    {
      key: "animeNegativePrompt",
      label: "Anime negative prompt",
      type: "text",
      required: false,
      placeholder: "photorealistic, blurry, low quality, distorted anatomy",
    },
    { key: "negativePrompt", label: "Default negative prompt", type: "text", required: false },
    { key: "textImageSteps", label: "Text-image steps", type: "text", required: false, placeholder: "8" },
    { key: "textImageCfg", label: "Text-image CFG", type: "text", required: false, placeholder: "1.2" },
    { key: "imageEditLoraStrength", label: "Image edit LoRA strength", type: "text", required: false, placeholder: "1.0" },
    { key: "videoImageCompression", label: "Video image compression", type: "text", required: false, placeholder: "14" },
    { key: "videoDecodeOverlap", label: "Video decode overlap", type: "text", required: false, placeholder: "96" },
    { key: "videoDecodeTemporalOverlap", label: "Video temporal overlap", type: "text", required: false, placeholder: "8" },
    { key: "videoTextFps", label: "Video text FPS", type: "text", required: false, placeholder: "24" },
    { key: "videoReferenceFps", label: "Video reference FPS", type: "text", required: false, placeholder: "25" },
    { key: "videoFps", label: "Legacy video FPS", type: "text", required: false, placeholder: "24" },
    { key: "pollIntervalMs", label: "Poll interval ms", type: "text", required: false, placeholder: "3000" },
    { key: "timeoutMs", label: "Timeout ms", type: "text", required: false, placeholder: "1800000" },
  ],
  inputValues: {
    baseUrl: "http://127.0.0.1:8188",
    imageTextWorkflow: "",
    imageSingleReferenceWorkflow: "",
    imageMultiReferenceWorkflow: "",
    imageReferenceWorkflow: "",
    videoTextWorkflow: "",
    videoReferenceWorkflow: "",
    animePositivePrefix: "anime style, manga aesthetic, clean lineart, cel shading, expressive characters, cinematic composition",
    animeNegativePrompt:
      "photorealistic, realistic skin, 3d render, blurry, low detail, low quality, ugly, distorted anatomy, extra fingers, bad hands, messy background",
    negativePrompt:
      "photorealistic, realistic skin, 3d render, blurry, low detail, low quality, ugly, distorted anatomy, extra fingers, bad hands, messy background",
    textImageSteps: "8",
    textImageCfg: "1.2",
    imageEditLoraStrength: "1.0",
    videoImageCompression: "14",
    videoDecodeOverlap: "96",
    videoDecodeTemporalOverlap: "8",
    videoTextFps: "24",
    videoReferenceFps: "25",
    videoFps: "24",
    pollIntervalMs: "3000",
    timeoutMs: "1800000",
  },
  models: [
    {
      name: "ComfyUI Image Workflow",
      modelName: "comfyui-image",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
    },
    {
      name: "ComfyUI Video Workflow",
      modelName: "comfyui-video",
      type: "video",
      mode: ["text", "singleImage", "startFrameOptional", "startEndRequired", ["imageReference:9"]],
      audio: false,
      durationResolutionMap: [
        {
          duration: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
          resolution: ["480p", "720p", "1080p"],
        },
      ],
    },
  ],
};

const mimeToExtension: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-msvideo": "avi",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
};

const fallbackMimeByType: Record<ReferenceList["type"], string> = {
  image: "image/png",
  video: "video/mp4",
  audio: "audio/mpeg",
};

const getBaseUrl = () => (vendor.inputValues.baseUrl || "http://127.0.0.1:8188").replace(/\/+$/, "");

const parseInteger = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseFloat(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : fallback;
};

const pickText = (...values: Array<string | undefined>) => {
  for (const value of values) {
    const trimmed = String(value ?? "").trim();
    if (trimmed) return trimmed;
  }
  return "";
};

const joinPrompt = (...parts: Array<string | undefined>) =>
  parts
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .join(", ");

const nextSeed = () => Math.floor(Math.random() * 2147483647);

const roundToMultiple = (value: number, step = 64) => {
  return Math.max(step, Math.round(value / step) * step);
};

const parseAspectRatio = (aspectRatio: `${number}:${number}` | string) => {
  const parts = String(aspectRatio || "1:1")
    .split(":")
    .map((item) => Number(item));
  const widthRatio = Number.isFinite(parts[0]) && parts[0] > 0 ? parts[0] : 1;
  const heightRatio = Number.isFinite(parts[1]) && parts[1] > 0 ? parts[1] : 1;
  return { widthRatio, heightRatio };
};

const getImageDimensions = (size: ImageConfig["size"], aspectRatio: ImageConfig["aspectRatio"]) => {
  const totalPixels = size === "4K" ? 4096 * 4096 : size === "2K" ? 2048 * 2048 : 1024 * 1024;
  const { widthRatio, heightRatio } = parseAspectRatio(aspectRatio);
  const ratio = widthRatio / heightRatio;
  const width = roundToMultiple(Math.sqrt(totalPixels * ratio));
  const height = roundToMultiple(Math.sqrt(totalPixels / ratio));
  return { width, height };
};

const getVideoDimensions = (resolution: string, aspectRatio: VideoConfig["aspectRatio"]) => {
  const preset = resolution === "1080p" ? 1080 : resolution === "480p" ? 480 : 720;
  if (aspectRatio === "9:16") {
    return {
      width: preset === 1080 ? 608 : preset === 480 ? 288 : 416,
      height: preset === 1080 ? 1080 : preset === 480 ? 480 : 720,
    };
  }
  return {
    width: preset === 1080 ? 1920 : preset === 480 ? 854 : 1280,
    height: preset,
  };
};

const parseWorkflowValue = async (label: string, rawValue: string) => {
  const value = String(rawValue || "").trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) {
    const response = await axios.get(value);
    let payload = response?.data;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch (error: any) {
        throw new Error(`${label} URL did not return valid JSON: ${error?.message || "parse failed"}`);
      }
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error(`${label} must resolve to a ComfyUI API workflow JSON object`);
    }
    return payload;
  }
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("workflow is not an object");
    }
    return parsed;
  } catch (error: any) {
    throw new Error(`${label} must be a JSON object or an http(s) URL: ${error?.message || "parse failed"}`);
  }
};

const getWorkflow = async (kind: "image" | "video", useReferenceWorkflow: boolean, referenceCount = 0) => {
  const textKey = kind === "image" ? "imageTextWorkflow" : "videoTextWorkflow";
  const fallback = useReferenceWorkflow ? vendor.inputValues[textKey] : "";
  const candidates = !useReferenceWorkflow
    ? [{ label: `${kind} text workflow`, value: vendor.inputValues[textKey] }]
    : kind === "image"
      ? referenceCount > 1
        ? [
            { label: "image multi-reference workflow", value: vendor.inputValues.imageMultiReferenceWorkflow },
            { label: "image reference workflow", value: vendor.inputValues.imageReferenceWorkflow },
          ]
        : [
            { label: "image single-reference workflow", value: vendor.inputValues.imageSingleReferenceWorkflow },
            { label: "image reference workflow", value: vendor.inputValues.imageReferenceWorkflow },
            { label: "image multi-reference workflow", value: vendor.inputValues.imageMultiReferenceWorkflow },
          ]
      : [{ label: `${kind} reference workflow`, value: vendor.inputValues.videoReferenceWorkflow }];

  let workflow = null;
  for (const candidate of candidates) {
    workflow = await parseWorkflowValue(candidate.label, candidate.value || "");
    if (workflow) break;
  }
  if (!workflow && fallback) {
    workflow = await parseWorkflowValue(`${kind} text workflow`, fallback);
  }
  if (!workflow) {
    throw new Error(`Missing ${kind} ${useReferenceWorkflow ? "reference" : "text"} workflow`);
  }
  return workflow;
};

const parseBase64Payload = (value: string, fileType: ReferenceList["type"]) => {
  const trimmed = String(value || "").trim();
  const match = trimmed.match(/^data:([^;]+);base64,(.+)$/);
  const mime = match?.[1] || fallbackMimeByType[fileType];
  const data = (match?.[2] || trimmed).replace(/\s+/g, "");
  const extension = mimeToExtension[mime] || mime.split("/")[1] || "bin";
  return { mime, data, extension };
};

const uploadReference = async (base64: string, fileType: ReferenceList["type"], index: number) => {
  const { mime, data, extension } = parseBase64Payload(base64, fileType);
  const form = new FormData();
  form.append("image", Buffer.from(data, "base64"), {
    filename: `toonflow-${Date.now()}-${index}.${extension}`,
    contentType: mime,
  });
  form.append("type", "input");
  form.append("overwrite", "1");
  const response = await axios.post(`${getBaseUrl()}/upload/image`, form, {
    headers: form.getHeaders ? form.getHeaders() : {},
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
  if (!response?.data?.name) {
    throw new Error(`ComfyUI upload failed for ${fileType} reference ${index}`);
  }
  return {
    filename: response.data.name,
    subfolder: response.data.subfolder || "",
    type: response.data.type || "input",
  };
};

const normalizeMode = (mode: VideoConfig["mode"]) => {
  if (Array.isArray(mode)) return mode;
  if (typeof mode === "string") {
    const trimmed = mode.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : [trimmed];
      } catch {
        return [trimmed];
      }
    }
    return [trimmed];
  }
  return [];
};

const applyPlaceholders = (value: any, replacements: Record<string, any>): any => {
  if (Array.isArray(value)) {
    return value.map((item) => applyPlaceholders(item, replacements));
  }
  if (value && typeof value === "object") {
    const next: Record<string, any> = {};
    for (const key of Object.keys(value)) {
      next[key] = applyPlaceholders(value[key], replacements);
    }
    return next;
  }
  if (typeof value !== "string") return value;

  const exactMatch = value.match(/^\{\{([a-zA-Z0-9_]+)\}\}$/);
  if (exactMatch) {
    const exactValue = replacements[exactMatch[1]];
    return exactValue === undefined ? value : exactValue;
  }

  return value.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
    const replacement = replacements[key];
    if (replacement === undefined || replacement === null) return "";
    return Array.isArray(replacement) ? replacement.join(",") : String(replacement);
  });
};

const assertNoUnresolvedPlaceholders = (workflow: Record<string, any>) => {
  const matches = JSON.stringify(workflow).match(/\{\{[a-zA-Z0-9_]+\}\}/g);
  if (matches && matches.length > 0) {
    const unique = Array.from(new Set(matches));
    throw new Error(`Workflow still contains unresolved placeholders: ${unique.join(", ")}`);
  }
};

const getHistoryRecord = (history: any, promptId: string) => {
  if (history?.[promptId]) return history[promptId];
  return history;
};

const extractHistoryError = (record: any) => {
  const status = record?.status;
  if (!status) return "";
  if (status.status_str === "error") {
    const message = Array.isArray(status.messages) ? JSON.stringify(status.messages) : "";
    return message || "ComfyUI workflow failed";
  }
  return "";
};

const extractOutputDescriptor = (record: any) => {
  const outputs = record?.outputs || {};
  for (const nodeId of Object.keys(outputs)) {
    const nodeOutput = outputs[nodeId] || {};
    for (const key of ["images", "videos", "gifs", "audio"]) {
      const list = nodeOutput[key];
      if (!Array.isArray(list)) continue;
      const file = list.find((item: any) => item && item.filename);
      if (file) {
        return {
          filename: file.filename,
          subfolder: file.subfolder || "",
          type: file.type || "output",
        };
      }
    }
  }
  return null;
};

const getViewUrl = (file: { filename: string; subfolder?: string; type?: string }) => {
  const query = [
    `filename=${encodeURIComponent(file.filename)}`,
    `subfolder=${encodeURIComponent(file.subfolder || "")}`,
    `type=${encodeURIComponent(file.type || "output")}`,
  ].join("&");
  return `${getBaseUrl()}/view?${query}`;
};

const runWorkflow = async (workflow: Record<string, any>, replacements: Record<string, any>) => {
  const prompt = applyPlaceholders(workflow, replacements);
  assertNoUnresolvedPlaceholders(prompt);
  logger(`[ComfyUI] queue prompt`);
  const queueResponse = await axios.post(
    `${getBaseUrl()}/prompt`,
    {
      prompt,
      client_id: `toonflow-${Date.now()}`,
    },
    {
      headers: {
        "Content-Type": "application/json",
      },
    },
  );

  const promptId = queueResponse?.data?.prompt_id;
  if (!promptId) {
    throw new Error("ComfyUI did not return prompt_id");
  }

  const pollInterval = parseInteger(vendor.inputValues.pollIntervalMs, 3000);
  const timeout = parseInteger(vendor.inputValues.timeoutMs, 1800000);

  const result = await pollTask(async () => {
    const historyResponse = await axios.get(`${getBaseUrl()}/history/${promptId}`);
    const record = getHistoryRecord(historyResponse?.data, promptId);
    const error = extractHistoryError(record);
    if (error) return { completed: true, error };
    const output = extractOutputDescriptor(record);
    if (output) return { completed: true, data: JSON.stringify(output) };
    if (record?.status?.completed === true && !record?.outputs) {
      return { completed: true, error: "ComfyUI workflow finished without outputs" };
    }
    return { completed: false };
  }, pollInterval, timeout);

  if (result.error) throw new Error(result.error);
  if (!result.data) throw new Error("ComfyUI workflow finished without a downloadable output");

  const file = JSON.parse(result.data);
  return await urlToBase64(getViewUrl(file));
};

const buildCommonReplacements = (prompt: string, aspectRatio: string, extras: Record<string, any> = {}) => {
  const filenamePrefix = `toonflow_${Date.now()}`;
  const animePositivePrefix = pickText(vendor.inputValues.animePositivePrefix);
  const defaultNegativePrompt = pickText(vendor.inputValues.animeNegativePrompt, vendor.inputValues.negativePrompt);
  const styledPrompt = joinPrompt(animePositivePrefix, prompt || "");
  return {
    prompt: prompt || "",
    rawPrompt: prompt || "",
    styledPrompt,
    positivePrompt: styledPrompt,
    promptText: prompt || "",
    negativePrompt: defaultNegativePrompt,
    negative_prompt: defaultNegativePrompt,
    animePositivePrefix,
    animeNegativePrompt: defaultNegativePrompt,
    textImageSteps: parseInteger(vendor.inputValues.textImageSteps, 8),
    textImageCfg: parseNumber(vendor.inputValues.textImageCfg, 1.2),
    imageEditLoraStrength: parseNumber(vendor.inputValues.imageEditLoraStrength, 1),
    videoImageCompression: parseInteger(vendor.inputValues.videoImageCompression, 14),
    videoDecodeOverlap: parseInteger(vendor.inputValues.videoDecodeOverlap, 96),
    videoDecodeTemporalOverlap: parseInteger(vendor.inputValues.videoDecodeTemporalOverlap, 8),
    aspectRatio,
    seed: nextSeed(),
    filenamePrefix,
    ...extras,
  };
};

const addReferenceReplacements = (replacements: Record<string, any>, uploadedReferences: Array<{ type: ReferenceList["type"]; filename: string }>) => {
  const imageNames = uploadedReferences.filter((item) => item.type === "image").map((item) => item.filename);
  const videoNames = uploadedReferences.filter((item) => item.type === "video").map((item) => item.filename);
  const audioNames = uploadedReferences.filter((item) => item.type === "audio").map((item) => item.filename);

  imageNames.forEach((filename, index) => {
    replacements[`image${index + 1}`] = filename;
  });
  videoNames.forEach((filename, index) => {
    replacements[`video${index + 1}`] = filename;
  });
  audioNames.forEach((filename, index) => {
    replacements[`audio${index + 1}`] = filename;
  });

  replacements.referenceImages = imageNames;
  replacements.referenceVideos = videoNames;
  replacements.referenceAudios = audioNames;
  replacements.image = imageNames[0] || "";
  replacements.image1 = imageNames[0] || "";
  replacements.image2 = imageNames[1] || imageNames[0] || "";
  replacements.image3 = imageNames[2] || imageNames[1] || imageNames[0] || "";
  replacements.referenceImage = imageNames[0] || "";
  replacements.video = videoNames[0] || "";
  replacements.referenceVideo = videoNames[0] || "";
  replacements.referenceAudio = audioNames[0] || "";
  replacements.imageCount = imageNames.length;
  replacements.videoCount = videoNames.length;
  replacements.audioCount = audioNames.length;
  replacements.startImage = imageNames[0] || "";
  replacements.firstFrame = imageNames[0] || "";
  replacements.endImage = imageNames[1] || imageNames[0] || "";
  replacements.lastFrame = imageNames[1] || imageNames[0] || "";
};

const uploadReferences = async (referenceList: ReferenceList[] = []) => {
  const uploaded: Array<{ type: ReferenceList["type"]; filename: string }> = [];
  for (let index = 0; index < referenceList.length; index += 1) {
    const reference = referenceList[index];
    if (!reference?.base64) continue;
    const file = await uploadReference(reference.base64, reference.type, index + 1);
    uploaded.push({
      type: reference.type,
      filename: file.filename,
    });
  }
  return uploaded;
};

const textRequest = () => {
  throw new Error("ComfyUI vendor does not provide text models");
};

const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  const references = config.referenceList || [];
  const useReferenceWorkflow = references.length > 0;
  const workflow = await getWorkflow("image", useReferenceWorkflow, references.length);
  const uploadedReferences = await uploadReferences(references);
  const { width, height } = getImageDimensions(config.size, config.aspectRatio);
  const replacements = buildCommonReplacements(config.prompt, config.aspectRatio, {
    modelName: model.modelName,
    size: config.size,
    width,
    height,
    hasReference: uploadedReferences.length > 0,
  });
  addReferenceReplacements(replacements, uploadedReferences);
  logger(`[ComfyUI] image request with ${uploadedReferences.length} reference(s)`);
  return await runWorkflow(workflow, replacements);
};

const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  const references = config.referenceList || [];
  const useReferenceWorkflow = references.length > 0;
  const workflow = await getWorkflow("video", useReferenceWorkflow);
  const uploadedReferences = await uploadReferences(references);
  const normalizedMode = normalizeMode(config.mode);
  const fallbackFps = parseInteger(vendor.inputValues.videoFps, 24);
  const fps = useReferenceWorkflow
    ? parseInteger(vendor.inputValues.videoReferenceFps, fallbackFps)
    : parseInteger(vendor.inputValues.videoTextFps, fallbackFps);
  const { width, height } = getVideoDimensions(config.resolution || "720p", config.aspectRatio || "16:9");
  const replacements = buildCommonReplacements(config.prompt, config.aspectRatio, {
    modelName: model.modelName,
    duration: config.duration,
    resolution: config.resolution || "720p",
    width,
    height,
    fps,
    frames: Math.max(1, Math.round((config.duration || 0) * fps)),
    audio: config.audio === true,
    hasReference: uploadedReferences.length > 0,
    mode: normalizedMode.length === 1 ? normalizedMode[0] : JSON.stringify(normalizedMode),
  });
  addReferenceReplacements(replacements, uploadedReferences);
  logger(`[ComfyUI] video request with ${uploadedReferences.length} reference(s)`);
  return await runWorkflow(workflow, replacements);
};

const ttsRequest = async (): Promise<string> => {
  return "";
};

const checkForUpdates = async (): Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }> => {
  return { hasUpdate: false, latestVersion: "2.0", notice: "" };
};

const updateVendor = async (): Promise<string> => {
  return "";
};

exports.vendor = vendor;
exports.textRequest = textRequest;
exports.imageRequest = imageRequest;
exports.videoRequest = videoRequest;
exports.ttsRequest = ttsRequest;
exports.checkForUpdates = checkForUpdates;
exports.updateVendor = updateVendor;

export {};
