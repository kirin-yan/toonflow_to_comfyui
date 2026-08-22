import { Socket } from "socket.io";
import { stepCountIs, tool } from "ai";
import { z } from "zod";
import u from "@/utils";
import Memory from "@/utils/agent/memory";
import useTools from "@/agents/scriptAgent/tools";
import ResTool from "@/socket/resTool";
import * as fs from "fs";
import path from "path";

export interface AgentContext {
  socket: Socket;
  isolationKey: string;
  text: string;
  userMessageTime?: number;
  abortSignal?: AbortSignal;
  resTool: ResTool;
  msg: ReturnType<ResTool["newMessage"]>;
}

function buildMemPrompt(mem: Awaited<ReturnType<Memory["get"]>>): string {
  let memoryContext = "";
  if (mem.rag.length) {
    memoryContext += `[相关记忆]\n${mem.rag.map((r) => r.content).join("\n")}`;
  }
  if (mem.summaries.length) {
    if (memoryContext) memoryContext += "\n\n";
    memoryContext += `[历史摘要]\n${mem.summaries.map((s, i) => `${i + 1}. ${s.content}`).join("\n")}`;
  }
  if (mem.shortTerm.length) {
    if (memoryContext) memoryContext += "\n\n";
    memoryContext += `[近期对话]\n${mem.shortTerm.map((m) => `${m.role}: ${m.content}`).join("\n")}`;
  }
  return `## Memory\n以下是你对用户的记忆，可作为参考但不要主动提及：\n${memoryContext}`;
}

export async function decisionAI(ctx: AgentContext) {
  const { isolationKey, text, userMessageTime, abortSignal, resTool } = ctx;

  const memory = new Memory("scriptAgent", isolationKey);
  await memory.add("user", text, { createTime: userMessageTime });

  const skill = path.join(u.getPath("skills"), "script_agent_decision.md");
  const prompt = await fs.promises.readFile(skill, "utf-8");

  const mem = buildMemPrompt(await memory.get(text));

  const projectData = await u.db("o_project").where("id", resTool.data.projectId).first();

  const novelData = await u.db("o_novel").where("projectId", resTool.data.projectId).select("chapterIndex");

  const projectInfo = [
    "## 项目信息",
    `小说名称：${projectData?.name ?? "未知"}`,
    `小说类型：${projectData?.type ?? "未知"}`,
    `小说简介：${projectData?.intro ?? "无"}`,
    `目标改编影视视觉手册|画风：${projectData?.artStyle ?? "无"}`,
    `目标改编视频画幅：${projectData?.videoRatio ?? "16:9"}`,
    `章节数量：${novelData.length}章`,
  ].join("\n");

  const { textStream } = await u.Ai.Text("scriptAgent").stream({
    messages: [
      { role: "system", content: prompt },
      { role: "assistant", content: projectInfo + "\n" + mem },
      { role: "user", content: text },
    ],
    abortSignal,
    tools: {
      ...memory.getTools(),
      ...useTools({ resTool: ctx.resTool, msg: ctx.msg }),
      ...createSubAgent(ctx),
    },
    stopWhen: stepCountIs(24),
    onFinish: async (completion) => {
      await memory.add("assistant:decision", removeAllXmlTags(completion.text));
    },
  });

  return textStream;
}

