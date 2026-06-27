import express from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
const router = express.Router();

export default router.post("/", async (req, res) => {
  const data = await u.db("o_agentDeploy").leftJoin("o_vendorConfig", "o_vendorConfig.id", "o_agentDeploy.vendorId").select("o_agentDeploy.*");
  res.status(200).send(success(data));
});
