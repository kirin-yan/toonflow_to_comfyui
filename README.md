原项目地址：  https://github.com/HBAI-Ltd/Toonflow-app   
# Toonflow 对接 ComfyUI 改造日志

更新时间：2026-04-15

这份 README 不再是项目宣传页，而是当前这套 `Toonflow + ComfyUI` 接入方案的工程说明。目标是把 ComfyUI 作为 Toonflow 的图片和视频生成后端，并尽量少破坏 Toonflow 原有系统。

## 1. 这次改造解决了什么

目前 Toonflow 已经可以把 ComfyUI 当成一个供应商来调用，支持以下链路：

- 文生图
- 单图生图
- 多图生图
- 文生视频
- 单图生视频

其中，图片链路已经实际出图验证通过；视频链路已经完成配置接入和占位符校验，可以在 Toonflow 中直接使用。

## 2. 总体原理

这次不是把 ComfyUI 改造成 Toonflow，也不是让 Toonflow 去“接管”ComfyUI 的界面配置。

实际结构是：

1. Toonflow 负责业务流程、分镜、任务调度、供应商管理。
2. ComfyUI 负责执行具体工作流。
3. Toonflow 在运行时把工作流 JSON 当作 API prompt 发给 ComfyUI。
4. ComfyUI 返回输出文件后，Toonflow 再把结果回收进自己的流程。

也就是说：

- ComfyUI 是执行器。
- Toonflow 是编排层。
- 工作流的“源头”现在由 Toonflow 维护和投递。

这样做的好处是：

- 不需要改 Toonflow 现有的项目结构。
- 不需要把 ComfyUI 深度嵌进 Toonflow 前端。
- 只要维护好工作流 JSON 和供应商适配器，就能持续迭代。

## 3. 这次改了哪些地方

### 3.1 Toonflow 供应商层

新增并完善了 ComfyUI 供应商适配器：

- [data/vendor/comfyui.ts](E:/shortvideo/Toonflow/data/vendor/comfyui.ts)

主要能力：

- 调用 ComfyUI `/upload/image`
- 调用 ComfyUI `/prompt`
- 轮询 ComfyUI `/history/{prompt_id}`
- 自动把 Toonflow 参数替换进工作流 JSON
- 根据参考图数量自动选择不同 workflow

### 3.2 Toonflow 运行环境

为了让供应商脚本能正常上传文件，补了 VM 环境：

- [src/utils/vm.ts](E:/shortvideo/Toonflow/src/utils/vm.ts)

这里加入了 `Buffer`，否则 `FormData + base64` 上传会报错。

### 3.3 Toonflow 数据初始化与修复逻辑

为了让 `comfyui` 供应商能进入 Toonflow 的供应商表，改了：

- [src/lib/fixDB.ts](E:/shortvideo/Toonflow/src/lib/fixDB.ts)
- [src/lib/initDB.ts](E:/shortvideo/Toonflow/src/lib/initDB.ts)

作用：

- 初始化时创建 `comfyui` 供应商行
- 在修复逻辑里自动把 `data/vendor/comfyui.ts` 写入运行时供应商目录
- 保证数据库里 `inputValues` / `models` 结构可用

### 3.4 Toonflow 专用工作流副本

新增了一套 Toonflow 专用 workflow，

- [data/comfyui-workflows/anime/pic_from_text_toonflow.json](E:/shortvideo/Toonflow/data/comfyui-workflows/anime/pic_from_text_toonflow.json)
- [data/comfyui-workflows/anime/pic_from_1pic_toonflow.json](E:/shortvideo/Toonflow/data/comfyui-workflows/anime/pic_from_1pic_toonflow.json)
- [data/comfyui-workflows/anime/pic_from_3pic_toonflow.json](E:/shortvideo/Toonflow/data/comfyui-workflows/anime/pic_from_3pic_toonflow.json)
- [data/comfyui-workflows/anime/vedio_from_text_toonflow.json](E:/shortvideo/Toonflow/data/comfyui-workflows/anime/vedio_from_text_toonflow.json)
- [data/comfyui-workflows/anime/vedio_from_1pic_toonflow.json](E:/shortvideo/Toonflow/data/comfyui-workflows/anime/vedio_from_1pic_toonflow.json)


### 3.5 ComfyUI 运行时修补

