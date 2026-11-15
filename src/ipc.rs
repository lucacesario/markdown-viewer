use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Deserialize;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};
use tao::window::Window;
use wry::WebView;

use crate::file_ops;
use crate::state::AppState;

use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Environment6, ICoreWebView2_2, ICoreWebView2_7,
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
    request_id: Option<u64>,
    #[serde(default)]
    expected_content: Option<String>,
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
        "save_screenshot" => {
            if let (Some(document_path), Some(image_data)) =
                (parsed.path.as_deref(), parsed.content.as_deref())
            {
                match save_screenshot(document_path, image_data) {
                    Ok(relative_path) => {
                        send_to_js(
                            webview,
                            "screenshot_saved",
                            &serde_json::json!({
                                "path": relative_path
                            }),
                        );
                    }
                    Err(message) => {
                        send_to_js(
                            webview,
                            "error",
                            &serde_json::json!({
                                "message": message
                            }),
                        );
                    }
                }
            } else {
                send_to_js(
                    webview,
                    "error",
                    &serde_json::json!({
                        "message": "Save the Markdown document before pasting images."
                    }),
                );
            }
        }
        "open_external" => {
            if let Some(url) = parsed.path {
                if let Ok(parsed_url) = url::Url::parse(&url) {
                    if matches!(parsed_url.scheme(), "http" | "https") {
                        if let Err(e) = webbrowser::open(&url) {
                            eprintln!("Failed to open external URL: {e}");
                        }
                    }
                }
            }
        }
        "open_file" => {
            let path = parsed.path.or_else(|| file_ops::pick_open_file(window));
            if let Some(p) = path {
                match file_ops::read_file(&p) {
                    Ok(contents) => {
                        send_to_js(
                            webview,
                            "file_opened",
                            &serde_json::json!({
                                "content": contents,
                                "path": p
                            }),
                        );
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                        send_to_js(
                            webview,
                            "file_open_missing",
                            &serde_json::json!({
                                "path": p,
                            }),
                        );
                    }
                    Err(e) => send_to_js(
                        webview,
                        "error",
                        &serde_json::json!({
                            "message": format!("Failed to open file: {e}")
                        }),
                    ),

                }
            }
        }
        "check_file_change" => {
            if let Some(path) = parsed.path.as_deref() {
                match read_live_file(path) {
                    Ok(content) => {
                        send_to_js(
                            webview,
                            "file_check_result",
                            &serde_json::json!({
                                "path": path,
                                "content": content,
                                "ok": true,
                                "request_id": parsed.request_id,
                            }),
                        );
                    }
                    Err(message) => {
                        // Send the failure to Live Read rather than
                        // showing a global error on every poll.
                        send_to_js(
                            webview,
                            "file_check_result",
                            &serde_json::json!({
                                "path": path,
                                "ok": false,
                                "message": message,
                                "request_id": parsed.request_id,
                            }),
                        );
                    }
                }
            }
        }
        "save_file" => {
            if let Some(ref content) = parsed.content {
                if let Some(ref path) = parsed.path {
                    // Existing files require a known disk baseline.
                    let expected = match parsed.expected_content.as_deref() {
                        Some(expected) => expected,
                        None => {
                            send_to_js(
                                webview,
                                "error",
                                &serde_json::json!({
                                    "message": "Save blocked: the original file version is unknown."
                                }),
                            );
                            return;
                        }
                    };

                    // Re-read the file at save time.
                    match file_ops::read_file(path) {
                        Ok(current_disk_content) => {
                            if current_disk_content != expected {
                                // Refuse to overwrite an externally changed file.
                                send_to_js(
                                    webview,
                                    "save_conflict",
                                    &serde_json::json!({
                                        "path": path,
                                        "disk_content": current_disk_content
                                    }),
                                );
                                return;
                            }

                            match file_ops::write_file(path, content) {
                                Ok(_) => {
                                    send_to_js(
                                        webview,
                                        "file_saved",
                                        &serde_json::json!({
                                            "path": path
                                        }),
                                    );
                                }
                                Err(e) => {
                                    send_to_js(
                                        webview,
                                        "error",
                                        &serde_json::json!({
                                            "message": format!("Failed to save: {e}")
                                        }),
                                    );
                                }
                            }
                        }
                        Err(e) => {
                            send_to_js(
                                webview,
                                "error",
                                &serde_json::json!({
                                    "message": format!(
                                        "Save blocked: cannot verify the current disk file: {e}"
                                    )
                                }),
                            );
                        }
                    }
                } else {
                    handle_save_as(webview, window, parsed.content, None);
                }
            }
        }
        "overwrite_file" => {
            if let (Some(path), Some(content), Some(expected)) = (
                parsed.path.as_deref(),
                parsed.content.as_deref(),
                parsed.expected_content.as_deref(),
            ) {
                // The user approved overwriting this specific disk version.
                // Recheck it before writing.
                match file_ops::read_file(path) {
                    Ok(current) if current == expected => {
                        match file_ops::write_file(path, content) {
                            Ok(()) => send_to_js(
                                webview,
                                "file_saved",
                                &serde_json::json!({ "path": path }),
                            ),
                            Err(e) => send_to_js(
                                webview,
                                "error",
                                &serde_json::json!({
                                    "message": format!("Failed to overwrite file: {e}")
                                }),
                            ),
                        }
                    }
                    Ok(current) => {
                        // The file changed again after the dialog opened.
                        send_to_js(
                            webview,
                            "save_conflict",
                            &serde_json::json!({
                                "path": path,
                                "disk_content": current
                            }),
                        );
                    }
                    Err(e) => send_to_js(
                        webview,
                        "error",
                        &serde_json::json!({
                            "message": format!(
                                "Overwrite blocked: cannot verify disk file: {e}"
                            )
                        }),
                    ),
                }
            } else {
                send_to_js(
                    webview,
                    "error",
                    &serde_json::json!({
                        "message": "Overwrite blocked: missing save information."
                    }),
                );
            }
        }    
        "save_conflict_as" => {
            if let Some(original_path) = parsed.path.as_deref() {
                handle_save_as(
                    webview,
                    window,
                    parsed.content,
                    Some(original_path),
                );
            } else {
                send_to_js(
                    webview,
                    "error",
                    &serde_json::json!({
                        "message": "Save As blocked: original file path is missing."
                    }),
                );
            }
        }
        "save_as" => {
            handle_save_as(webview, window, parsed.content, None);
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

                let (pos, size, _) = crate::window_state::load_window_state();

                crate::window_state::save_window_state(pos, size, false);
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
                let url = format!("http://markdown-viewer.localhost/local-image?{}", encoded);
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
                "document.getElementById('drop-overlay').classList.add('visible')",
            );
        }
        "drag_leave" => {
            let _ = webview.evaluate_script(
                "document.getElementById('drop-overlay').classList.remove('visible')",
            );
        }
        "ready" => {
            let (pending_file, pending_content, pending_title) = {
                let mut st = state.lock().unwrap();
                (
                    st.pending_file.take(),
                    st.pending_content.take(),
                    st.pending_title.take(),
                )
            };
            if let Some(p) = pending_file {
                match file_ops::read_file(&p) {
                    Ok(contents) => {
                        send_to_js(
                            webview,
                            "file_opened",
                            &serde_json::json!({
                                "content": contents,
                                "path": p
                            }),
                        );
                    }
                    Err(e) => send_to_js(
                        webview,
                        "error",
                        &serde_json::json!({
                            "message": format!("Failed to open file: {e}")
                        }),
                    ),
                }
            } else if let Some(content) = pending_content {
                let title = pending_title.unwrap_or_else(|| "stdin".to_string());
                send_to_js(
                    webview,
                    "stdin_opened",
                    &serde_json::json!({
                        "content": content,
                        "title": title
                    }),
                );
            }
            window.set_visible(true);
        }
        "export_pdf" => {
            if let Some(path) = file_ops::pick_pdf_file(window) {
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
                        if let Ok(core2) = core.cast::<ICoreWebView2_2>() {
                            if let Ok(environment) = core2.Environment() {
                                if let Ok(environment6) =
                                    environment.cast::<ICoreWebView2Environment6>()
                                {
                                    if let Ok(settings) = environment6.CreatePrintSettings() {
                                        let _ = settings.SetShouldPrintHeaderAndFooter(false);

                                        let _ = settings.SetShouldPrintBackgrounds(true);

                                        if let Ok(core7) = core.cast::<ICoreWebView2_7>() {
                                            let wide_path: Vec<u16> = path
                                                .encode_utf16()
                                                .chain(std::iter::once(0))
                                                .collect();

                                            let pdf_path = PCWSTR(wide_path.as_ptr());

                                            let saved_path = path.clone();

                                            let handler = PrintToPdfCompletedHandler::create(
                                                Box::new(move |error_code, success| {
                                                    if error_code.is_ok() && success {
                                                        println!("PDF saved: {}", saved_path);
                                                    } else {
                                                        eprintln!("PDF export failed");
                                                    }

                                                    Ok(())
                                                }),
                                            );

                                            let _ = core7.PrintToPdf(pdf_path, &settings, &handler);
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
    window: &Window,
    content: Option<String>,
    forbidden_path: Option<&str>,
) {
    let Some(content) = content else {
        return;
    };

    let Some(path) = file_ops::pick_save_file(window) else {
        // User cancelled the Windows Save As dialog.
        return;
    };

    if let Some(original) = forbidden_path {
        let normalized_original =
            original.replace('\\', "/").to_lowercase();

        let normalized_selected =
            path.replace('\\', "/").to_lowercase();

        let same_path = normalized_original == normalized_selected
            || match (
                Path::new(original).canonicalize(),
                Path::new(&path).canonicalize(),
            ) {
                (Ok(a), Ok(b)) => a == b,
                _ => false,
            };

        if same_path {
            send_to_js(
                webview,
                "error",
                &serde_json::json!({
                    "message": "Save As cannot replace the conflicted original file. Choose a different filename."
                }),
            );
            return;
        }
    }

    match file_ops::write_file(&path, &content) {
        Ok(()) => send_to_js(
            webview,
            "file_saved",
            &serde_json::json!({
                "path": path
            }),
        ),
        Err(e) => send_to_js(
            webview,
            "error",
            &serde_json::json!({
                "message": format!("Failed to save: {e}")
            }),
        ),
    }
}


/*
 * Live Read: read a file without modifying it.
 *
 * Limit reads to 4 MiB so polling cannot accidentally
 * load very large documents into the WebView.
 */
fn read_live_file(path: &str) -> Result<String, String> {
    const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024;

    let file = fs::File::open(path)
        .map_err(|e| format!("Cannot read file: {e}"))?;

    let metadata = file
        .metadata()
        .map_err(|e| format!("Cannot inspect file: {e}"))?;

    if !metadata.is_file() {
        return Err("Path is not a regular file.".to_string());
    }

    if metadata.len() > MAX_FILE_BYTES {
        return Err("File exceeds the 4 MiB Live Read limit.".to_string());
    }

    // Bounded read also protects against files growing
    // between metadata inspection and reading.
    let mut bytes = Vec::new();

    file.take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Cannot read file: {e}"))?;

    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("File exceeds the 4 MiB Live Read limit.".to_string());
    }

    String::from_utf8(bytes)
        .map_err(|_| "Live Read requires a UTF-8 text file.".to_string())
}

fn send_to_js(webview: &WebView, event: &str, data: &serde_json::Value) {
    let script = format!(
        "window.__fromRust({}, {})",
        serde_json::to_string(event).unwrap(),
        serde_json::to_string(data).unwrap(),
    );
    let _ = webview.evaluate_script(&script);
}

fn save_screenshot(document_path: &str, image_data: &str) -> Result<String, String> {
    const MAX_IMAGE_BYTES: usize = 15 * 1024 * 1024;

    // Require a previously saved Markdown document.
    let document = Path::new(document_path)
        .canonicalize()
        .map_err(|_| "Save the Markdown document before pasting images.".to_string())?;

    if !document.is_file() {
        return Err("The Markdown document does not exist.".to_string());
    }

    let extension = document
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");

    if !extension.eq_ignore_ascii_case("md") && !extension.eq_ignore_ascii_case("markdown") {
        return Err("Screenshot pasting requires a Markdown document.".to_string());
    }

    let parent = document
        .parent()
        .ok_or("Cannot locate the document folder.")?;

    let stem = document
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or("Invalid Markdown filename.")?;

    // Build a folder named after the document.
    let assets_name = format!("{stem}.assets");
    let assets_dir = parent.join(&assets_name);

    // Limit the image size before decoding.
    if image_data.len() > (MAX_IMAGE_BYTES * 4 / 3) + 8 {
        return Err("Screenshot exceeds the 15 MB limit.".to_string());
    }

    let image_bytes = STANDARD
        .decode(image_data)
        .map_err(|_| "Invalid screenshot encoding.".to_string())?;

    if image_bytes.len() > MAX_IMAGE_BYTES {
        return Err("Screenshot exceeds the 15 MB limit.".to_string());
    }

    // Verify the PNG signature.
    const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";

    if !image_bytes.starts_with(PNG_SIGNATURE) {
        return Err("Clipboard image is not a PNG.".to_string());
    }

    fs::create_dir_all(&assets_dir).map_err(|e| format!("Cannot create assets folder: {e}"))?;

    // Create unique filenames without overwriting existing screenshots.
    for number in 1..=9999 {
        let filename = format!("screenshot-{number:03}.png");
        let image_path = assets_dir.join(&filename);

        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&image_path);

        match file {
            Ok(mut file) => {
                if let Err(e) = file.write_all(&image_bytes) {
                    drop(file);
                    let _ = fs::remove_file(&image_path);
                    return Err(format!("Cannot save screenshot: {e}"));
                }

                // Relative Markdown path, with forward slashes.
                return Ok(format!("{assets_name}/{filename}"));
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                continue;
            }
            Err(e) => {
                return Err(format!("Cannot create screenshot file: {e}"));
            }
        }
    }

    Err("Too many screenshots in this assets folder.".to_string())
}
