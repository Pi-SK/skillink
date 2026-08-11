import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";

// 提前应用主题，避免首屏闪烁（默认深色）
if (localStorage.getItem("skillman.theme") === "light") {
  document.documentElement.setAttribute("data-theme", "light");
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
