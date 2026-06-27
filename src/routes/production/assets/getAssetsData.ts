import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { o_assets } from "@/types/database";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
  }),
  async (req, res) => {
    const { projectId } = req.body;
    const parentAssetsData = await u.db("o_assets").where("projectId", projectId).whereNotNull("assetsId");
    const parentIds = parentAssetsData.map((i) => i.id);
    const sonAssetsData = await u.db("o_assets").whereIn("assetsId", parentIds);
    const sonAssetsMap: Record<number, o_assets[]> = {};

    const imageIds = [...parentAssetsData.map((i) => i.imageId).concat(sonAssetsData.map((i) => i.imageId))].filter(Boolean);
    const imagePaths = await u
      .db("o_image")
      .whereIn("id", imageIds as unknown as string[])
      .select("id", "filePath");
    const imageSignUrls = await Promise.all(
      imagePaths.map(async (i) => {
        return { id: i.id, src: i.filePath ? await u.oss.getFileUrl(i.filePath) : null };
      }),
    );
    const imageUrlMap: Record<number, string | null> = {};
    imageSignUrls.forEach((i, index) => {
      imageUrlMap[i.id!] = i.src;
    });
    sonAssetsData.forEach((i) => {
      if (!sonAssetsMap[i.assetsId!]) {
        sonAssetsMap[i.assetsId!] = [];
      }
      const obj = {
        assetsId: i.id,
        name: i.name,
        desc: i.describe,
        src: imageUrlMap[i.imageId!] ?? null,
        derive: sonAssetsMap[i.id!] ?? [],
      };
      sonAssetsMap[i.assetsId!].push(obj);
    });
    const returnData = parentAssetsData.map((i) => {
      return {
        assetsId: i.id,
        name: i.name,
        desc: i.describe,
        src: imageUrlMap[i.imageId!] ?? null,
        derive: sonAssetsMap[i.id!] ?? [],
      };
    });
    res.status(200).send(success(returnData));
  },
);
