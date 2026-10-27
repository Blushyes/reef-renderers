# Reef Script Editor

Reef 的剧本 renderer，支持梗概、人物造型参考帧、台词翻译和源视频关联。

## 开发

需要 Node.js >= 22.12，以及提供 Swift 编译器和 macOS 26 SDK 的 Xcode / Command Line Tools。

```sh
npm ci
npm run build
npm run check
npm test
```

底层编辑器直接使用 npm 发布的 `@lingjingai/script-editor@0.9.2`。本工程只维护 renderer 的接入和功能逻辑。

- `src/preview.tsx`、`src/reader.css`：界面与样式。
- `src/video.tsx`、`video-source.mjs`、`src/video-suggestions.ts`：播放、时间戳定位、视频关联与目录建议。
- `src/story.ts`、`src/evidence.ts`：梗概及原片参考数据。
- `src/service.ts`、`src/*translation*.ts`、`native/translate/main.swift`：本机服务和翻译。
- `renderer.mjs`、`renderer.json`、`launch.sh`：Reef 协议入口。
- `scripts/`：构建；`tests/`：集成与目录推荐测试。

## 安装与分发

构建产物在 `.reef-build/script-editor/`。执行 `npm run install:renderer` 安装到本机 Reef，或将产物目录压缩后交给其他人导入。分发只需要产物目录内的 8 个文件，不需要源码、node_modules 或构建缓存。

运行时需要 Node.js。抽帧及其集成测试需要本机 scriptctl（支持 evidence 命令）、FFmpeg 和 ffprobe。台词翻译需要 macOS 26 及对应语言包。操作说明见 [USAGE.md](USAGE.md)。
