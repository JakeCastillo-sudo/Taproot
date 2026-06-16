// Prevents additional console window on Windows
#![cfg_attr(not(debug_assertions),
  windows_subsystem = "windows")]

mod printing;

use tauri::{
  Manager,
  menu::{Menu, MenuItem},
  tray::{TrayIconBuilder, TrayIconEvent},
};

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_notification::init())
    .invoke_handler(tauri::generate_handler![
      printing::list_serial_ports,
      printing::print_receipt_escpos,
      printing::print_kitchen_ticket,
      printing::open_cash_drawer,
      printing::print_receipt_network,
      printing::print_kitchen_network,
      printing::open_cash_drawer_network,
      get_app_version,
    ])
    .setup(|app| {
      // System tray setup
      let quit = MenuItem::with_id(
        app, "quit", "Quit Taproot POS", true, None::<&str>
      )?;
      let show = MenuItem::with_id(
        app, "show", "Open Taproot POS", true, None::<&str>
      )?;
      let menu = Menu::with_items(app, &[&show, &quit])?;

      let _tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("Taproot POS")
        .on_menu_event(|app, event| {
          match event.id.as_ref() {
            "quit" => {
              app.exit(0);
            }
            "show" => {
              if let Some(window) =
                app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
              }
            }
            _ => {}
          }
        })
        .on_tray_icon_event(|tray, event| {
          if let TrayIconEvent::Click { .. } = event {
            let app = tray.app_handle();
            if let Some(window) =
              app.get_webview_window("main") {
              let _ = window.show();
              let _ = window.set_focus();
            }
          }
        })
        .build(app)?;

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error running Taproot POS")
}

#[tauri::command]
fn get_app_version() -> String {
  env!("CARGO_PKG_VERSION").to_string()
}
