import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 新增剧本
export default router.post(
  "/",
  validateFields({
    name: z.string(),
    content: z.string(),
    projectId: z.number(),
    assets: z.array(z.number()),
  }),
  async (req, res) => {
    const { name, content, projectId, assets } = req.body;
    if (content.length >= 3000) return res.status(400).send(error("内容不能超过3000字"));
    const [scriptId] = await u.db("o_script").insert({
      name,
      content,
      projectId,
      createTime: Date.now(),
    });
    if (assets.length) {
      const assetsData = await u.db("o_assets").whereIn("id", assets).select();
      if (assetsData.length) {
        const assetsIds = assetsData.map((item) => item.id);
        const insertData = assetsIds.map((i) => {
          return {
            scriptId,
            assetId: i,
          };
        });
        await u.db("o_scriptAssets").insert(insertData);
      }
    }

    res.status(200).send(success({ message: "添加剧本成功" }));
  },
);
