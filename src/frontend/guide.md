# Markdown Guide

Markdown Viewer renders Markdown using GitHub-flavoured Markdown (GFM) features.

This guide covers the syntax supported by the app, including headings, paragraphs, emphasis, links, images, lists, task lists, blockquotes, code, tables, horizontal rules, escaping, HTML, and practical formatting tips.

---

# 1. Headings

Use one to six `#` characters followed by a space.

```markdown
# Heading 1
## Heading 2
### Heading 3
#### Heading 4
##### Heading 5
###### Heading 6
```

Use headings to structure a document. Heading levels should normally be used in order.

```markdown
# Document title

## Section

### Subsection
```

---

# 2. Paragraphs

Separate paragraphs with a blank line.

```markdown
This is the first paragraph.

This is the second paragraph.
```

A single newline inside a paragraph is treated as a soft break.

```markdown
This is one line
and this is the next line
but both belong to the same paragraph.
```

Rendered text normally flows together as one paragraph.

---

# 3. Line breaks

To force a visible line break without starting a new paragraph, end the line with two spaces.

```markdown
First line  
Second line
```

You can also use a backslash at the end of the line.

```markdown
First line\
Second line
```

A blank line creates a new paragraph.

```markdown
First paragraph.

Second paragraph.
```

---

# 4. Bold, italic, and strikethrough

## Bold

Use two asterisks or two underscores.

```markdown
**bold text**

__bold text__
```

## Italic

Use one asterisk or one underscore.

```markdown
*italic text*

_italic text_
```

## Bold and italic

Use three asterisks.

```markdown
***bold and italic***
```

You can also combine markers.

```markdown
**bold with *italic* inside**
```

## Strikethrough

GitHub-flavoured Markdown supports strikethrough.

```markdown
~~deleted text~~
```

---

# 5. Inline code

Use single backticks for code inside a sentence.

```markdown
Run `cargo build --release` to create a release build.
```

Backticks preserve code formatting and prevent Markdown inside them from being interpreted.

```markdown
Use `**text**` to show the Markdown syntax literally.
```

If the code itself contains a backtick, wrap it in two backticks.

```markdown
``Use `code` here``
```

---

# 6. Fenced code blocks

Use three backticks before and after a block.

````markdown
```
This is a code block.
Nothing inside it is interpreted as Markdown.
```
````

You can add a language name after the opening fence.

````markdown
```rust
fn main() {
    println!("Hello");
}
```
````

Examples:

````markdown
```javascript
function hello() {
  console.log("Hello");
}
```
````

````markdown
```python
def hello():
    print("Hello")
```
````

````markdown
```json
{
  "name": "Markdown Viewer",
  "version": "1.0.0"
}
```
````

Language labels may be used by the app's syntax highlighter when that language is recognised.

You can also use tildes instead of backticks.

```markdown
~~~
code here
~~~
```

---

# 7. Blockquotes

Start a line with `>`.

```markdown
> This is a blockquote.
```

Multiple lines:

```markdown
> This is the first line.
> This is the second line.
```

Nested blockquotes:

```markdown
> Outer quote
>
> > Nested quote
```

Blockquotes can contain other Markdown.

```markdown
> ## Quoted heading
>
> This is **bold** inside a quote.
>
> - Item one
> - Item two
```

---

# 8. Unordered lists

Use `-`, `*`, or `+`.

```markdown
- Item one
- Item two
- Item three
```

Equivalent forms:

```markdown
* Item one
* Item two
```

```markdown
+ Item one
+ Item two
```

Nested lists are created by indenting child items.

```markdown
- Parent item
  - Child item
  - Another child
- Second parent
```

For deeper nesting:

```markdown
- Level 1
  - Level 2
    - Level 3
```

Keep indentation consistent.

---

# 9. Ordered lists

Use numbers followed by a period.

```markdown
1. First
2. Second
3. Third
```

Markdown can automatically number lists even when every source item starts with `1.`.

```markdown
1. First
1. Second
1. Third
```

