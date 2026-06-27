import express from "express";
import z from "zod";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import fs from "fs";
import axios from "axios";
import compressing from "compressing";
import { success } from "@/lib/responseFormat";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    url: z.url(),
    reinstall: z.boolean(),
    version: z.string(),
  }),
  async (req, res) => {
    const { reinstall, url, version } = req.body;
    if (reinstall) {
      res.status(200).send(success("请在浏览器中手动下载并安装最新版本"));
    } else {
      const rootDir = u.getPath(["temp"]);
      fs.mkdirSync(rootDir, { recursive: true });
      const zip = await axios.get(url, { responseType: "arraybuffer" }).then((res) => res.data);
      fs.writeFileSync(`${rootDir}/latest.zip`, zip);
      await compressing.zip.uncompress(`${rootDir}/latest.zip`, rootDir);
      const tempServerPath = u.getPath(["temp", "serve"]);
      if (fs.existsSync(tempServerPath)) {
        fs.cpSync(tempServerPath, u.getPath(["serve"]), { recursive: true, force: true });
      }
      const webPath = u.getPath(["temp", "web"]);
      if (fs.existsSync(webPath)) {
        fs.cpSync(webPath, u.getPath(["web"]), { recursive: true, force: true });
      }
      const tempSkillsPath = u.getPath(["temp", "skills"]);
      if (fs.existsSync(tempSkillsPath)) {
        fs.cpSync(tempSkillsPath, u.getPath(["skills"]), { recursive: true, force: true });
      }
      const tempModelsPath = u.getPath(["temp", "models"]);
      if (fs.existsSync(tempModelsPath)) {
        fs.cpSync(tempModelsPath, u.getPath(["models"]), { recursive: true, force: true });
      }
      fs.rmSync(rootDir, { recursive: true, force: true });
      res.status(200).send(success(`更新${version}成功，5秒后重启`));
    }
  },
);
