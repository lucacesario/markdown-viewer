use serde::Deserialize;
use std::sync::{Arc, Mutex};
use tao::window::Window;
use wry::WebView;

use crate::file_ops;
use crate::state::AppState;

use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2_2,
    ICoreWebView2_7,
    ICoreWebView2Environment6,
};

use webview2_com::PrintToPdfCompletedHandler;
use wry::WebViewExtWindows;

use windows::core::{Interface, PCWSTR};

#[derive(Deserialize)]
struct IpcMessage {
    command: String,
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    title: Option<String>,
}

pub fn handle_ipc_message(
    msg: &str,
    webview: &WebView,
    window: &Window,
    state: &Arc<Mutex<AppState>>,
) {
    let parsed: IpcMessage = match serde_json::from_str(msg) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("IPC parse error: {e}");
            return;
        }
    };

    match parsed.command.as_str() {
        "open_file" => {
            let path = parsed.path.or_else(file_ops::pick_open_file);
            if let Some(p) = path {
                match file_ops::read_file(&p) {
                    Ok(contents) => {
                        send_to_js(webview, "file_opened", &serde_json::json!({
                            "content": contents,
                            "path": p
                        }));
                    }
                    Err(e) => send_to_js(webview, "error", &serde_json::json!({
                        "message": format!("Failed to open file: {e}")
                    })),
                }
            }
        }
        "save_file" => {
            if let Some(ref content) = parsed.content {
                if let Some(ref path) = parsed.path {
                    match file_ops::write_file(path, content) {
                        Ok(_) => {
                            send_to_js(webview, "file_saved", &serde_json::json!({
                                "path": path
                            }));
                        }
                        Err(e) => send_to_js(webview, "error", &serde_json::json!({
                            "message": format!("Failed to save: {e}")
                        })),
                    }
                } else {
                    handle_save_as(webview, parsed.content);
                }
            }
        }
        "save_as" => {
            handle_save_as(webview, parsed.content);
        }
        "set_title" => {
            if let Some(title) = parsed.title {
                window.set_title(&title);
            }
        }
        "window_minimize" => {
            window.set_minimized(true);
        }
        "window_maximize" => {
            let currently_maximized = window.is_maximized();

            if currently_maximized {
                // Leaving maximized mode.
                window.set_maximized(false);

                let (pos, size, _) =
                    crate::window_state::load_window_state();

                crate::window_state::save_window_state(
                    pos,
                    size,
                    false,
                );
            } else {
                // Save the current normal rectangle before maximizing.
                let inner_size = window.inner_size();
                let outer_pos = window.outer_position().unwrap_or_default();

                crate::window_state::save_window_state(
                    (outer_pos.x, outer_pos.y),
                    (inner_size.width, inner_size.height),
                    true,
                );

                window.set_maximized(true);
            }
        }
        "window_close" => {
            if !window.is_maximized() {
                let inner_size = window.inner_size();
                let outer_pos = window.outer_position().unwrap_or_default();

                crate::window_state::save_window_state(
                    (outer_pos.x, outer_pos.y),
                    (inner_size.width, inner_size.height),
                    false,
                );
            }

            std::process::exit(0);
        }
        "read_image" => {
            if let Some(ref path) = parsed.path {
                use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
                let encoded = utf8_percent_encode(path, NON_ALPHANUMERIC).to_string();
                let url = format!("http://peekdown.localhost/local-image?{}", encoded);
                let script = format!(
                    "window.__setImage({}, {})",
                    serde_json::to_string(path).unwrap(),
                    serde_json::to_string(&url).unwrap(),
                );
                let _ = webview.evaluate_script(&script);
            }
        }
        "drag_enter" => {
            let _ = webview.evaluate_script(
                "document.getElementById('drop-overlay').classList.add('visible')");
        }
        "drag_leave" => {
            let _ = webview.evaluate_script(
                "document.getElementById('drop-overlay').classList.remove('visible')");
        }
        "ready" => {
            let (pending_file, pending_content, pending_title) = {
                let mut st = state.lock().unwrap();
                (st.pending_file.take(), st.pending_content.take(), st.pending_title.take())
            };
            if let Some(p) = pending_file {
                match file_ops::read_file(&p) {
                    Ok(contents) => {
                        send_to_js(webview, "file_opened", &serde_json::json!({
                            "content": contents,
                            "path": p
                        }));
                    }
                    Err(e) => send_to_js(webview, "error", &serde_json::json!({
                        "message": format!("Failed to open file: {e}")
                    })),
                }
            } else if let Some(content) = pending_content {
                let title = pending_title.unwrap_or_else(|| "stdin".to_string());
                send_to_js(webview, "stdin_opened", &serde_json::json!({
                    "content": content,
                    "title": title
                }));
            }
            window.set_visible(true);

        }
        "export_pdf" => {
            if let Some(path) = file_ops::pick_pdf_file() {
                send_to_js(
                    webview,
                    "pdf_path_selected",
                    &serde_json::json!({
                        "path": path
                    }),
                );
            }
        }
        "export_pdf_to_path" => {
            if let Some(path) = parsed.path {
                unsafe {
                    let controller = webview.controller();

                    if let Ok(core) = controller.CoreWebView2() {
                        if let Ok(core2) =
                            core.cast::<ICoreWebView2_2>()
                        {
                            if let Ok(environment) =
                                core2.Environment()
                            {
                                if let Ok(environment6) =
                                    environment.cast::<
                                        ICoreWebView2Environment6
                                    >()
                                {
                                    if let Ok(settings) =
                                        environment6.CreatePrintSettings()
                                    {
                                        let _ =
                                            settings
                                                .SetShouldPrintHeaderAndFooter(
                                                    false
                                                );

                                        let _ =
                                            settings
                                                .SetShouldPrintBackgrounds(
                                                    true
                                                );

                                        if let Ok(core7) =
                                            core.cast::<ICoreWebView2_7>()
                                        {
                                            let wide_path:
                                                Vec<u16> = path
                                                .encode_utf16()
                                                .chain(
                                                    std::iter::once(0)
                                                )
                                                .collect();

                                            let pdf_path =
                                                PCWSTR(
                                                    wide_path.as_ptr()
                                                );

                                            let saved_path =
                                                path.clone();

                                            let handler =
                                                PrintToPdfCompletedHandler::create(
                                                    Box::new(
                                                        move |
                                                            error_code,
                                                            success
                                                        | {
                                                            if error_code
                                                                .is_ok()
                                                                && success
                                                            {
                                                                println!(
                                                                    "PDF saved: {}",
                                                                    saved_path
                                                                );
                                                            } else {
                                                                eprintln!(
                                                                    "PDF export failed"
                                                                );
                                                            }

                                                            Ok(())
                                                        },
                                                    ),
                                                );

                                            let _ =
                                                core7.PrintToPdf(
                                                    pdf_path,
                                                    &settings,
                                                    &handler,
                                                );
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        _ => eprintln!("Unknown IPC command: {}", parsed.command),
    }
}

fn handle_save_as(
    webview: &WebView,
    content: Option<String>,
) {
    if let Some(content) = content {
        if let Some(path) = file_ops::pick_save_file() {
            match file_ops::write_file(&path, &content) {
                Ok(_) => {
                    send_to_js(webview, "file_saved", &serde_json::json!({
                        "path": path
                    }));
                }
                Err(e) => send_to_js(webview, "error", &serde_json::json!({
                    "message": format!("Failed to save: {e}")
                })),
            }
        }
    }
}

fn send_to_js(webview: &WebView, event: &str, data: &serde_json::Value) {
    let script = format!(
        "window.__fromRust({}, {})",
        serde_json::to_string(event).unwrap(),
        serde_json::to_string(data).unwrap(),
    );
    let _ = webview.evaluate_script(&script);
}