function createSubAgent(parentCtx: AgentContext) {
  const { resTool, abortSignal } = parentCtx;
  const memory = new Memory("scriptAgent", parentCtx.isolationKey);
  let storySkeletonStarted = false;

  async function runAgent({
    prompt,
    system,
    name,
    memoryKey,
    tools: extraTools,
    toolNames,
    maxSteps,
    messages,
  }: {
    prompt: string;
    system: string;
    name: string;
    memoryKey: string;
    tools?: Record<string, any>;
    toolNames?: string[];
    maxSteps?: number;
    messages?: { role: "user" | "assistant" | "system"; content: string }[];
  }) {
    parentCtx.msg.complete();
    const subMsg = resTool.newMessage("assistant", name);
    const text = subMsg.text();
    let fullResponse = "";

    const { textStream } = await u.Ai.Text("scriptAgent").stream({
      system,
      messages: messages ?? [{ role: "user", content: prompt }],
      abortSignal,
      tools: { ...extraTools, ...useTools({ resTool, msg: subMsg, toolsNames: toolNames }) },
      ...(maxSteps && { stopWhen: stepCountIs(maxSteps) }),
    });

    try {
      for await (const chunk of textStream) {
        await new Promise<void>((resolve) => setTimeout(() => resolve(), 1));
        text.append(chunk);
        fullResponse += chunk;
      }
      text.complete();
      subMsg.complete();
    } catch (err: any) {
      text.complete();
      subMsg.stop();
      throw err;
    }

    if (fullResponse.trim()) {
      await memory.add(memoryKey, removeAllXmlTags(fullResponse), {
        name,
        createTime: new Date(subMsg.datetime).getTime(),
      });
    }

    parentCtx.msg = resTool.newMessage("assistant", "视频策划");
    return fullResponse;
  }

  const promptInput = z.object({
    prompt: z.string().describe("交给子Agent的任务简约描述，100字以内"),
  });

  const run_sub_agent_storySkeleton = tool({
    description: "运行执行subAgent来完成故事骨架相关任务",
    inputSchema: promptInput,
    execute: async ({ prompt }) => {
      if (storySkeletonStarted) {
        throw new Error("本轮故事骨架子任务已经执行过，请使用已有结果继续，不要重复启动故事骨架生成。");
      }
      storySkeletonStarted = true;
      await assertNovelEventsReady(resTool.data.projectId);

      const skill = path.join(u.getPath("skills"), "script_execution_skeleton.md");
      const systemPrompt = await fs.promises.readFile(skill, "utf-8");

      const formatPrompt = "\n你必须使用如下XML格式写入工作区：\n<storySkeleton>故事骨架内容</storySkeleton>";

      return runAgent({
        prompt,
        system: systemPrompt + formatPrompt,
        name: "编剧",
        memoryKey: "assistant:execution:storySkeleton",
        toolNames: ["get_novel_events", "get_novel_text", "get_planData"],
        maxSteps: 16,
        messages: [{ role: "user", content: prompt + formatPrompt }],
      });
    },
  });

  const run_sub_agent_adaptationStrategy = tool({
    description: "运行执行subAgent来完成改编策略相关任务",
    inputSchema: promptInput,
    execute: async ({ prompt }) => {
      const skill = path.join(u.getPath("skills"), "script_execution_adaptation.md");
      const systemPrompt = await fs.promises.readFile(skill, "utf-8");

      const formatPrompt = "\n你必须使用如下XML格式写入工作区：\n<adaptationStrategy>改编策略内容</adaptationStrategy>";

      return runAgent({
        prompt,
        system: systemPrompt + formatPrompt,
        name: "编剧",
        memoryKey: "assistant:execution:adaptationStrategy",
        maxSteps: 16,
        messages: [{ role: "user", content: prompt + formatPrompt }],
      });
    },
  });

  const run_sub_agent_script = tool({
    description: "运行执行subAgent来完成剧本相关任务",
    inputSchema: promptInput,
    execute: async ({ prompt }) => {
      const skill = path.join(u.getPath("skills"), "script_execution_script.md");
      const systemPrompt = await fs.promises.readFile(skill, "utf-8");

      const scriptList = await u.db("o_script").where("projectId", resTool.data.projectId).select("id", "name");
      const scriptPrompt = ["## 可用剧本(ID:名称)", scriptList.map((s: any) => `${s.id}:${(s.name || "").replace(/[,:]/g, "")}`).join(","), ""].join(
        "\n",
      );

      const novelData = await u.db("o_novel").where("projectId", resTool.data.projectId).select("chapterIndex");

      const formatPrompt = `\n你必须使用如下XML格式写入工作区：\nXML不得添加任何额外标签<scriptItem name="剧本名称">剧本内容</scriptItem><scriptItem name="剧本名称">剧本内容</scriptItem><scriptItem name="剧本名称">剧本内容</scriptItem>`;

      return runAgent({
        prompt,
        system: systemPrompt + formatPrompt,
        messages: [
          { role: "assistant", content: scriptPrompt + `章节数量：${novelData.length}章` },
          { role: "user", content: prompt + formatPrompt },
        ],
        name: "编剧",
        memoryKey: "assistant:execution:script",
        maxSteps: 24,
      });
    },
  });

  const run_supervision_agent = tool({
    description: "运行监督层subAgent执行独立任务，完成后返回结果",
    inputSchema: promptInput,
    execute: async ({ prompt }) => {
      const skill = path.join(u.getPath("skills"), "script_agent_supervision.md");
      const systemPrompt = await fs.promises.readFile(skill, "utf-8");

      return runAgent({
        prompt,
        system: systemPrompt,
        name: "编辑",
        memoryKey: "assistant:supervision",
        maxSteps: 12,
      });
    },
  });

  return {
    run_sub_agent_storySkeleton,
    run_sub_agent_adaptationStrategy,
    run_sub_agent_script,
    run_supervision_agent,
  };
}

async function assertNovelEventsReady(projectId: number) {
  const chapters = await u
    .db("o_novel")
    .where("projectId", projectId)
    .select("chapterIndex", "event", "eventState", "errorReason")
    .orderBy("chapterIndex", "asc");

  if (!chapters.length) {
    throw new Error("无法生成故事骨架：当前项目尚未导入小说章节。");
  }

  const pending = chapters.filter((chapter: any) => chapter.eventState === 0);
  if (pending.length) {
    throw new Error(`无法生成故事骨架：章节事件仍在生成中（${formatChapterIndexes(pending)}），请等待事件生成完成后重试。`);
  }

  const failed = chapters.filter((chapter: any) => chapter.eventState === -1 || !String(chapter.event ?? "").trim());
  if (failed.length) {
    const reasons = failed
      .map((chapter: any) => `第${chapter.chapterIndex}章${chapter.errorReason ? `：${chapter.errorReason}` : ""}`)
      .join("；");
    throw new Error(`无法生成故事骨架：以下章节事件生成失败或内容为空，请先重新生成章节事件：${reasons}`);
  }
}

function formatChapterIndexes(chapters: any[]) {
  return chapters.map((chapter) => `第${chapter.chapterIndex}章`).join("、");
}

function removeAllXmlTags(text: string): string {
  text = text.replace(/<([a-zA-Z][\w-]*)(\s+[^>]*)?>([\s\S]*?)<\/\1>/g, "");
  text = text.replace(/<([a-zA-Z][\w-]*)(\s+[^>]*)?\/>/g, "");
  text = text.replace(/<\/?[a-zA-Z][\w-]*(\s+[^>]*)?>/g, "");
  return text.trim();
}
