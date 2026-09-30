// Windows 发布版不弹出额外的控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    shanhe_yongzhu_lib::run()
}