为了解决 ComfyUI Manager / tqdm 导致的进度条报错，运行中的 ComfyUI 核心做过一次兼容性修补：

- `D:\Programs\ComfyUI\resources\ComfyUI\comfy\utils.py`

修改点：

- 把 `PROGRESS_BAR_ENABLED` 设为 `False`

目的：

- 避免某些 KSampler 执行时因为控制台进度条导致 `OSError 22`

注意：

- 这不是 Toonflow 仓库内的代码改动
- 这是当前机器上 ComfyUI 的运行时补丁

## 4. 工作流映射关系

当前 Toonflow 数据库里 `comfyui` 供应商使用的是下面这套映射：

| Toonflow 配置项 | 当前工作流 |
| --- | --- |
| `imageTextWorkflow` | `pic_from_text_toonflow.json` |
| `imageSingleReferenceWorkflow` | `pic_from_1pic_toonflow.json` |
| `imageMultiReferenceWorkflow` | `pic_from_3pic_toonflow.json` |
| `imageReferenceWorkflow` | `pic_from_3pic_toonflow.json` |
| `videoTextWorkflow` | `vedio_from_text_toonflow.json` |
| `videoReferenceWorkflow` | `vedio_from_1pic_toonflow.json` |

图像工作流选择逻辑：

- 无参考图：走 `imageTextWorkflow`
- 1 张参考图：优先走 `imageSingleReferenceWorkflow`
- 2～3 张参考图：走 `imageMultiReferenceWorkflow`
- 超过 3 张参考图：接口直接返回明确错误，不再上传后静默忽略

启动时会把 `data/comfyui-workflows/selfhost` 中的五个工作流合并到 `comfyui.inputValues`。已配置的 HTTP(S) 工作流 URL 保持不变；数据库中的内嵌 JSON 会随本地 selfhost 文件更新。

## 5. 这次增加的占位符与参数

### 5.1 常用占位符

ComfyUI 工作流里现在支持这些核心占位符：

- `{{prompt}}`
- `{{styledPrompt}}`
- `{{negativePrompt}}`
- `{{animeNegativePrompt}}`
- `{{width}}`
- `{{height}}`
- `{{seed}}`
- `{{filenamePrefix}}`
- `{{image1}}`
- `{{image2}}`
- `{{image3}}`
- `{{fps}}`
- `{{frames}}`

### 5.2 新增的动漫向供应商输入

现在 `comfyui` 供应商已经支持这些可调输入：

- `animePositivePrefix`
- `animeNegativePrompt`
- `textImageSteps`
- `textImageCfg`
- `videoImageCompression`
- `videoDecodeTileSize`
- `videoDecodeOverlap`
- `videoDecodeTemporalSize`
- `videoDecodeTemporalOverlap`

### 5.3 这些参数的作用

`animePositivePrefix`

- 给正向提示词统一加动漫风格前缀
- 当前默认值偏向漫画/赛璐璐/角色表现

`animeNegativePrompt`

- 统一压制写实感、糊图、脏背景、畸形手部

`textImageSteps`

- 控制文生图步数

`textImageCfg`

- 控制文生图提示词引导强度

`videoImageCompression`

- 控制单图生视频时图像预处理压缩强度

`videoDecodeOverlap`

- 控制视频 tiled decode 重叠量

`videoDecodeTileSize` / `videoDecodeTemporalSize`

- 控制 LTX 视频 VAE 的空间和时间分块大小
- 当前 12GB 显存配置默认使用 `256` / `64`

`videoDecodeTemporalOverlap`

- 控制视频时间维解码重叠量

## 6. 这次具体改了哪些工作流

### 6.1 文生图

文件：

- [pic_from_text_toonflow.json](E:/shortvideo/Toonflow/data/comfyui-workflows/anime/pic_from_text_toonflow.json)

改动：

- 正向提示词改为 `{{styledPrompt}}`
- 使用零化负向条件，符合 Z-Image Turbo 无 CFG 负向提示词的运行方式
- 步数改为 `{{textImageSteps}}`
- CFG 改为 `{{textImageCfg}}`
- 分辨率改为 `{{width}}` / `{{height}}`
- 输出前缀改为 `{{filenamePrefix}}`
- seed 改为 `{{seed}}`
- 保留 FLUX.2 Klein Base 模型，采样改为 50 步、CFG 4
- 输入图按 `{{width}}` / `{{height}}` 缩放，接口尺寸不再被忽略

