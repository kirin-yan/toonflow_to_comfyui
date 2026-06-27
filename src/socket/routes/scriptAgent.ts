import jwt from "jsonwebtoken";
import u from "@/utils";
import { Namespace, Socket } from "socket.io";
import * as agent from "@/agents/scriptAgent/index";
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
      console.log("[scriptAgent] 连接失败，token无效");
      socket.disconnect();
      return;
    }
    const isolationKey = socket.handshake.auth.isolationKey;
    if (!isolationKey) {
      console.log("[scriptAgent] 连接失败，缺少 isolationKey");
      socket.disconnect();
      return;
    }

    console.log("[scriptAgent] 已连接:", socket.id);

    const resTool = new ResTool(socket, {
      projectId: socket.handshake.auth.projectId,
    });
    let abortController: AbortController | null = null;

    socket.on("chat", async (data: { content: string }) => {
      const { content } = data;
      abortController?.abort();
      abortController = new AbortController();
      const currentController = abortController;

      const msg = resTool.newMessage("assistant", "统筹");
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
          console.error("[scriptAgent] chat error:", errorMsg);
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
  });
  nsp.on("disconnect", (socket: Socket) => {
    console.log("[scriptAgent] 已断开连接:", socket.id);
  });
};
