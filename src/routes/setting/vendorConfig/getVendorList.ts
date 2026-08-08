import express from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
const router = express.Router();

export default router.post("/", async (req, res) => {
  const data = await u.db("o_vendorConfig").select("*");

  const list = await Promise.all(
    data.map(async (item) => {
      try {
        const vendor = u.vendor.getVendor(item.id!);
        if (!vendor) {
          throw new Error(`供应商脚本读取失败：${item.id}.ts，目录：${u.getPath("vendor")}`);
        }
        const inputValues = item.inputValues?.trim() ? JSON.parse(item.inputValues) : {};

        return {
          ...item,
          inputValues,
          models: await u.vendor.getModelList(item.id!),
          code: u.vendor.getCode(item.id!),
          description: vendor.description,
          inputs: vendor.inputs,
          author: vendor.author,
          name: vendor.name,
          version: vendor.version ?? "1.0",
        };
      } catch (err) {
        console.error(`[Vendor List] 跳过供应商 ${item.id}:`, u.error(err).message);
        return null;
      }
    }),
  );

  const validList = list.filter((item): item is NonNullable<typeof item> => item !== null);
  validList.sort((a, b) => (a.id === "toonflow" ? -1 : b.id === "toonflow" ? 1 : 0));
  res.status(200).send(success(validList));
});
