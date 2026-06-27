import express from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.number(),
    name: z.string(),
    model: z.string(),
    modelName: z.string(),
    vendorId: z.string().nullable(),
    desc: z.string(),
  }),
  async (req, res) => {
    const { id, name, model, modelName, vendorId, desc } = req.body;
    await u.db("o_agentDeploy").where({ id }).update({ id, name, model, modelName, vendorId, desc });
    res.status(200).send(success("配置成功"));
  },
);
