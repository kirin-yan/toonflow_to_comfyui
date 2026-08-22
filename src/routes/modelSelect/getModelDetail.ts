import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { normalizeComfyModelId } from "@/utils/normalizeModelId";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    modelId: z.string(),
  }),
  async (req, res) => {
    const modelId = normalizeComfyModelId(req.body.modelId);
    const [id, name] = modelId.split(":");
    try {
      const models = await u.vendor.getModelList(id);
      const findData = models.find((i: any) => i.modelName == name);
      if (!findData) return res.status(404).send(error(`未找到模型：${modelId}`));
      res.status(200).send(success(findData));
    } catch (err) {
      console.error(`[Model Detail] 读取模型 ${modelId} 失败:`, u.error(err).message);
      return res.status(400).send(error(`模型供应商不可用：${u.error(err).message}`));
    }
  },
);