Nested ordered lists:

```markdown
1. First item
   1. Nested item
   2. Another nested item
2. Second item
```

You can mix ordered and unordered lists.

```markdown
1. Install the application
   - Download the file
   - Run the installer
2. Open a Markdown file
```

---

# 10. Task lists

GitHub-flavoured Markdown supports task list items.

```markdown
- [ ] Not complete
- [x] Complete
- [ ] Another task
```

They can also be nested.

```markdown
- [ ] Main task
  - [x] Finished step
  - [ ] Remaining step
```

---

# 11. Links

## Inline links

```markdown
[OpenAI](https://openai.com)
```

With a title:

```markdown
[OpenAI](https://openai.com "OpenAI website")
```

## Automatic links

URLs written directly are recognised in GitHub-flavoured Markdown.

```markdown
https://example.com
```

Email addresses may also be written as autolinks.

```markdown
<name@example.com>
```

## Reference-style links

Reference links are useful when the same destination is used several times.

```markdown
Read the [documentation][docs].

[docs]: https://example.com/docs
```

You can also add a title:

```markdown
[docs]: https://example.com/docs "Documentation"
```

---

# 12. Images

Use the same syntax as links, but add `!` at the beginning.

```markdown
![Alt text](image.png)
```

Remote image:

```markdown
![Example image](https://example.com/image.png)
```

With a title:

```markdown
![Alt text](image.png "Image title")
```

For local images, relative paths are normally resolved relative to the Markdown document.

Examples:

```markdown
![Screenshot](screenshots/app.png)
```

```markdown
![Diagram](../images/diagram.png)
```

Always include useful alt text.

---

# 13. Horizontal rules

Use three or more hyphens, asterisks, or underscores on a line by themselves.

```markdown
---
```

```markdown
***
```

```markdown
___
```

A horizontal rule is useful for separating major sections.

---

# 14. Tables

GitHub-flavoured Markdown supports tables.

```markdown
| Name | Value |
| --- | --- |
| One | 1 |
| Two | 2 |
```

## Column alignment

Use colons in the separator row.

Left aligned:

```markdown
| Name | Value |
| :--- | :--- |
| One | 1 |
```

Centered:

```markdown
| Name | Value |
| :---: | :---: |
| One | 1 |
```

Right aligned:

```markdown
| Name | Value |
| ---: | ---: |
| One | 1 |
```

Mixed alignment:

```markdown
| Name | Description | Value |
| :--- | :---: | ---: |
| Alpha | First item | 10 |
| Beta | Second item | 20 |
```

The outer `|` characters are optional.

```markdown
Name | Value
--- | ---
One | 1
Two | 2
```

Escape a pipe inside a table cell with a backslash.

```markdown
| Text |
| --- |
| A \| B |
```

---

# 15. Escaping Markdown characters

Use a backslash before a Markdown character when you want it displayed literally.

```markdown
\*not italic\*
```

```markdown
\# not a heading
```

```markdown
\- not a list item
```

```markdown
\[not a link\]
```

Common escapable characters include:

```text
\   backslash
`   backtick
*   asterisk
_   underscore
{ } braces
[ ] brackets
< > angle brackets
( ) parentheses
#   hash
+   plus
-   hyphen
.   period
!   exclamation mark
|   pipe
```

---

# 16. Literal Markdown examples

When writing documentation about Markdown itself, use fenced code blocks.

For example, to show this syntax:

```markdown
**bold**
```

write:

````markdown
```markdown
**bold**
```
````

This prevents the example from being rendered as bold text.

---

# 17. Backslashes

A backslash can escape Markdown formatting.

```markdown
\*literal asterisks\*
```

A backslash at the end of a line can also create a hard line break.

```markdown
First line\
Second line
```

To display a literal backslash, use two backslashes where necessary.

```markdown
C:\\Users\\Name
```

---

# 18. HTML

Markdown can contain raw HTML.

```html
<div>
  Custom HTML content
