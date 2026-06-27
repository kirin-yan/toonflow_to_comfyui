import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.number(),
    projectId: z.number(),
  }),
  async (req, res) => {
    const { id, projectId } = req.body;
    await u.db("o_assets").where("id", id).delete();
    await u.db("o_assets2Storyboard").where("assetId", id).delete();
    res.status(200).send(success({ message: "视频删除成功" }));
  },
);
