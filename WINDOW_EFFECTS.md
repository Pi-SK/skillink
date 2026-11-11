# Tauri 2 无边框窗口 + Mica 半透明材质开发经验

> 本文记录 Skillink 从"普通不透明窗口"演进到"无边框 + Windows 11 Mica 半透明"的完整过程：根因分析、配置、Rust 命令、CSS 透明层次、主题联动与踩坑，供后续迭代参考。
>
> 适用：Windows 11 + Tauri 2.11 + WebView2。

---

## 1. 核心结论（先看这里）

1. **`backdrop-filter: blur()` 只模糊 webview 内部已绘制的像素**，窗口本身不透出系统材质时，侧栏/顶栏叠在纯色背景上视觉就是纯色——玻璃感完全看不到。**要让材质生效，必须先在窗口层应用系统材质（Mica/Acrylic）并让窗口透明**，CSS 的半透明面才有内容可透。
2. **Tauri 2.11+ 自带 `windowEffects` 能力，底层就是 `window-vibrancy`**（Cargo.lock 里出现 `window-vibrancy` 是 tauri 的传递依赖，无需手动引入）。无需再 `cargo add window-vibrancy`。
3. **Mica 只支持 Windows 11**；Windows 10 用 `Acrylic`/`Blur`。深色/浅色材质用 `MicaDark`/`MicaLight` 分别控制。
4. **Mica 需要窗口 `transparent: true`**，否则材质被不透明白底挡住。
5. 无边框窗口（`decorations: false`）后，**窗口控制按钮要自己实现**（最小化/最大化/关闭），顶栏空白处要绑定拖拽。

---

## 2. 根因：为什么"看起来没半透明"

### 现象
- 侧栏 `.navrail`、顶栏 `.topbar` 的 CSS 早就写了 `backdrop-filter: blur(22px)` + 半透明背景（`color-mix(in srgb, var(--bg) 78%, transparent)`）。
- 但桌面端看起来就是纯色，没有玻璃感；只有 Windows 系统标题栏自带 Mica 材质。

### 原因
`backdrop-filter` 只能对**元素背后已经渲染的内容**做模糊。当窗口是不透明 WebView、背后只有纯色页面时，模糊出来的还是纯色。用户看到的"标题栏有材质"是**系统标题栏自带的 Mica**，不是应用 CSS 的效果——两者割裂，正好暴露了应用内材质没生效。

### 修复链路（三层缺一不可）
1. **窗口层**：`lib.rs` setup 里 `set_effects(MicaDark/MicaLight)`（或 `tauri.conf.json` 配 `windowEffects`）。
2. **窗口透明**：`tauri.conf.json` 窗口 `"transparent": true`；前端 `html, body` 背景透明，否则 Mica 被白底挡住。
3. **CSS 半透明面**：navrail/topbar 用低透明度背景 + `backdrop-filter`，让 Mica 从背后透出。

---

## 3. 完整配置

### 3.1 `tauri.conf.json`

```json
{
  "version": "1.2.3",
  "app": {
    "windows": [
      {
        "title": "Skillink",
        "width": 1080,
        "height": 700,
        "minWidth": 860,
        "minHeight": 560,
        "resizable": true,
        "transparent": true,
        "decorations": false
      }
    ]
  }
}
```

- `transparent: true`：Mica 生效的前提。
- `decorations: false`：去掉原生标题栏（连左侧重复的软件名一起消失）。

### 3.2 Rust 端：启动时应用 Mica（`lib.rs`）

```rust
.setup(|app| {
    #[cfg(target_os = "windows")]
    {
        use tauri::utils::config::WindowEffectsConfig;
        use tauri::window::Effect;
        use tauri::Manager;
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_effects(WindowEffectsConfig {
                effects: vec![Effect::MicaDark],
                ..Default::default()
            });
        }
    }
    Ok(())
})
```

> 用 `MicaDark`/`MicaLight` 而非 `Mica`（跟随系统）：应用内主题切换时能主动控制材质明暗，与前端主题联动。

### 3.3 应用内主题切换联动（`commands.rs`）

前端切换深浅主题时，通过 invoke 让 Rust 在 `MicaDark`/`MicaLight` 间切换：

```rust
#[tauri::command]
pub fn set_window_effect(window: tauri::WebviewWindow, theme: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use tauri::utils::config::WindowEffectsConfig;
        use tauri::window::Effect;
        let effect = if theme == "light" { Effect::MicaLight } else { Effect::MicaDark };
        window.set_effects(WindowEffectsConfig { effects: vec![effect], ..Default::default() })
            .map_err(|e| format!("切换窗口材质失败: {}", e))
    }
    #[cfg(not(target_os = "windows"))]
    { let _ = (window, theme); Ok(()) }
}
```

前端在 `toggleTheme` 里调用；**非 Tauri 环境（浏览器 mock）短路返回**，避免 invoke 报错：

```ts
export async function setWindowEffect(theme: "dark" | "light"): Promise<void> {
  if (!isTauri) return;
  try { await invoke<void>("set_window_effect", { theme }); } catch { /* 忽略 */ }
}
```

### 3.4 无边框窗口控制命令（`commands.rs`）

