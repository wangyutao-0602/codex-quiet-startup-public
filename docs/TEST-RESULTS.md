# 静态人物版测试

本机已执行结果与未验证项见 [macOS 验证记录](MAC-ACCEPTANCE.md)。

## 核心与渲染

在仓库根目录运行：

```bash
npm ci
npm test
npm run test:render
```

渲染测试验证固定人物图片及其位置、五阶段时间轴、轮廓提取、完成后停止回调和原生交接消息。输出位于 `.build/render-check/`。模拟 DOM 的 Canvas 测试不能替代真实浏览器或 macOS 窗口检查。

## 浏览器

先在一个终端保持 `bash tools/preview.sh` 运行，另一个终端执行：

```bash
npx playwright install chromium
npm run test:browser
```

已有 Edge 时可运行：

```bash
CHROMIUM_PATH='/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' npm run test:browser
```

## macOS 原生

```bash
bash tools/build-macos.sh
codesign --verify --deep --strict 'dist/Aemeath Startup.app'
'dist/Aemeath Startup.app/Contents/MacOS/AemeathStartup' --smoke-test --full-motion
open 'dist/Aemeath Startup.app' --args --preview
```

烟测应显示 `SMOKE PASS`、`motionEngine=static`，播放完成后 `playing=false`。还应人工检查手型、透明边缘和静态姿势；自动测试不证明人物解剖质量。

需要验证真实交接时，退出预览后运行 `open 'dist/Aemeath Startup.app' --args --launch`，检查官方窗口是否可见、可点击和可输入。分别测试官方应用已运行与已完全退出的情况。
