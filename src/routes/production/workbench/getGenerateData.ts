import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

interface VideoItem {
  id: number;
  src: string;
  state: "未生成" | "生成中" | "已完成" | "生成失败";
}

interface TrackMedia {
  src: string;
  id?: number;
  fileType: "image" | "video" | "audio";
  videoDesc?: string;
}

interface TrackItem {
  id?: number;
  prompt: string;
  state: "未生成" | "生成中" | "已完成" | "生成失败";
  reason?: string;
  duration?: number;
  selectVideoId?: number;
  medias: TrackMedia[];
  videoList: VideoItem[];
}

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number(),
  }),
  async (req, res) => {
    const { projectId, scriptId } = req.body;
    const projectData = await u.db("o_project").where("id", projectId).select("id", "videoModel").first();
    if (!projectData?.videoModel) {
      return res.status(400).json(success("项目未配置视频模型"));
    }
    const [videoId, videoModelName] = projectData.videoModel.split(":");
    const models = await u.vendor.getModelList(videoId);
    const findData = models.find((i: any) => i.modelName == videoModelName);
    const isRef = findData.mode.every((i: any) => Array.isArray(i));

    const storyboardList = await u.db("o_storyboard").where({ scriptId, projectId }).orderBy("index", "asc");
    await Promise.all(
      storyboardList.map(async (i) => {
        i.filePath = i.filePath ? await u.oss.getFileUrl(i.filePath) : "";
      }),
    );
    const storyboardTrackRecord: Record<number, any[]> = {};
    storyboardList.forEach((i) => {
      if (storyboardTrackRecord[i.trackId!]) {
        storyboardTrackRecord[i.trackId!].push({
          src: i.filePath,
          fileType: "image",
          sources: "storyboard",
          ...(i.prompt != null ? { prompt: i.videoDesc } : {}),
          ...(i.id != null ? { id: i.id } : {}),
          index: i.index,
        });
      } else {
        storyboardTrackRecord[i.trackId!] = [
          {
            src: i.filePath,
            fileType: "image",
            sources: "storyboard",
            ...(i.prompt != null ? { prompt: i.videoDesc } : {}),
            ...(i.id != null ? { id: i.id } : {}),
            index: i.index,
          },
        ];
      }
    });
    // 按 storyboardId 分组的资产数据，key 为 storyboardId
    const otherDataMap: Record<number, any[]> = {};
    if (isRef) {
      const storyIds = storyboardList.map((s) => s.id);
      const assetDatas = await u
        .db("o_assets2Storyboard")
        .leftJoin("o_assets", "o_assets2Storyboard.assetId", "o_assets.id")
        .leftJoin("o_image", "o_image.id", "o_assets.imageId")
        .whereIn("o_assets2Storyboard.storyboardId", storyIds as number[])
        .select("o_assets.*", "o_image.filePath", "o_assets2Storyboard.storyboardId");

      await Promise.all(
        assetDatas.map(async (i) => {
          const item = {
            id: i.id,
            name: i.name,
            describe: i.describe,
            type: i.type,
            fileType: "image" as const,
            sources: "assets",
            src: i.filePath ? await u.oss.getFileUrl(i.filePath) : "",
          };
          const sid = i.storyboardId as number;
          if (!otherDataMap[sid]) otherDataMap[sid] = [];
          otherDataMap[sid].push(item);
        }),
      );
    }

    const id = await u.db("o_project").where({ id: projectId }).select("id").first();
    const trackData = await u.db("o_videoTrack").where({ projectId, scriptId });
    const videoList = await u.db("o_video").whereIn(
      "videoTrackId",
      trackData.map((t) => t.id),
    );
    const trackList: TrackItem[] = [];
    const trackIdMap = [...new Set<number>(trackData.map((t) => t.id!))];
    for (const trackId of trackIdMap) {
      const item = trackData.find((t) => t.id === trackId);
      trackList.push({
        id: trackId,
        duration: item?.duration ?? 0,
        prompt: item?.prompt || "",
        state: (item?.state as "未生成" | "生成中" | "已完成" | "生成失败") ?? "未生成",
        reason: item?.reason ?? "",
        selectVideoId: Number(item?.videoId)!,
        medias: (() => {
          const storyboardMedias = storyboardTrackRecord[trackId] ?? [];
          const assetMedias = storyboardMedias.flatMap((s) => otherDataMap[s.id] ?? []);
          const seenAssetIds = new Set<number>();
          const uniqueAssets = assetMedias.filter((a) => {
            if (seenAssetIds.has(a.id)) return false;
            seenAssetIds.add(a.id);
            return true;
          });
          const hasImageAssetData = uniqueAssets.filter(i => i.src)
          const notHasImageAssetData = uniqueAssets.filter(i => !i.src)

          return [...hasImageAssetData, ...storyboardMedias, ...notHasImageAssetData];
        })(),
        videoList: await Promise.all(
          videoList
            .filter((v) => v.videoTrackId === trackId)
            .map(async (v) => ({
              id: v.id!,
              src: v.filePath ? await u.oss.getFileUrl(v.filePath) : "",
              state: v.state === "已完成" ? "已完成" : v.state === "生成中" ? "生成中" : v.state === "生成失败" ? "生成失败" : "未生成",
            })),
        ),
      });
    }
    res.status(200).send(
      success({
        storyboardList: await Promise.all(
          storyboardList.map(async (s) => ({
            ...s,
            src: s.filePath,
          })),
        ),
        trackList,
      }),
    );
  },
);
