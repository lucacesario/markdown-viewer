use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Deserialize)]
struct WindowState {
    x: i32,
    y: i32,
    width: u32,
    height: u32,

    // `default` keeps old window_state.json files compatible.
    #[serde(default)]
    maximized: bool,
}

fn config_path() -> PathBuf {
    let mut p = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    p.push("peekdown");
    p.push("window_state.json");
    p
}

pub fn load_window_state() -> ((i32, i32), (u32, u32), bool) {
    const DEFAULT_POS: (i32, i32) = (100, 100);
    const DEFAULT_SIZE: (u32, u32) = (1200, 800);

    let path = config_path();

    if let Ok(data) = fs::read_to_string(&path) {
        if let Ok(state) = serde_json::from_str::<WindowState>(&data) {
            let size = if state.width > 1600 || state.height > 1000 {
                DEFAULT_SIZE
            } else {
                (
                    state.width.max(800),
                    state.height.max(600),
                )
            };

            let x = if state.x.abs() <= 10000 {
                state.x
            } else {
                DEFAULT_POS.0
            };

            let y = if state.y.abs() <= 10000 {
                state.y
            } else {
                DEFAULT_POS.1
            };

            return ((x, y), size, state.maximized);
        }
    }

    (DEFAULT_POS, DEFAULT_SIZE, false)
}

pub fn save_window_state(
    pos: (i32, i32),
    size: (u32, u32),
    maximized: bool,
) {
    let state = WindowState {
        x: pos.0,
        y: pos.1,
        width: size.0,
        height: size.1,
        maximized,
    };

    let path = config_path();

    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let _ = fs::write(
        &path,
        serde_json::to_string(&state).unwrap_or_default(),
    );
}