# Markdown Viewer

A lightweight native Windows Markdown viewer and editor.

Built with Rust and WebView2. Fast startup, live Markdown rendering,
split editing, PDF export, multiple tabs, and no Electron runtime.

## Features

- Live Markdown preview
- Split editor and preview
- PDF export with configurable page options
- Multi-tab editing
- Syntax highlighting
- Dark and light themes
- Find in document
- Table of contents
- Drag and drop
- Adjustable preview width
- Recent files
- Window state persistence
- Single native executable

## Build

Requires Rust and the Microsoft WebView2 Runtime.

```bash
cargo build --release
```

Output:
target/release/markdown-viewer.exe

Technology
- Rust
- tao
- wry
- Microsoft WebView2
- marked.js
- highlight.js
Acknowledgements
Markdown Viewer is based on the MIT-licensed Peekdown project and
contains modifications and additional functionality.
License
MIT. See LICENSE for details.

One important thing: your archive currently has **no `LICENSE` file**. Before publishing `main`, copy the MIT license from the original project, including its original copyright notice, into:

```text
LICENSE
```