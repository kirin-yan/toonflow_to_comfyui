import jwt from "jsonwebtoken";
import u from "@/utils";
import { Namespace, Socket } from "socket.io";
import * as agent from "@/agents/productionAgent/index";
import ResTool from "@/socket/resTool";

async function verifyToken(rawToken: string): Promise<Boolean> {
  const setting = await u.db("o_setting").where("key", "tokenKey").select("value").first();
  if (!setting) return false;
  const { value: tokenKey } = setting;
  if (!rawToken) return false;
  const token = rawToken.replace("Bearer ", "");
  try {
    jwt.verify(token, tokenKey as string);
    return true;
  } catch (err) {
    return false;
  }
}

export default (nsp: Namespace) => {
  nsp.on("connection", async (socket: Socket) => {
    const token = socket.handshake.auth.token;
    if (!token || !(await verifyToken(token))) {
      console.log("[productionAgent] 连接失败，token无效");
      socket.disconnect();
      return;
    }
    let isolationKey = socket.handshake.auth.isolationKey;
    if (!isolationKey) {
      console.log("[productionAgent] 连接失败，缺少 isolationKey");
      socket.disconnect();
      return;
    }

    console.log("[productionAgent] 已连接:", socket.id);

    let resTool = new ResTool(socket, {
      projectId: socket.handshake.auth.projectId,
      scriptId: socket.handshake.auth.scriptId,
    });
    let abortController: AbortController | null = null;

    socket.on("updateContext", (data: { isolationKey: string; projectId: number; scriptId: number }, callback) => {
      isolationKey = data.isolationKey;
      resTool = new ResTool(socket, {
        projectId: data.projectId,
        scriptId: data.scriptId,
      });
      console.log("[productionAgent] 上下文已更新:", isolationKey);
      callback?.({ success: true });
    });

    socket.on("chat", async (data: { content: string }) => {
      const { content } = data;
      abortController?.abort();
      abortController = new AbortController();
      const currentController = abortController;

      const msg = resTool.newMessage("assistant", "视频策划");
      const ctx: agent.AgentContext = {
        socket,
        isolationKey,
        text: content,
        userMessageTime: new Date(msg.datetime).getTime() - 1,
        abortSignal: currentController.signal,
        resTool,
        msg,
      };

      try {
        const textStream = await agent.decisionAI(ctx);

        let currentMsg = ctx.msg;
        let text = currentMsg.text();

        const syncCurrentMessage = () => {
          if (ctx.msg === currentMsg) return;
          text.complete();
          currentMsg.complete();
          currentMsg = ctx.msg;
          text = currentMsg.text();
        };

        let aborted = false;
        try {
          for await (const chunk of textStream) {
            await new Promise<void>((resolve) => setTimeout(() => resolve(), 1));
            syncCurrentMessage();
            text.append(chunk);
          }
        } catch (err: any) {
          if (err.name === "AbortError" || currentController.signal.aborted) {
            aborted = true;
          } else {
            throw err;
          }
        } finally {
          syncCurrentMessage();
          if (aborted) {
            text.append("[已停止]");
            text.complete();
            currentMsg.stop();
          } else {
            text.complete();
            currentMsg.complete();
          }
        }
      } catch (err: any) {
        if (err.name !== "AbortError" && !currentController.signal.aborted) {
          const errorMsg = u.error(err).message;
          console.error("[productionAgent] chat error:", errorMsg);
          ctx.msg.text(errorMsg).complete();
          ctx.msg.error();
        }
      } finally {
        if (abortController === currentController) {
          abortController = null;
        }
      }
    });

    socket.on("stop", () => {
      abortController?.abort();
      abortController = null;
    });

    // 分镜图片生成
    socket.on(
      "generateStoryboard",
      async (data: { ids: number[] }, callback) => {
        console.log("[productionAgent] generateStoryboard 收到请求:", data);
        try {
          const { ids } = data;
          const { projectId, scriptId } = resTool.data;

          if (!ids || !Array.isArray(ids) || ids.length === 0) {
            callback?.({ error: "分镜ID列表不能为空" });
            return;
          }

          // 获取项目设置
          const projectSettingData = await u
            .db("o_project")
            .where("id", projectId)
            .select("imageModel", "imageQuality", "artStyle", "videoRatio")
            .first();

          // 获取分镜数据
          const storyboardData = await u
            .db("o_storyboard")
            .where("scriptId", scriptId)
            .whereIn("id", ids);

          // 获取关联资产
          const assetData = await u
            .db("o_assets")
            .leftJoin("o_assets2Storyboard", "o_assets.id", "o_assets2Storyboard.assetId")
            .whereIn("o_assets2Storyboard.storyboardId", ids)
            .select("o_assets2Storyboard.storyboardId", "o_assets.imageId");

          const assetRecord: Record<number, number[]> = {};
          assetData.forEach((item: any) => {
            if (!assetRecord[item.storyboardId]) {
              assetRecord[item.storyboardId] = [];
            }
            assetRecord[item.storyboardId].push(item.imageId);
          });

          // 更新分镜状态为"生成中"
          await u
            .db("o_storyboard")
            .whereIn("id", ids)
            .where("scriptId", scriptId)
            .where("shouldGenerateImage", 1)
            .update({ state: "生成中" });

          // 获取资产图片的Base64
          const getAssetsImageBase64 = async (imageIds: number[]) => {
            if (!imageIds.length) return [];
            const imagePaths = await u
              .db("o_image")
              .whereIn("o_image.id", imageIds)
              .select("o_image.id", "o_image.filePath");
            const id2Path = new Map<number, string>();
            for (const row of imagePaths) {
              id2Path.set(row.id, row.filePath);
            }
            const imageUrls = await Promise.all(
              imageIds.map(async (id) => {
                const filePath = id2Path.get(id);
                if (filePath) {
                  try {
                    const { urlToBase64 } = await import("@/utils/vm");
                    return await urlToBase64(await u.oss.getFileUrl(filePath));
                  } catch {
                    return null;
                  }
                }
                return null;
              }),
            );
            return (imageUrls.filter(Boolean) as string[]).map((url) => ({
              type: "image" as const,
              base64: url,
            }));
          };

          // 逐个生成分镜图片
          const generateList = storyboardData.filter(
            (item) => item.shouldGenerateImage !== 0,
          );
          const results: any[] = [];

          for (const item of generateList) {
            try {
              const repeloadObj = {
                prompt: item.prompt!,
                size: (projectSettingData?.imageModel?.startsWith("comfyui:") ? "1K" : projectSettingData?.imageQuality) as "1K" | "2K" | "4K",
                aspectRatio: projectSettingData?.videoRatio as `${number}:${number}`,
              };

              const imageResult = await u.Ai.Image(
                projectSettingData?.imageModel as `${string}:${string}`,
              )
                .run({
                  referenceList: (await getAssetsImageBase64(assetRecord[item.id!] || [])).slice(0, 3),
                  ...repeloadObj,
                })
                .then(async (imageCls: any) => {
                  const savePath = `/${projectId}/assets/${scriptId}/${u.uuid()}.jpg`;
                  await imageCls.save(savePath);
                  await u.db("o_storyboard").where("id", item.id).update({
                    filePath: savePath,
                    state: "已完成",
                  });
                  return { id: item.id, success: true, filePath: savePath };
                });

              results.push(imageResult);
            } catch (e: any) {
              await u
                .db("o_storyboard")
                .where("id", item.id)
                .update({
                  filePath: "",
                  reason: u.error(e).message,
                  state: "生成失败",
                });
              results.push({ id: item.id, success: false, error: u.error(e).message });
            }
          }

          console.log("[productionAgent] generateStoryboard 完成:", results);
          callback?.({ success: true, results });
        } catch (err: any) {
          console.error("[productionAgent] generateStoryboard 错误:", err);
          callback?.({ error: u.error(err).message });
        }
      },
    );
  });
  nsp.on("disconnect", (socket: Socket) => {
    console.log("[productionAgent] 已断开连接:", socket.id);
  });
};
