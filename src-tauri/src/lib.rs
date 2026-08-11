mod commands;
mod instructions;
mod registry;
mod scanner;
mod sync;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_agents,
            commands::get_skills,
            commands::get_matrix,
            commands::toggle_skill,
            commands::import_skill,
            commands::open_agents_json,
            commands::get_plugins,
            commands::toggle_plugin,
            commands::get_plugin_matrix,
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
            commands::read_skill_md,
            commands::open_skill_folder,
            commands::open_managed_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
