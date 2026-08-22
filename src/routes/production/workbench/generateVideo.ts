import express from "express";
import u from "@/utils";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

function parseRequestedMode(mode: string): string | string[] {
  const value = mode.trim();
  if (!value) throw new Error("视频生成模式不能为空");
  if (!value.startsWith("[")) return value;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) throw new Error("模式数组格式错误");
    return parsed;
  } catch (err) {
    throw new Error(`视频生成模式格式错误：${err instanceof Error ? err.message : "无法解析"}`);
  }
}

function isSupportedMode(selectedModel: any, requestedMode: string | string[]): boolean {
  const declaredModes = Array.isArray(selectedModel?.mode) ? selectedModel.mode : [];
  if (typeof requestedMode === "string") return declaredModes.includes(requestedMode);
  if (requestedMode.length === 1 && declaredModes.includes(requestedMode[0])) return true;
  return declaredModes.some(
    (candidate: any) =>
      Array.isArray(candidate) &&
      requestedMode.length === candidate.length &&
      requestedMode.every((item) => candidate.includes(item)),
  );
}

type Type = "imageReference" | "startImage" | "endImage" | "videoReference" | "audioReference";
interface UploadItem {
  fileType: "image" | "video" | "audio";
  type: Type;
  sources?: "assets" | "storyboard";
  id?: number;
  src?: string;
  label?: string;
  prompt?: string;
}

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number(),
    uploadData: z.array(
      z.object({
        id: z.number(),
        sources: z.string(),
      }),
    ),
    prompt: z.string(),
    model: z.string(),
    mode: z.string(),
    resolution: z.string(),
    duration: z.number(),
    audio: z.boolean().optional(),
    trackId: z.number(),
  }),
  async (req, res) => {
    const { scriptId, projectId, prompt, uploadData, model, duration, resolution, audio, mode, trackId } = req.body;
    const separatorIndex = model.indexOf(":");
    if (separatorIndex <= 0 || separatorIndex === model.length - 1) {
      return res.status(400).send({ code: 400, data: null, message: `视频模型格式错误：${model}` });
    }
    const vendorId = model.slice(0, separatorIndex);
    const videoModelName = model.slice(separatorIndex + 1);
    const modelList = await u.vendor.getModelList(vendorId);
    const selectedModel = modelList.find((item: any) => item.modelName === videoModelName && item.type === "video");
    if (!selectedModel) {
      return res.status(400).send({ code: 400, data: null, message: `未找到视频模型：${model}` });
    }
    const durationResolutionMap = Array.isArray(selectedModel.durationResolutionMap) ? selectedModel.durationResolutionMap : [];
    const supportedCombination = durationResolutionMap.some(
      (item: any) => Array.isArray(item.duration) && item.duration.includes(duration) && Array.isArray(item.resolution) && item.resolution.includes(resolution),
    );
    if (!supportedCombination) {
      const supported = durationResolutionMap
        .map((item: any) => `${(item.resolution || []).join("/")}：${(item.duration || []).join("/")}秒`)
        .join("；");
      return res.status(400).send({
        code: 400,
        data: null,
        message: `当前模型不支持 ${resolution}、${duration}秒。支持范围：${supported || "未声明"}`,
      });
    }
    let requestedMode: string | string[];
    try {
      requestedMode = parseRequestedMode(mode);
    } catch (err) {
      return res.status(400).send({ code: 400, data: null, message: u.error(err).message });
    }
    if (!isSupportedMode(selectedModel, requestedMode)) {
      return res.status(400).send({ code: 400, data: null, message: `模型 ${videoModelName} 不支持生成模式 ${mode}` });
    }
    //获取生成视频比例
    const ratio = await u.db("o_project").select("videoRatio").where("id", projectId).first();
    const videoPath = `/${projectId}/video/${uuidv4()}.mp4`; //视频保存路径
    //查询出图片数据
    const images = await Promise.all(
      uploadData.map(async (item: UploadItem) => {
        if (item.sources === "storyboard") {
          const filePath = await u.db("o_storyboard").where("id", item.id).select("filePath").first();
          return filePath?.filePath;
        }
        if (item.sources === "assets") {
          const filePath = await u
            .db("o_assets")
            .where("o_assets.id", item.id)
            .leftJoin("o_image", "o_assets.imageId", "o_image.id")
            .select("o_image.filePath")
            .first();
          return filePath?.filePath;
        }
      }),
    );
    //把images里面的图片转成base64格式
    const base64 = await Promise.all(
      images.map(async (item) => {
        if (!item) return null;
        return await u.oss.getImageBase64(item);
      }),
    );
    const validReferences = base64.filter((item): item is string => item !== null);
    if (requestedMode === "singleImage" && validReferences.length !== 1) {
      return res.status(400).send({ code: 400, data: null, message: "单图视频模式必须选择且只能选择一张有效图片" });
    }
    if (requestedMode === "startEndRequired" && validReferences.length !== 2) {
      return res.status(400).send({ code: 400, data: null, message: "首尾帧模式必须选择两张有效图片" });
    }
    if (requestedMode === "endFrameOptional" && (validReferences.length < 1 || validReferences.length > 2)) {
      return res.status(400).send({ code: 400, data: null, message: "首帧必选、尾帧可选模式必须选择一至两张图片" });
    }
    if (requestedMode === "startFrameOptional" && validReferences.length > 2) {
      return res.status(400).send({ code: 400, data: null, message: "首尾帧可选模式最多支持两张图片" });
    }
    if (requestedMode === "text" && validReferences.length > 0) {
      return res.status(400).send({ code: 400, data: null, message: "文生视频模式不能携带参考图片，请清空素材后重试" });
    }
    //新增
    const [videoId] = await u.db("o_video").insert({
      filePath: videoPath,
      time: Date.now(),
      state: "生成中",
      scriptId,
      projectId,
      videoTrackId: trackId,
    });
    await u.db("o_videoTrack").where("id", trackId).update({ state: "生成中", reason: null });
    res.status(200).send(success(videoId));
    (async () => {
      try {
        const relatedObjects = {
          projectId,
          videoId,
          scriptId,
          type: "视频",
        };
        const aiVideo = u.Ai.Video(model);
        await aiVideo.run(
          {
            prompt,
            referenceList: validReferences.map((item) => ({ type: "image" as const, base64: item })),
            mode: requestedMode,
            duration,
            aspectRatio: (ratio?.videoRatio as "16:9" | "9:16") || "16:9",
            resolution,
            audio,
          },
          {
            projectId,
            taskClass: "视频生成",
            describe: "根据提示词生成视频",
            relatedObjects: JSON.stringify(relatedObjects),
          },
        );
        await aiVideo.save(videoPath);
        await u.db("o_video").where("id", videoId).update({ state: "已完成", errorReason: null });
        await u.db("o_videoTrack").where("id", trackId).update({ state: "已完成", reason: null });
      } catch (error: any) {
        const reason = error instanceof Error ? error.message : "未知错误";
        await u
          .db("o_video")
          .where("id", videoId)
          .update({
            state: "生成失败",
            errorReason: reason,
          });
        await u.db("o_videoTrack").where("id", trackId).update({ state: "生成失败", reason });
      }
    })();
  },
);
