import { Request, Response } from "express";
import fs from 'fs';
import path from 'path';

// 获取ComfyUI工作流列表
export default async function (req: Request, res: Response) {
  try {
    const workflowsDir = path.join(process.cwd(), 'data', 'comfyui-workflows');

    // 检查目录是否存在
    if (!fs.existsSync(workflowsDir)) {
      return res.status(404).json({
        success: false,
        message: "ComfyUI工作流目录不存在"
      });
    }

    // 读取所有子目录作为工作流类型
    const workflowTypes = fs.readdirSync(workflowsDir)
      .filter(item =>
        fs.statSync(path.join(workflowsDir, item)).isDirectory()
      );

    // 获取每个工作流类型的文件列表
    const workflows: any[] = [];

    for (const type of workflowTypes) {
      const typePath = path.join(workflowsDir, type);
      if (!fs.existsSync(typePath)) continue;

      const files = fs.readdirSync(typePath)
        .filter(file =>
          file.endsWith('.json') &&
          fs.statSync(path.join(typePath, file)).isFile()
        )
        .map(file => ({
          name: path.basename(file, '.json'),
          fileName: file,
          type: type,
          content: fs.readFileSync(path.join(typePath, file), 'utf-8')
        }));

      workflows.push(...files);
    }

    res.json({
      success: true,
      data: {
        workflowTypes: workflowTypes,
        workflows: workflows
      }
    });
  } catch (error) {
    console.error('获取ComfyUI工作流列表失败:', error);
    res.status(500).json({
      success: false,
      message: "服务器内部错误"
    });
  }
}
