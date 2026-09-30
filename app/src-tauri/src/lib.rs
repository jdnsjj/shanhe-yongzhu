use tauri_plugin_dialog::MessageDialogKind;

/// 应用入口。Rust 侧保持极薄：只负责窗口与插件注册。
/// 全部游戏逻辑位于前端 TypeScript 领域层（src/domain/）。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|_app| Ok(()))
        .invoke_handler(tauri::generate_handler![app_version])
        .run(tauri::generate_context!())
        .unwrap_or_else(|err| {
            // 启动失败时给出可见反馈，而不是静默退出
            eprintln!("启动失败: {err}");
            std::process::exit(1);
        });
}

/// 供前端显示版本号。
#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// 保留：供将来在 Rust 侧弹出原生错误框。
#[allow(dead_code)]
fn fatal(message: &str) {
    let _: Option<MessageDialogKind> = None;
    eprintln!("{message}");
}
