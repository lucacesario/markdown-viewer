use rfd::FileDialog;
use std::fs;
use tao::window::Window;

pub fn pick_open_file(window: &Window) -> Option<String> {
    FileDialog::new()
        .set_parent(window)
        .add_filter("Markdown", &["md", "markdown", "txt"])
        .add_filter("All files", &["*"])
        .pick_file()
        .map(|p| p.to_string_lossy().to_string())
}

pub fn pick_save_file(window: &Window) -> Option<String> {
    FileDialog::new()
        .set_parent(window)
        .add_filter("Markdown", &["md", "markdown"])
        .add_filter("All files", &["*"])
        .set_file_name("untitled.md")
        .save_file()
        .map(|p| p.to_string_lossy().to_string())
}

pub fn read_file(path: &str) -> Result<String, std::io::Error> {
    fs::read_to_string(path)
}

pub fn write_file(path: &str, content: &str) -> Result<(), std::io::Error> {
    fs::write(path, content)
}

pub fn pick_pdf_file(window: &Window) -> Option<String> {
    FileDialog::new()
        .set_parent(window)
        .add_filter("PDF document", &["pdf"])
        .set_file_name("document.pdf")
        .save_file()
        .map(|p| p.to_string_lossy().to_string())
}