### 6.2 单图生图

文件：

- [pic_from_1pic_toonflow.json](E:/shortvideo/Toonflow/data/comfyui-workflows/anime/pic_from_1pic_toonflow.json)

改动：

- 输入图改为 `{{image1}}`
- 正向提示词改为 `{{styledPrompt}}`
- 新增动漫负面提示词编码
- seed 改为 `{{seed}}`
- 输出前缀改为 `{{filenamePrefix}}`
- 删除原来多余的一个 `LoadImage` 冗余节点

### 6.3 多图生图

文件：

- [pic_from_3pic_toonflow.json](E:/shortvideo/Toonflow/data/comfyui-workflows/anime/pic_from_3pic_toonflow.json)

改动：

- 支持 `{{image1}}`、`{{image2}}`、`{{image3}}`
- 新增第二、第三张图的缩放、VAE 编码和 ReferenceLatent 链
- 正向提示词改为 `{{styledPrompt}}`
- 负向提示词改为 `{{animeNegativePrompt}}`
- 改为复用 `flux-2-klein-base-4b-fp8.safetensors`、Qwen 4B FP8 文本编码器和 Flux2 VAE
- 使用 50 步、CFG 4，避免加载 Qwen-Image 20B
- 两张参考图时动态旁路第三图 ReferenceLatent，不再复制第二张图
- 三张输入图统一按 `{{width}}` / `{{height}}` 缩放
- seed 改为 `{{seed}}`
- 输出前缀改为 `{{filenamePrefix}}`

### 6.4 文生视频

文件：

- [vedio_from_text_toonflow.json](E:/shortvideo/Toonflow/data/comfyui-workflows/anime/vedio_from_text_toonflow.json)

改动：

- 正向提示词改为 `{{styledPrompt}}`
- 新增负向提示词节点 `{{animeNegativePrompt}}`
- 帧率、帧数、宽高改为占位符
- tiled decode overlap 改为可配置
- 输出前缀改为 `{{filenamePrefix}}`

### 6.5 单图生视频

文件：

- [vedio_from_1pic_toonflow.json](E:/shortvideo/Toonflow/data/comfyui-workflows/anime/vedio_from_1pic_toonflow.json)

改动：

- 输入图改为 `{{image1}}`
- 正向提示词改为 `{{styledPrompt}}`
- 负向提示词改为 `{{animeNegativePrompt}}`
- `img_compression` 改为 `{{videoImageCompression}}`
- `overlap` 改为 `{{videoDecodeOverlap}}`
- `temporal_overlap` 改为 `{{videoDecodeTemporalOverlap}}`
- 帧率、帧数、宽高改为占位符
- seed 改为 `{{seed}}`
- 输出前缀改为 `{{filenamePrefix}}`

## 7. 当前默认配置

当前数据库里的 `comfyui` 输入值默认如下：

```json
{
  "baseUrl": "http://127.0.0.1:8188",
  "animePositivePrefix": "anime style, manga aesthetic, clean lineart, cel shading, expressive characters, cinematic composition",
  "animeNegativePrompt": "photorealistic, realistic skin, 3d render, blurry, low detail, low quality, ugly, distorted anatomy, extra fingers, bad hands, messy background",
  "negativePrompt": "photorealistic, realistic skin, 3d render, blurry, low detail, low quality, ugly, distorted anatomy, extra fingers, bad hands, messy background",
  "textImageSteps": "8",
  "textImageCfg": "1.0",
  "videoImageCompression": "14",
  "videoDecodeTileSize": "256",
  "videoDecodeOverlap": "64",
  "videoDecodeTemporalSize": "64",
  "videoDecodeTemporalOverlap": "8",
  "timeoutMs": "3600000"
}
```

### 7.1 RTX 3060 12GB 硬件范围

- 图片：仅开放 `1K`，`2K` / `4K` 会返回明确错误
- 视频：`480p` 支持 1～5 秒，`720p` 支持 1～3 秒
- `1080p` 不开放，避免工作流进入高概率 OOM 状态
- 三套图片工作流的文本编码器固定在 CPU，以给扩散模型保留显存
- 两套视频工作流使用 `256` 空间分块和 `64` 时间分块

## 8. 使用方法

