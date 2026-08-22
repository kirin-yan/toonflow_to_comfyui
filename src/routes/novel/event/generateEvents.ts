import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

// 清洗小说原文，生成事件列表
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    novelIds: z.array(z.number()),
    concurrentCount: z.number().min(1).optional(),
  }),
  async (req, res) => {
    const { projectId, novelIds, concurrentCount = 1 } = req.body;

    const [allChapters, novel] = await Promise.all([
      u.db("o_novel").where("projectId", projectId).whereIn("id", novelIds),
      Promise.resolve(new u.cleanNovel(Math.min(concurrentCount, 1))),
    ]);
    if (allChapters.length === 0) {
      return res.status(400).send(success("没有对应章节"));
    }
    await u.db("o_novel").where("projectId", projectId).whereIn("id", novelIds).update({ eventState: 0, event: null });
    novel.emitter.on("item", async (item) => {
      await u
        .db("o_novel")
        .where("id", item.id)
        .update({ event: item.event, eventState: item.event ? 1 : -1, errorReason: item?.errorReason ?? null });
    });
    void novel.start(allChapters, projectId).catch(async (err) => {
      const reason = u.error(err).message;
      await u.db("o_novel").where("projectId", projectId).whereIn("id", novelIds).where("eventState", 0).update({ eventState: -1, errorReason: reason });
    });

    return res.status(200).send(success("生成事件成功"));
  },
);
