mod commands;
mod instructions;
mod registry;
mod scanner;
mod sync;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // 兜底材质：窗口透明 + MicaDark（默认深色主题）。
            // 真正的主题联动由前端初始化时按 localStorage 调 set_window_effect 覆盖，
            // 避免「启动材质颜色异常、点击主题切换后才正常」。
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
        .invoke_handler(tauri::generate_handler![
            commands::get_agents,
            commands::set_window_effect,
            commands::start_window_drag,
            commands::minimize_window,
            commands::toggle_maximize_window,
            commands::close_window,
            commands::get_skills,
            commands::get_matrix,
            commands::toggle_skill,
            commands::import_skill,
            commands::open_agents_json,
            commands::set_agent_sync_mode,
            commands::set_agent_ignored,
            commands::save_custom_agent,
            commands::get_plugins,
            commands::toggle_plugin,
            commands::get_plugin_matrix,
            commands::get_plugin_detail,
            commands::open_plugin_folder,
            commands::delete_skill,
            commands::delete_plugin,
            // 指令文档
            commands::get_instruction_docs,
            commands::read_instruction_doc,
            commands::write_instruction_doc,
            commands::list_doc_backups,
            commands::read_doc_backup,
            commands::restore_doc_backup,
            commands::open_doc_in_editor,
            commands::reveal_doc,
            // 共享片段
            commands::get_snippets,
            commands::save_snippet,
            commands::delete_snippet,
            commands::preview_snippet_sync,
            commands::apply_snippet_sync,
            // 反向发现 / 纳管 / 体检 / 详情
            commands::get_unmanaged,
            commands::adopt_skill,
            commands::adopt_plugin,
            commands::get_issues,
            commands::repair_issue,
            commands::read_skill_md,
            commands::get_skill_meta,
            commands::open_skill_folder,
            commands::open_managed_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
