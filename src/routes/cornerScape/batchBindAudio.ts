import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { tool } from "ai";
const router = express.Router();

// 获取资产
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    assetsIds: z.array(z.number()),
    concurrentCount: z.number().min(1).optional(),
  }),
  async (req, res) => {
    const { projectId, assetsIds, concurrentCount } = req.body;
    const assetsData = await u
      .db("o_assets")
      .where("type", "audio")
      .whereIn("id", assetsIds)
      .andWhere("projectId", projectId)
      .select("id", "name", "describe");
    console.log("%c Line:20 🍎 assetsData", "background:#b03734", assetsData);

    const audioData = await u.db("o_assets").where("type", "audio").whereNull("assetsId").andWhere("projectId", projectId).select("id", "name", "describe");
    console.log("%c Line:26 🍋 audioData", "background:#ea7e5c", audioData);
    async function processGroup() {
      try {
        const resultTool = tool({
          description: "返回结果时必须调用这个工具",
          inputSchema: z.object({
            result: z.array(z.object({
              id: z.number(),
              audioIds: z.array(z.number()).describe("适配的音频id 无适配内容可以为 空数组")
            })).describe("适配的音色列表，id为资产id，audioIds为适配的音频id 无适配内容可以为 空数组")
          }),
          execute: async ({ result }) => {
            console.log("[tools] extractAssets result", result);
            for (const item of result) {
              await u.db("o_assetsRole2Audio").where("assetsRoleId", item.id).delete()
              if (item.audioIds.length)
                await u.db("o_assetsRole2Audio").insert(item.audioIds.map(i => ({ assetsRoleId: item.id, assetsAudioId: i })))
            }
            return "无需回复用户任何内容";
          },
        });

        const { text } = await u.Ai.Text("universalAi").invoke({
          messages: [
            {
              role: "system",
              content: `请根据提供的资产内容描述 与 提供的音色 进行匹配，返回适配的音色,结果必须调用 resultTool 工具返回， 调用工具之后你无需回复用户任何内容。`,
            },
            {
              role: "user",
              content: `音频内容：${audioData.map(i => `Id:${i.id},音色名称:${i.name},描述:${i.describe}`).join("\n")}\n\n
                资产内容：${assetsData.map(i => `ID:${i.id},名称:${i.name},描述:${i.describe}`).join("\n")}\n\n
                请根据提供的资产内容描述 与 对应已有的音色 进行匹配，返回适配的音色`,
            },
          ],
          tools: { resultTool },
        });
        console.log("%c Line:44 🍞 text", "background:#f5ce50", text);

      } catch (e) {
        console.error(`提取失败:`, e);
        return;
      }
    }
    await processGroup()
    res.status(200).send(success());
  },
);
