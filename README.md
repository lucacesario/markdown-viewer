# Markdown Viewer

A lightweight native Markdown viewer and editor for Windows.

Markdown Viewer is built with Rust and WebView2 and is designed for fast startup, simple editing, live Markdown rendering, split view, PDF export, and a clean native Windows experience — without Electron.

## Features

- Live Markdown preview
- Side-by-side split editor and preview
- Multi-tab editing
- GitHub Flavored Markdown support
- Syntax highlighting for code blocks
- Dark and light themes
- Line numbers with wrapped-line handling
- Find in document
- Built-in searchable Markdown Guide
- Table of contents / document outline
- Drag-and-drop file opening
- Recent files
- Adjustable preview width
- Window size and state persistence
- Configurable PDF export
- Native Windows file opening
- `.md` file association support through the installer
- Lightweight native executable

## Markdown Support

Markdown Viewer supports GitHub Flavored Markdown through `marked.js`.

Supported syntax includes:

- Headings
- Paragraphs
- Bold and italic text
- Blockquotes
- Ordered and unordered lists
- Task lists
- Links
- Images
- Inline code
- Fenced code blocks
- Tables
- Horizontal rules
- Strikethrough
- Nested Markdown structures

A searchable Markdown Guide is included directly in the application.

## Editor

The editor includes:

- Line numbers
- Current line, column, and cursor position
- Character and word counts
- Automatic line wrapping
- Split editing and preview
- Synchronized scrolling in split view
- Multiple open documents using tabs

Wrapped visual lines remain part of the same logical Markdown line and do not receive additional line numbers.

## PDF Export

Markdown documents can be exported directly to PDF.

Available options include:

- A4 or Letter paper size
- Portrait or landscape orientation
- Default, narrow, or wide margins
- Blue or black document styling
- Optional date/time footer
- Optional page numbering

PDF output is generated using the Windows WebView2 rendering engine.

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+N` | New document |
| `Ctrl+O` | Open file |
| `Ctrl+S` | Save |
| `Ctrl+Shift+S` | Save As |
| `Ctrl+W` | Close current tab |
| `Ctrl+Tab` | Next tab |
| `Ctrl+Shift+Tab` | Previous tab |
| `Ctrl+F` | Find in current document |
| `Ctrl+G` | Open Markdown Guide |
| `Ctrl+E` | Toggle editor / preview |
| `Ctrl+\\` | Toggle split view |
| `Ctrl+Shift+O` | Toggle document outline |
| `Ctrl+P` | Export to PDF |
| `Ctrl++` | Zoom in |
| `Ctrl+-` | Zoom out |
| `Ctrl+0` | Reset zoom |

When the Markdown Guide is open, `Ctrl+F` focuses the Guide search field.

## Installation

### Windows installer

The recommended way to install Markdown Viewer is with the Windows installer:

```text
Markdown-Viewer-Setup-v1.0.0.exe
```

The installer:

- installs only for the current Windows user
- does not require administrator privileges
- installs under `%LOCALAPPDATA%\Programs\Markdown Viewer`
- creates a Start Menu shortcut
- can optionally create a desktop shortcut
- registers Markdown Viewer as an application capable of opening `.md` files
- provides standard Windows uninstall support

Windows controls the final default-app selection for `.md` files. After installation, Markdown Viewer can be selected through **Open with** or Windows **Default Apps** settings.

## Portable Use

Markdown Viewer can also be run directly without installation.

Build or download:

```text
markdown-viewer.exe
```

and run it from any writable location.

The Microsoft Edge WebView2 Runtime must be available on the system.

## Build From Source

### Requirements

- Windows
- Rust toolchain
- Microsoft Edge WebView2 Runtime

Clone the repository and build:

```bash
git clone https://github.com/lucacesario/markdown-viewer.git
cd markdown-viewer
cargo build --release
```

The executable will be created at:

```text
target/release/markdown-viewer.exe
```

## Building the Installer

The Windows installer is built with Inno Setup.

First build the application:

```bash
cargo build --release
```

Then compile:

```text
installer.iss
```

using Inno Setup Compiler.

The resulting installer is created in:

```text
dist/Markdown-Viewer-Setup-v1.0.0.exe
```

## Technology

Markdown Viewer uses:

- Rust
- `tao`
- `wry`
- Microsoft Edge WebView2
- `marked.js`
- `highlight.js`
- Inno Setup for Windows packaging

## Project Structure

```text
assets/
    icon.ico
    icon.png
    icon.svg

src/
    frontend/
        app.js
        guide.md
        index.html
        style.css
        tabs.js
    main.rs

Cargo.toml
installer.iss
```

## Acknowledgements

Markdown Viewer originated from the MIT-licensed [Peekdown](https://github.com/Mockitup/Peekdown) project.

This project contains substantial modifications and additional functionality, including expanded editing features, PDF export options, application state persistence, multi-tab behavior, a searchable Markdown Guide, line numbering, Windows integration, installer support, and other UI and workflow improvements.

The original project's copyright and license terms remain acknowledged in accordance with the MIT License.

## License

Licensed under the MIT License.

See [`LICENSE`](LICENSE) for details.
