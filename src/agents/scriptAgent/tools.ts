import { tool, Tool } from "ai";
import u from "@/utils";
import { z } from "zod";
import ResTool from "@/socket/resTool";

export const ScriptSchema = z.object({
  name: z.string().describe("剧本名称"),
  content: z.string().describe("剧本内容"),
});
export const planData = z.object({
  storySkeleton: z.string().describe("故事骨架"),
  adaptationStrategy: z.string().describe("改编策略"),
  script: z.string().describe("剧本内容"),
});

export type planData = z.infer<typeof planData>;

const keySchema = z.enum(Object.keys(planData.shape) as [keyof planData, ...Array<keyof planData>]);
const planDataKeyLabels = Object.fromEntries(
  Object.entries(planData.shape).map(([key, schema]) => [key, (schema as z.ZodTypeAny).description ?? key]),
) as Record<keyof planData, string>;

interface ToolConfig {
  resTool: ResTool;
  toolsNames?: string[];
  msg: ReturnType<ResTool["newMessage"]>;
}

export default (toolCpnfig: ToolConfig) => {
  const { resTool, toolsNames, msg } = toolCpnfig;
  const { socket } = resTool;
  const invocationKeys = new Set<string>();

  function rejectRepeatedInvocation(name: string, input: unknown) {
    const key = `${name}:${stableSerialize(input)}`;
    if (invocationKeys.has(key)) {
      throw new Error(`工具 ${name} 已使用相同参数调用过，请使用第一次返回的结果继续任务，不要重复查询。`);
    }
    invocationKeys.add(key);
  }

  const tools: Record<string, Tool> = {
    get_novel_events: tool({
      description: "获取章节事件",
      inputSchema: z.object({
        chapterIndexs: z.array(z.number()).describe("章节的编号"),
      }),
      execute: async ({ chapterIndexs }) => {
        const normalizedIndexes = [...new Set(chapterIndexs)].sort((a, b) => a - b);
        rejectRepeatedInvocation("get_novel_events", { chapterIndexs: normalizedIndexes });
        console.log("[tools] get_novel_events", chapterIndexs);
        const thinking = msg.thinking("正在查询章节事件...");
        const data = await u
          .db("o_novel")
          .where("projectId", resTool.data.projectId)
          .select("id", "chapterIndex as index", "reel", "chapter", "chapterData", "event", "eventState")
          .whereIn("chapterIndex", normalizedIndexes)
          .orderBy("chapterIndex", "asc");
        thinking.appendText("正在查询章节编号: " + normalizedIndexes.join(","));

        const returnedIndexes = new Set(data.map((item: any) => Number(item.index)));
        const missingIndexes = normalizedIndexes.filter((index) => !returnedIndexes.has(index));
        const pending = data.filter((item: any) => item.eventState === 0);
        const failed = data.filter(
          (item: any) => item.eventState === -1 || (item.eventState !== 0 && !String(item.event ?? "").trim()),
        );
        const statusMessages = [
          missingIndexes.length ? `未找到章节：${missingIndexes.map((index) => `第${index}章`).join("、")}` : "",
          pending.length ? `事件仍在生成：${pending.map((item: any) => `第${item.index}章`).join("、")}` : "",
          failed.length ? `事件生成失败或为空：${failed.map((item: any) => `第${item.index}章`).join("、")}` : "",
        ].filter(Boolean);
        const ready = data.filter((item: any) => item.eventState !== 0 && item.eventState !== -1 && String(item.event ?? "").trim());
        const eventString = ready.map((i: any) => `第${i.index}章，标题：${i.chapter}，事件：${i.event}`).join("\n");
        const result = [statusMessages.join("；"), eventString].filter((value) => value.trim()).join("\n");
        thinking.appendText("查询结果:\n" + result);
        thinking.updateTitle("查询章节事件完成");
        thinking.complete();
        return result.trim() || "未查询到任何章节事件，请检查章节编号以及事件生成状态。";
      },
    }),
    get_planData: tool({
      description: "获取工作区数据",
      inputSchema: z.object({
        key: keySchema.describe("数据key"),
      }),
      execute: async ({ key }) => {
        rejectRepeatedInvocation("get_planData", { key });
        console.log("[tools] get_planData", key);
        const thinking = msg.thinking(`正在获取${planDataKeyLabels[key]}工作区数据...`);
        const workspaceData = await new Promise<planData | null>((resolve) =>
          socket.emit("getPlanData", { key }, (res: planData | null) => resolve(res)),
        );
        thinking.appendText(`获取到${planDataKeyLabels[key]}:\n` + (workspaceData?.[key] ?? ""));
        thinking.updateTitle(`获取${planDataKeyLabels[key]}完成`);
        thinking.complete();
        const value = String(workspaceData?.[key] ?? "").trim();
        return value || `${planDataKeyLabels[key]}工作区数据为空。`;
      },
    }),
    get_novel_text: tool({
      description: "获取小说章节原始文本内容",
      inputSchema: z.object({
        chapterIndex: z.coerce.number().int().nonnegative().describe("章节编号"),
      }),
      execute: async ({ chapterIndex }) => {
        rejectRepeatedInvocation("get_novel_text", { chapterIndex });
        console.log("[tools] get_novel_text", "[tools] get_novel_text", chapterIndex);
        const thinking = msg.thinking(`正在获取小说章节原文...`);
        const data = await u.db("o_novel").where("projectId", resTool.data.projectId).where({ chapterIndex }).select("chapterData").first();
        const text = data && data?.chapterData ? data.chapterData : "";
        thinking.appendText(`获取到原文:\n` + text);
        thinking.updateTitle(`获取小说章节原文完成`);
        thinking.complete();
        return text.trim() || `未找到第${chapterIndex}章的小说原文。`;
      },
    }),
    get_script_content: tool({
      description: "获取剧本本内容",
      inputSchema: z.object({
        ids: z.array(z.string()).describe("脚本id"),
      }),
      execute: async ({ ids }) => {
        const normalizedIds = [...new Set(ids)].sort();
        rejectRepeatedInvocation("get_script_content", { ids: normalizedIds });
        console.log("[tools] get_script_content", "[tools] get_script_content", ids);
        const thinking = msg.thinking(`正在获取脚本内容...`);
        const data = await u.db("o_script").whereIn("id", normalizedIds).select("content", "name");
        const text = data && data.length ? data.map((d) => `<scriptItem name="${d.name}">${d.content}</scriptItem>`).join("\n") : "";
        thinking.appendText(`获取到脚本内容:\n` + JSON.stringify(data, null, 2));
        thinking.updateTitle(`获取脚本内容完成`);
        thinking.complete();
        return text.trim() || "未找到对应的剧本内容，请检查剧本 ID。";
      },
    }),
  };
  return toolsNames ? Object.fromEntries(Object.entries(tools).filter(([n]) => toolsNames.includes(n))) : tools;
};

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? String(value);
}
