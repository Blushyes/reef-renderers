# Reef Renderers

Reef 外部 renderer 源码仓库。

## Script Editor

`script-editor/` 包含剧本阅读器和完整构建源码，支持梗概、人物造型参考帧、台词翻译及源视频关联。

```sh
cd script-editor
npm ci
npm run build
npm run check
npm test
```

构建产物：`script-editor/.reef-build/script-editor/`。安装到本机 Reef：在 `script-editor/` 执行 `npm run install:renderer`。构建环境、运行依赖和修改入口见 [Script Editor README](script-editor/README.md)。

本地归档 `.local-archives/` 不纳入 Git，保存迁入前的目录、已发送的 ZIP 和安装副本备份。
