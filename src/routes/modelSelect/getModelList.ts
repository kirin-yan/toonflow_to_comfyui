import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    type: z.enum(["text", "image", "video", "all"]),
  }),
  async (req, res) => {
    const { type } = req.body;
    const dataList = await u.db("o_vendorConfig").select("id").where("enable", 1);
    if (!dataList || dataList.length === 0) {
      return res.status(404).send({ error: "模型未找到" });
    }
    const result = await Promise.all(
      dataList.map(async (data) => {
        try {
          const vendorData = u.vendor.getVendor(data.id!);
          const models = await u.vendor.getModelList(data.id!);
        const filtered =
          type === "all"
            ? models.filter((item: { type: string }) => item.type !== "video")
            : models.filter((item: { type: string }) => item.type === type);
          return filtered.map((item: { name: string; modelName: string; type: string }) => ({
            id: data.id,
            label: item.name,
            value: item.modelName,
            type: item.type,
            name: vendorData.name,
          }));
        } catch (err) {
          console.error(`[Model List] 跳过供应商 ${data.id}:`, u.error(err).message);
          return [];
        }
      }),
    );
    res.status(200).send(success(result.flat()));
  },
);