</div>
```

Inline HTML is also possible.

```markdown
This is <span>inline HTML</span>.
```

Use raw HTML sparingly. Plain Markdown is usually easier to read and maintain.

HTML support is useful when Markdown syntax alone is not enough for a particular layout.

---

# 19. Comments with HTML

HTML comments can be used for notes that should not appear in the rendered document.

```html
<!-- This comment is hidden in the rendered output. -->
```

This is useful for author notes, reminders, and internal documentation.

---

# 20. Special characters

Normal punctuation can be typed directly.

```markdown
© ™ → ← — – …
```

HTML entities can also be used.

```markdown
&amp;
&lt;
&gt;
&copy;
&nbsp;
```

For most modern documents, typing the Unicode character directly is simpler.

---

# 21. Nested formatting

Markdown elements can often be combined.

```markdown
**Bold with `inline code`**
```

```markdown
> A quote containing **bold text** and a [link](https://example.com).
```

```markdown
- Item with *italic text*
- Item with **bold text**
- Item with `code`
```

Avoid overly complicated nesting because it becomes difficult to read in source form.

---

# 22. Links containing formatting

Link text can contain emphasis.

```markdown
[**Important documentation**](https://example.com)
```

Images can also be wrapped in links.

```markdown
[![Alt text](image.png)](https://example.com)
```

---

# 23. Images inside tables

Images can be used inside table cells.

```markdown
| Preview | Name |
| --- | --- |
| ![Icon](icon.png) | Application icon |
```

Keep images reasonably small for readable tables.

---

# 24. Code inside lists

Indent fenced code blocks so they belong to the list item.

````markdown
1. Build the application.

   ```powershell
   cargo build --release
   ```

2. Run the executable.
````

The blank line before the code block helps keep the structure clear.

---

# 25. Multiple paragraphs inside lists

Indent additional paragraphs so they remain part of the list item.

```markdown
1. First item.

   This is another paragraph belonging to the first item.

2. Second item.
```

---

# 26. Blockquotes inside lists

```markdown
1. First item

   > A quote inside the first item.

2. Second item
```

---

# 27. Lists inside blockquotes

```markdown
> Recommended:
>
> - First item
> - Second item
> - Third item
```

---

# 28. Headings inside blockquotes

```markdown
> ## Quoted section
>
> Text inside the quoted section.
```

---

# 29. Emphasis rules and common pitfalls

These work:

```markdown
**bold**
*italic*
***bold italic***
~~strikethrough~~
```

Avoid adding spaces immediately inside the markers.

Usually avoid:

```markdown
** bold **
```

Prefer:

```markdown
**bold**
```

The same applies to italic syntax.

---

# 30. Underscores inside words

Asterisks are often clearer for emphasis when text contains underscores.

Prefer:

```markdown
*some_variable*
```

instead of relying on underscores around text that already contains underscores.

Inline code is usually best for identifiers:

```markdown
`some_variable`
```

---

# 31. Markdown inside code does not render

Markdown markers inside inline code remain literal.

```markdown
`**not bold**`
```

Markdown markers inside fenced code blocks also remain literal.

````markdown
```markdown
**not rendered as bold**
```
````

---

# 32. Blank lines matter

Blank lines separate structural blocks.

For example:

```markdown
# Heading

Paragraph below the heading.

- List item
- Another item

Next paragraph.
```

When a document looks wrong, checking blank lines is often the first useful debugging step.

---

# 33. Spaces normally collapse

Repeated spaces in ordinary prose are normally collapsed by HTML rendering.

```markdown
One     Two
```

This normally renders similarly to:

```text
One Two
```

If spacing must be preserved, use a code block.

```text
One     Two
```

---

# 34. Soft breaks versus hard breaks

Source:

```markdown
Alpha
Beta
```

This is a soft break and normally renders as one paragraph.

Source:

```markdown
Alpha  
Beta
```

The two trailing spaces create a hard line break.

Source:

```markdown
Alpha

Beta
```

The blank line creates two paragraphs.

This distinction is important when writing prose.

---

# 35. Recommended document structure

A typical Markdown document might look like this:

```markdown
# Document Title

Short introduction.

## First Section

Paragraph text.

### Subsection

More detail.

- Item one
- Item two

## Second Section

More text.

## Conclusion

Final notes.
```

Using a clear heading hierarchy also improves the Outline panel in Markdown Viewer.

---

# 36. Practical README example

````markdown
# My Project

A short description of the project.

## Features

- Fast
- Simple
- Cross-platform

## Installation

```bash
cargo build --release
```

## Usage

Open a Markdown file and start editing.

## License

MIT
````

---

# 37. Practical checklist example

```markdown
# Release Checklist

- [x] Update version
- [x] Build release
- [ ] Test on clean machine
- [ ] Create release notes
- [ ] Publish release
```

---

# 38. Practical table example

```markdown
| Feature | Status | Notes |
| :--- | :---: | ---: |
| Editing | Ready | 100% |
| Preview | Ready | 100% |
| PDF Export | Ready | 100% |
```

---

# 39. Practical code documentation example

````markdown
## Build

Run:

```powershell
cargo build --release
```

The executable will be created in:

```text
target\release\
```
````

---

# 40. Markdown characters at a glance

| Purpose | Syntax |
| --- | --- |
| Heading | `# Heading` |
| Bold | `**bold**` |
| Italic | `*italic*` |
| Bold + italic | `***text***` |
| Strikethrough | `~~text~~` |
| Inline code | `` `code` `` |
| Link | `[text](url)` |
| Image | `![alt](image.png)` |
| Blockquote | `> quote` |
| Unordered list | `- item` |
| Ordered list | `1. item` |
| Task | `- [ ] task` |
| Completed task | `- [x] task` |
| Horizontal rule | `---` |
| Table | `| A | B |` |
| Hard line break | two spaces at end of line |
| Escape | `\*literal\*` |

---

# 41. Keyboard-friendly writing tips

For readable Markdown source:

- Keep one blank line between major blocks.
- Use headings consistently.
- Prefer fenced code blocks for multi-line code.
- Use inline code for filenames, commands, identifiers, and short code fragments.
- Use descriptive link text instead of raw URLs where possible.
- Add meaningful alt text to images.
- Keep tables simple.
- Use task lists for checklists.
- Avoid excessive HTML when Markdown is sufficient.
- Keep the source readable even before previewing it.

---

# 42. Features not covered by standard GFM in this app

Some Markdown systems support extra extensions that are not part of ordinary GitHub-flavoured Markdown.

Do not assume support for features such as:

```text
Footnotes
Definition lists
Math notation
Mermaid diagrams
Wiki links
Admonition blocks
Custom containers
YAML front matter rendering
```

They may appear as plain text or behave differently unless explicit support is added to Markdown Viewer.

---

# 43. Quick example document

````markdown
# Example Document

This is a short **Markdown** example with *emphasis*, `inline code`, and a [link](https://example.com).

## Tasks

- [x] Learn headings
- [x] Learn lists
- [ ] Write documentation

## Example table

| Item | Status |
| :--- | :---: |
| Editor | Ready |
| Preview | Ready |
| PDF | Ready |

## Code

```rust
fn main() {
    println!("Hello, Markdown!");
}
```

> Markdown keeps plain text readable while still allowing rich formatting.

---
````

---

# 44. Summary

The most important Markdown rules to remember are:

1. Use blank lines between paragraphs and major blocks.
2. Use `#` for headings.
3. Use `**bold**` and `*italic*` for emphasis.
4. Use backticks for code.
5. Use `-` or numbers for lists.
6. Use `[text](url)` for links.
7. Use `![alt](path)` for images.
8. Use `>` for blockquotes.
9. Use fenced code blocks for multi-line code.
10. Use GFM tables and task lists when needed.
11. Use two trailing spaces or a trailing backslash for a hard line break.
12. Escape special characters with `\` when you need literal Markdown syntax.

Markdown is most effective when the source remains clear and readable even without the rendered preview.
