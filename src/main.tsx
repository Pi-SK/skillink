import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";
import { isTauri } from "./mock";
import { setWindowEffect } from "./api";

// 提前应用主题，避免首屏闪烁（默认深色）
if (localStorage.getItem("skillink.theme") === "light") {
  document.documentElement.setAttribute("data-theme", "light");
}

// Tauri 桌面端标记：body 背景透明，让 Windows Mica 材质透出
if (isTauri) {
  document.documentElement.setAttribute("data-tauri", "");
  // 窗口材质与主题同步：setup 里的默认材质可能滞后/失败，初始化时按存储主题主动纠正，
  // 避免「启动时材质颜色异常、点击主题切换后才正常」
  const saved = localStorage.getItem("skillink.theme") === "light" ? "light" : "dark";
  void setWindowEffect(saved);
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
