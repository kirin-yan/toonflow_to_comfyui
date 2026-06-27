import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number(),
    duration: z.number().optional(),
  }),
  async (req, res) => {
    const { projectId, scriptId, duration } = req.body;
    const [id] = await u.db("o_videoTrack").insert({
      projectId,
      scriptId,
      duration,
    });
    res.status(200).send(success(id));
  },
);
