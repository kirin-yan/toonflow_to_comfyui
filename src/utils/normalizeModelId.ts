const legacyComfyVendorPrefix = "comfyuitest:";
const comfyVendorPrefix = "comfyui:";

export function normalizeComfyModelId(modelId: string): string {
  const value = String(modelId ?? "").trim();
  return value.startsWith(legacyComfyVendorPrefix) ? comfyVendorPrefix + value.slice(legacyComfyVendorPrefix.length) : value;
}
