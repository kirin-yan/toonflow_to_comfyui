import express from "express";
import u from "@/utils";
import { z } from "zod";
import sharp from "sharp";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { Output, tool } from "ai";
import { urlToBase64 } from "@/utils/vm";
import { assetItemSchema } from "@/agents/productionAgent/tools";
const router = express.Router();
export type AssetData = z.infer<typeof assetItemSchema>;

export default router.post(
  "/",
  validateFields({
    storyboardIds: z.array(z.number()),
    projectId: z.number(),
    scriptId: z.number(),
    concurrentCount: z.number().min(1).optional(),
  }),
  async (req, res) => {
    const {
      storyboardIds,
      projectId,
      scriptId,
      concurrentCount = 5,
    }: {
      storyboardIds: number[];
      projectId: number;
      scriptId: number;
      concurrentCount: number;
    } = req.body;
    if (!storyboardIds || storyboardIds.length === 0) return res.status(400).send(error("storyboardIds不能为空"));
    // 当没有 storyboardIds 时，通过 AI 生成新的分镜面板数据
    let finalStoryboardIds: number[] = storyboardIds || [];
    // shouldGenerateImage === 0 的分镜标记为「未生成」，其余标记为「生成中」
    await u
      .db("o_storyboard")
      .whereIn("id", finalStoryboardIds)
      .where("scriptId", scriptId)
      .where("shouldGenerateImage", 0)
      .update({ state: "未生成" });
    await u
      .db("o_storyboard")
      .whereIn("id", finalStoryboardIds)
      .where("scriptId", scriptId)
      .where("shouldGenerateImage", 1)
      .update({ state: "生成中" });

    const projectSettingData = await u.db("o_project").where("id", projectId).select("imageModel", "imageQuality", "artStyle", "videoRatio").first();

    const storyboardData = await u.db("o_storyboard").where("scriptId", scriptId).whereIn("id", finalStoryboardIds);
    const assetData = await u
      .db("o_assets")
      .leftJoin("o_assets2Storyboard", "o_assets.id", "o_assets2Storyboard.assetId")
      .whereIn("o_assets2Storyboard.storyboardId", finalStoryboardIds)
      .select("o_assets2Storyboard.storyboardId", "o_assets.imageId");

    const assetRecord: Record<number, number[]> = {};
    assetData.forEach((item: any) => {
      if (!assetRecord[item.storyboardId]) {
        assetRecord[item.storyboardId] = [];
      }
      assetRecord[item.storyboardId].push(item.imageId);
    });

    res.status(200).send(
      success(
        storyboardData.map((i) => ({
          id: i.id,
          prompt: i.prompt,
          associateAssetsIds: assetRecord[i.id!],
          src: null,
          state: i.state,
          videoDesc: i.videoDesc,
          shouldGenerateImage: i.shouldGenerateImage,
        })),
      ),
    );
    const generateTask = async (item: (typeof storyboardData)[number]) => {
      const repeloadObj = {
        prompt: item.prompt!,
        size: projectSettingData?.imageQuality as "1K" | "2K" | "4K",
        aspectRatio: projectSettingData?.videoRatio as `${number}:${number}`,
      };

      await u.Ai.Image(projectSettingData?.imageModel as `${string}:${string}`)
        .run(
          {
            referenceList: await getAssetsImageBase64(assetRecord[item.id!] || []),
            ...repeloadObj,
          },
          {
            taskClass: "生成分镜图片",
            describe: "分镜图片生成",
            relatedObjects: JSON.stringify(repeloadObj),
            projectId: projectId,
          },
        )
        .then(async (imageCls) => {
          const savePath = `/${projectId}/assets/${scriptId}/${u.uuid()}.jpg`;
          await imageCls.save(savePath);
          await u.db("o_storyboard").where("id", item.id).update({
            filePath: savePath,
            state: "已完成",
          });
        })
        .catch(async (e) => {
          await u
            .db("o_storyboard")
            .where("id", item.id)
            .update({
              filePath: "",
              reason: u.error(e).message,
              state: "生成失败",
            });
        });
    };

    // 按 concurrentCount 控制并发数，分批执行；跳过 shouldGenerateImage === 0 的分镜
    const generateList = storyboardData.filter((item) => item.shouldGenerateImage !== 0);
    for (let i = 0; i < generateList.length; i += concurrentCount) {
      const batch = generateList.slice(i, i + concurrentCount);
      await Promise.all(batch.map(generateTask));
    }
  },
);
async function getAssetsImageBase64(imageIds: number[]) {
  if (!imageIds.length) return [];

  const imagePaths = await u.db("o_image").whereIn("o_image.id", imageIds).select("o_image.id", "o_image.filePath");

  // 建立 id 到 filePath 的映射
  const id2Path = new Map<number, string>();
  for (const row of imagePaths) {
    id2Path.set(row.id, row.filePath);
  }

  // 保证输出顺序与 imageIds 一致
  const imageUrls = await Promise.all(
    imageIds.map(async (id) => {
      const filePath = id2Path.get(id);
      if (filePath) {
        try {
          return await urlToBase64(await u.oss.getFileUrl(filePath));
        } catch {
          return null;
        }
      }
      return null;
    }),
  );
  // 保留顺序，并且过滤掉无效项
  return (imageUrls.filter(Boolean) as string[]).map((url) => ({ type: "image" as const, base64: url }));
}
