# 🚀 宇宙无敌表达训练系统 - 本地桌面版

> 👉 **在线版已上线：[exprtrain.online](https://exprtrain.online)**，无需安装，打开浏览器即用。支持中英双语。

一个帮你训练口语表达精准度的本地桌面应用。实时语音识别 → 词库匹配 → AI反馈，全程离线+本地处理。

## 功能

- 🌐 **中 / 英双语练习**：右上角「中 / EN」一键切换；英文模式下词库、字幕高亮、实时提示和分析报告全部切换为英文（见下方「英文模式」）
- 🎤 **实时语音识别**：基于 Sherpa-ONNX，完全离线，中英双语模型
- 📝 **全屏字幕显示**：黑底大字，实时显示你说的每一句话
- 🔍 **词库分析**：自动检测填充词、犹豫词、笼统词，给出精准替代
- 🤖 **AI反馈**：支持 Groq/OpenAI/DeepSeek/Ollama 多后端
- 📊 **分析报告**：6维度深度分析（逻辑/直接性/填充词/密度/词汇/亮点）

## 安装

### 1. 克隆项目 & 安装依赖

```bash
cd expression-trainer
npm install
```

### 2. 下载语音识别模型

需要下载 Sherpa-ONNX 的 streaming paraformer 中英双语模型：

```bash
cd models

# 方法一：使用 wget
wget https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-paraformer-bilingual-zh-en.tar.bz2
tar xvf sherpa-onnx-streaming-paraformer-bilingual-zh-en.tar.bz2

# 方法二：使用 huggingface
# https://huggingface.co/csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en
```

下载后 `models/` 目录应包含：
```
models/
└── sherpa-onnx-streaming-paraformer-bilingual-zh-en/
    ├── encoder.int8.onnx
    ├── decoder.int8.onnx
    └── tokens.txt
```
### 3. 启动应用

```bash
npm start
```

### 4. 配置 AI 后端

启动后点击右上角 ⚙️ 进入设置页面。

推荐配置：

| 后端 | 费用 | 速度 | 获取方式 |
|------|------|------|----------|
| DeepSeek | 极低 | 快 | [platform.deepseek.com](https://platform.deepseek.com) |
| OpenAI | 中等 | 快 | [platform.openai.com](https://platform.openai.com) |
| Ollama | 免费 | 取决于硬件 | [ollama.com](https://ollama.com) 本地运行 |

**推荐 deepseek**：生成报告质量高，且成本极低。

## 使用说明

1. **点击「开始录制」** → 对着麦克风说话
2. **实时字幕**会在屏幕中央显示你说的内容
3. **左侧面板**实时统计填充词/犹豫词/笼统词
4. **右侧面板**每50字会给出AI实时反馈
5. **说完后点击「结束」** → 可以点「生成报告」获取完整分析

## 英文模式

在主界面右上角点「中 / EN」或在设置页选择 Practice language，即可切换到英文练习：

- **词库**：`data/english-lexicon.json`，按整词 / 短语匹配（大小写不敏感，支持多词短语如 `you know`、`a little bit`、`at the end of the day`）
  - 填充词 28 个：um, uh, like, you know, I mean, basically, actually, kind of, sort of, honestly…
  - 犹豫词 31 个：I think, I guess, maybe, probably, it seems like, a bit, somewhat, to some extent, I'm not sure but…
  - 笼统词 → 精准词 36 组：good → effective / rigorous / compelling；a lot → dozens of / roughly 80%；thing → factor / mechanism…
  - 情绪词 42 个，带类别和强度
  - `like` 只在口头禅位置（"it was like, um"）才算填充词，作动词 / 介词（"I like it"、"like this one"）不标记
- **实时提示**：英文教练 prompt，每次一条 ≤ 6 词；在中文版规则之外额外加了语法错误和不地道表达的即时纠正
- **分析报告**：英文版六维报告，多一节「Language accuracy」表格，列出语法 / 搭配 / 语序问题和地道说法
- **语音识别**：英文模式按以下优先级自动选模型，没下载时退回下一档（退到双语模型时会在反馈栏提示）：
  1. NVIDIA NeMo 流式 FastConformer（推荐，训练数据广、对非母语口音友好，约 470 MB）
  2. Sherpa 英文 zipformer（只用有声书训练，口音适应性一般，约 300 MB）
  3. 中英双语 paraformer（中文模式用的那个）

```bash
cd models
wget https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-streaming-fast-conformer-transducer-en-480ms.tar.bz2
tar xvf sherpa-onnx-nemo-streaming-fast-conformer-transducer-en-480ms.tar.bz2
```

## 字幕颜色含义

| 颜色 | 含义 |
|------|------|
| 🔴 红色波浪下划线 | 填充词（嗯、啊、那个、然后…） |
| 🟠 橙色 | 犹豫词（可能、也许、我觉得…） |
| 🟡 黄色虚线 | 笼统词（有精准替代建议） |
| 🟢 绿色 | 有力表达（好句子！） |

## 技术架构

```
┌─────────────────────────────────────────┐
│ Electron 主进程                          │
│  ├── Sherpa-ONNX (离线语音识别)          │
│  ├── 词库匹配 (emotion-lexicon.json)     │
│  └── AI反馈 (多后端 HTTP API)            │
├─────────────────────────────────────────┤
│ 渲染进程 (Chromium)                      │
│  ├── 全屏字幕显示                        │
│  ├── 实时统计面板                        │
│  └── 分析报告弹窗                        │
└─────────────────────────────────────────┘
```

## 词库说明

`data/emotion-lexicon.json` 基于大连理工情感词库7大类结构，包含：

- **130+ 情绪词**：分类（喜怒哀惧恶惊）+ 强度（1-9）
- **笼统词→精准词映射**：25组高频替代建议
- **填充词表**：24个常见口头禅
- **犹豫词表**：19个弱化表达
- **程度词梯度**：弱→中→强→极 四级
- **画面化描述**：10组「抽象→具象」转换
- **犹豫→直接转换**：8组对照示例

## 开发

```bash
# 开发模式（带DevTools）
npm run dev

# 目录结构
├── main.js              # Electron主进程
├── preload.js           # preload脚本
├── src/
│   ├── index.html       # 主界面
│   ├── settings.html    # 设置页
│   ├── styles.css       # 样式
│   ├── app.js           # 前端逻辑
│   └── settings.js      # 设置逻辑
├── lib/
│   ├── asr.js           # 语音识别
│   ├── lexicon.js       # 词库匹配
│   ├── ai-feedback.js   # AI反馈
│   └── prompts.js       # Prompt模板
├── data/
│   ├── emotion-lexicon.json   # 中文情感词库
│   └── english-lexicon.json   # 英文词库
└── models/              # Sherpa-ONNX模型（需下载）
```

## 系统要求

- macOS 12+ / Windows 10+ / Linux
- Node.js 18+
- 麦克风权限
- （可选）网络连接（用于AI反馈，词库分析可离线）

## License

MIT