### 8.1 启动顺序

1. 先启动 ComfyUI，端口保持 `8000`；12GB 显存建议附加 `--lowvram --preview-method none --cache-none --reserve-vram 1`
2. 再启动 Toonflow，端口保持 `10588`
3. 登录 Toonflow
4. 确认供应商 `comfyui` 已启用

### 8.2 当前访问地址

- Toonflow: `http://localhost:10588`
- ComfyUI: `http://127.0.0.1:8188`

### 8.3 Toonflow 中的工作流使用方式

在 Toonflow 中选择 `comfyui` 作为图片或视频供应商后：

- 文生图会自动走 `pic_from_text_toonflow.json`
- 单图参考会自动走 `pic_from_1pic_toonflow.json`
- 多图参考会自动走 `pic_from_3pic_toonflow.json`
- 文生视频会自动走 `vedio_from_text_toonflow.json`
- 单图生视频会自动走 `vedio_from_1pic_toonflow.json`

你不需要再手动把这套 JSON 导入 ComfyUI 才能让 Toonflow 使用。

### 8.4 如果要继续调风格

优先调这几个参数：

1. `animePositivePrefix`
2. `animeNegativePrompt`
3. `textImageCfg`
4. `videoImageCompression`

这 4 个参数最直接影响动漫感、人物质感和视频清晰度。

## 9. 已完成的验证

### 9.1 文生图验证

成功：

- `prompt_id = 2d0862fd-ab09-4134-b4a4-750fe34dd4b0`
- 输出文件：`C:\comfyui\output\codex-anime-text-validate_00001_.png`

### 9.2 单图生图验证

成功：

- `prompt_id = 6dd5add8-c734-4378-a06c-75bac770aa9e`
- 输出文件：`C:\comfyui\output\codex-anime-1img-validate_00001_.png`

### 9.3 三图生图验证

成功：

- `prompt_id = a2202381-e374-48a4-98bf-4254b79be537`
- 输出文件：`C:\comfyui\output\codex-anime-3img-validate_00001_.png`

### 9.4 视频链路验证

当前状态：

- 文生视频、单图生视频已完成 Toonflow 接入
- 占位符替换和 workflow 结构校验通过
- 这次没有做完整视频长跑验证，主要是为了避免长时间占用 GPU

## 10. 当前已知取舍

### 10.1 为什么没有大改模型体系

这次优先目标是“先让 Toonflow 稳定接上 ComfyUI”。

所以策略是：

- 先保留你已有的工作流体系
- 先把 Toonflow 调用链打通
- 再逐步做动漫向优化

而不是一上来就把所有 UNET / VAE / LoRA / Video model 全换掉。

这样风险更小，也更适合后面继续迭代。

### 10.2 为什么保留原始桌面工作流

因为原始 JSON 还有两个作用：

- 便于你直接在 ComfyUI 里手调
- 便于后续重新导出 API workflow

所以现在采用的是“双轨”：

- 桌面原始工作流：你手工调试用
- Toonflow 专用工作流：业务运行用

## 11. 后续建议

如果目标是 AI 漫剧，后面建议按这个顺序继续优化：

1. 先把 `pic_from_3pic` 做成角色一致性主链
2. 再把 `vedio_from_1pic` 调成镜头动画主链
3. 文生视频只保留为快速预演链路
4. 建立一套固定的动漫提示词模板
5. 后续再评估是否替换视频模型或增加轻量 / 高质量双模式

## 12. 回滚方法

如果要回到改造前状态，可以按下面处理：

1. 恢复 `o_vendorConfig` 里 `comfyui.inputValues` 的 workflow 字段
2. 恢复 [data/vendor/comfyui.ts](E:/shortvideo/Toonflow/data/vendor/comfyui.ts)
3. 删除 [data/comfyui-workflows/anime](E:/shortvideo/Toonflow/data/comfyui-workflows/anime)
4. 如有需要，恢复 ComfyUI 的 `comfy/utils.py`

## 13. 当前结论

这次接入已经达到“可用”状态，且改动集中在：

- 供应商适配层
- 工作流副本层
- 数据库配置层

没有去重构 Toonflow 主业务流，也没有侵入式改 ComfyUI 的项目结构。

这套方案适合继续往“动漫效果优先、AI 漫剧生产链”方向迭代。
