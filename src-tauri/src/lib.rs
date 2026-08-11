mod commands;
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