```rust
#[tauri::command]
pub fn start_window_drag(window: tauri::WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|e| format!("无法开始拖动窗口: {}", e))
}

#[tauri::command]
pub fn minimize_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|e| format!("无法最小化窗口: {}", e))
}

#[tauri::command]
pub fn toggle_maximize_window(window: tauri::WebviewWindow) -> Result<(), String> {
    let is_max = window.is_maximized().unwrap_or(false);
    if is_max { window.unmaximize() } else { window.maximize() }
        .map_err(|e| format!("切换最大化失败: {}", e))
}

#[tauri::command]
pub fn close_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.close().map_err(|e| format!("无法关闭窗口: {}", e))
}
```

> `window: tauri::WebviewWindow` 参数由 Tauri 自动注入当前窗口，命令签名里不用特殊处理。

### 3.5 前端顶栏（`App.tsx`）

- 顶栏左侧空白 `flex: 1` 作拖拽区，`onMouseDown` 时 `startWindowDrag()`。
- **双击最大化用 `e.detail === 2` 判断**：系统 `start_dragging` 是阻塞式调用，如果双击触发了两次拖拽会冲突；用 `detail` 区分单击/双击更可靠。
- 右侧渲染 最小化/最大化/关闭 三个按钮，仅 Tauri 环境渲染（`isTauri &&`）。

### 3.6 CSS 透明层次

三层由透到实：

| 区域 | data-tauri 下背景 | 效果 |
|---|---|---|
| 侧栏 `.navrail` | `--bg` 26% / 16% 渐变 | 最透，玻璃感最强 |
| 顶栏 `.topbar` | `--bg` 22% | 透，玻璃感强 |
| 内容区 `.content` | `--bg-card` 72% / 55% / 62% 渐变 | 较实，突出内容可读性 |

要点：
- **`[data-tauri]` 选择器**区分桌面端与浏览器预览——浏览器 mock 走普通不透明样式，桌面端才启用半透明。`main.tsx` 里 `isTauri` 时给 `<html>` 加 `data-tauri` 属性。
- `html, body` 背景在桌面端**必须透明**（只留微弱品牌色环境光），否则挡住 Mica。
- 卡片/弹窗/矩阵等承载内容的实色面维持 `var(--bg-card)`，保证文字对比度。
- `prefers-reduced-transparency` 媒体查询把半透明退化为实色，保证可访问性兜底。

---

## 4. 踩坑记录

### 坑 1：`get_webview_window` 编译报错
`app.get_webview_window("main")` 需要 `use tauri::Manager;` 在作用域内，否则报 `E0599`。setup 闭包里局部 `use` 即可。

### 坑 2：`toggle_maximize` 方法不存在
tauri 的 `Window` 没有 `toggle_maximize()`，用 `is_maximized()` + `maximize()`/`unmaximize()` 组合实现。

### 坑 3：双击最大化与拖拽冲突
`start_dragging()` 是系统级阻塞调用。双击时若两次 mousedown 都进拖拽，会出现卡顿/失效。用 `e.detail === 2` 在 mousedown 里分流：双击走 `toggleMaximizeWindow()`，单击才 `startWindowDrag()`。

### 坑 4：只加 CSS 不生效
`backdrop-filter` + 半透明背景 ≠ 玻璃感。**必须先 `transparent: true` + Rust `set_effects`（或 conf 配 `windowEffects`）+ body 透明**，三层缺一不可。

### 坑 5：Mica 在非 Windows 编译
`Effect::MicaDark` 是 Windows-only。跨平台代码必须 `#[cfg(target_os = "windows")]` 包住，非 Windows 分支做成 no-op，否则在其他平台编译失败。

### 坑 6：浏览器预览看不到材质
浏览器 mock 环境没有 `__TAURI_INTERNALS__`，`isTauri` 为 false，`data-tauri` 不生效——半透明样式只在真实 Tauri 桌面端可见。开发时用 `document.documentElement.setAttribute('data-tauri','')` 手动加属性验证 CSS 计算值。

---

## 5. 关键文件速查

| 文件 | 作用 |
|---|---|
| `src-tauri/tauri.conf.json` | `transparent` + `decorations: false` |
| `src-tauri/src/lib.rs` | setup 应用 Mica；注册窗口控制命令 |
| `src-tauri/src/commands.rs` | `set_window_effect` + `start_window_drag`/`minimize_window`/`toggle_maximize_window`/`close_window` |
| `src/App.tsx` | 顶栏拖拽区 + 窗口按钮 + `toggleTheme` 联动材质 |
| `src/api.ts` | `setWindowEffect` 等 invoke 封装（isTauri 守卫） |
| `src/main.tsx` | `isTauri` 时加 `data-tauri` 标记 |
| `src/App.css` | `[data-tauri]` 下的透明层次与无边框样式 |

---

## 6. 备选方案对照

| 材质 | 平台 | 说明 |
|---|---|---|
| **Mica** | Windows 11 | 原生、无缩放性能问题，最贴近系统；深/浅用 MicaDark/MicaLight |
| Acrylic | Windows 10/11 | 模糊更强，但 Windows 11 缩放/拖动时性能略差 |
| Blur | Win7/10/11(22H1) | 通用模糊，Windows 11 22621+ 缩放性能差 |

在 Windows 10 上 Mica 不生效（会退回无材质），如需兼容需按 `cfg(windows)` + 系统版本判断降级 Acrylic——本项目当前仅目标 Windows 11，未做降级。
