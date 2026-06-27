import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 新增资产
export default router.post(
  "/",
  validateFields({
    assetsId: z.number(),
    audioIds: z.array(z.number()),
  }),
  async (req, res) => {
    const { assetsId, audioIds } = req.body;
    await u.db("o_assetsRole2Audio").where("assetsRoleId", assetsId).delete();
    if (audioIds.length) {
      await u.db("o_assetsRole2Audio").insert(audioIds.map((i: number) => ({ assetsRoleId: assetsId, assetsAudioId: i })));
    }
    res.status(200).send(success({ message: "更新音频成功" }));
  },
);
