marked.setOptions({
  gfm: true,
  breaks: false,
  pedantic: false
});

// IPC Bridge
function sendToRust(command, data) {
  var msg = JSON.stringify(Object.assign({ command: command }, data || {}));
  window.ipc.postMessage(msg);
}

// Rust calls this to send events to JS
window.__fromRust = function(event, data) {
  switch (event) {
    case 'file_opened':
      addRecentFile(data.path);
      TabManager.createTab(data.path, data.content);
      break;
    case 'file_saved':
      TabManager.markClean();
      if (data.path) {
        TabManager.updateTabPath(null, data.path);
      }
      onFileSaved();
      break;
    case 'stdin_opened':
      TabManager.createTab(null, data.content, 'preview', data.title || 'stdin');
      break;
    case 'error':
      showError(data.message);
      break;
    case 'pdf_path_selected':
      var pdfPath = data.path || '';

      var pdfFilename =
        pdfPath.split(/[\\/]/).pop()
        || 'document.pdf';

      /*
      * Chromium/WebView2 uses document.title
      * as the PDF metadata title.
      */
      document.title = pdfFilename;

      /*
      * Give WebView2 a moment to register
      * the new document title before printing.
      */
      setTimeout(function() {
        sendToRust(
          'export_pdf_to_path',
          {
            path: pdfPath
          }
        );
      }, 100);

      break;
  }
};

// Cached DOM refs
var $ = {};
document.addEventListener('DOMContentLoaded', function() {
    $.editor = document.getElementById('editor');
    $.preview = document.getElementById('preview');
    $.previewContainer = document.getElementById('preview-container');
    $.editorContainer = document.getElementById('editor-container');
    $.statusInfo = document.getElementById('status-info');
    $.statusFile = document.getElementById('status-file');
    $.titlebarTitle = document.getElementById('titlebar-title');
    $.dropOverlay = document.getElementById('drop-overlay');
    $.tocPanel = document.getElementById('toc-panel');
    $.tocItems = document.getElementById('toc-list');
    $.findBar = document.getElementById('find-bar');
    $.findInput = document.getElementById('find-input');
    $.findCount = document.getElementById('find-count');
    $.zoomToast = document.getElementById('zoom-toast');
});

// State
var currentMode = 'edit';
var splitMode = false;

// Cross-mode selection helpers
function selectInPreview(text, ratio) {
  var preview = document.getElementById('preview');
  var walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT);
  var nodes = [], node, fullText = '';
  while (node = walker.nextNode()) {
    nodes.push({ node: node, start: fullText.length });
    fullText += node.textContent;
  }
  if (!nodes.length) return false;
  var textLower = text.toLowerCase(), fullLower = fullText.toLowerCase();
  var occurrences = [], idx = 0;
  while ((idx = fullLower.indexOf(textLower, idx)) !== -1) {
    occurrences.push(idx);
    idx += 1;
  }
  if (!occurrences.length) return false;
  var targetPos = ratio * fullText.length;
  var best = occurrences.reduce(function(a, b) {
    return Math.abs(b - targetPos) < Math.abs(a - targetPos) ? b : a;
  });
  var startPos = best, endPos = best + text.length;
  var startNode, startOffset, endNode, endOffset;
  for (var i = 0; i < nodes.length; i++) {
    var ns = nodes[i].start, ne = ns + nodes[i].node.textContent.length;
    if (!startNode && startPos >= ns && startPos < ne) {
      startNode = nodes[i].node; startOffset = startPos - ns;
    }
    if (endPos >= ns && endPos <= ne) {
      endNode = nodes[i].node; endOffset = endPos - ns;
    }
  }
  if (!startNode || !endNode) return false;
  var range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  var sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  if (startNode.parentElement) startNode.parentElement.scrollIntoView({ block: 'center' });
  return true;
}

function selectInEditor(text, ratio) {
  var editor = document.getElementById('editor');
  var valueLower = editor.value.toLowerCase(), textLower = text.toLowerCase();
  var occurrences = [], idx = 0;
  while ((idx = valueLower.indexOf(textLower, idx)) !== -1) {
    occurrences.push(idx);
    idx += 1;
  }
  if (!occurrences.length) return false;
  var targetPos = ratio * editor.value.length;
  var best = occurrences.reduce(function(a, b) {
    return Math.abs(b - targetPos) < Math.abs(a - targetPos) ? b : a;
  });
  editor.selectionStart = best;
  editor.selectionEnd = best + text.length;
  var lines = editor.value.substring(0, best).split('\n');
  var approxLine = lines.length - 1;
  var totalLines = editor.value.split('\n').length;
  editor.scrollTop = (approxLine / totalLines) * editor.scrollHeight - editor.clientHeight / 3;
  return true;
}

// Mode Toggle
function toggleMode() {
  if (splitMode) {
    splitMode = false;

    document.body.classList.remove('split-mode');
    document.getElementById('btn-split').classList.remove('active');

    document
      .getElementById('editor-container')
      .classList.remove('active');

    document
      .getElementById('preview-container')
      .classList.remove('active');
  }

  var iconPreview = document.getElementById('icon-preview');
  var iconEdit = document.getElementById('icon-edit');

  if (currentMode === 'edit') {
    var editor = $.editor || document.getElementById('editor');
    var content = editor.value;
    var selectedText = content.substring(editor.selectionStart, editor.selectionEnd);
    var scrollRatio = content.length > 0 ? editor.selectionStart / content.length : 0;
    var tab = TabManager.getActiveTab();
    var previewEl = $.preview || document.getElementById('preview');
    if (tab && tab.parsedHtml) {
      previewEl.innerHTML = tab.parsedHtml;
    } else {
      var html = marked.parse(content);
      previewEl.innerHTML = html;
      if (tab) tab.parsedHtml = html;
    }
    resolveLocalImages();
    ($.editorContainer || document.getElementById('editor-container')).classList.remove('active');
    ($.previewContainer || document.getElementById('preview-container')).classList.add('active');
    document.getElementById('btn-toggle').classList.add('active');
    document.getElementById('status-mode').textContent = 'PREVIEW';
    iconPreview.style.display = 'none';
    iconEdit.style.display = '';
    currentMode = 'preview';
    var pc = $.previewContainer || document.getElementById('preview-container');
    setTimeout(function() {
      if (!selectedText || !selectInPreview(selectedText, scrollRatio)) {
        pc.scrollTop = scrollRatio * (pc.scrollHeight - pc.clientHeight);
      }
    }, 0);
    if (findState.open) doFind(($.findInput || document.getElementById('find-input')).value);
  } else {
    var sel = window.getSelection();
    var selectedText = sel.toString();
    var pc = $.previewContainer || document.getElementById('preview-container');
    var scrollRatio = pc.scrollHeight > pc.clientHeight ? pc.scrollTop / (pc.scrollHeight - pc.clientHeight) : 0;
    pc.classList.remove('active');
    ($.editorContainer || document.getElementById('editor-container')).classList.add('active');
    document.getElementById('btn-toggle').classList.remove('active');
    document.getElementById('status-mode').textContent = 'EDIT';
    iconPreview.style.display = '';
    iconEdit.style.display = 'none';
    currentMode = 'edit';
    var editor = $.editor || document.getElementById('editor');
    editor.focus();
    if (!selectedText || !selectInEditor(selectedText, scrollRatio)) {
      var pos = Math.round(scrollRatio * editor.value.length);
      editor.selectionStart = editor.selectionEnd = pos;
      editor.scrollTop = scrollRatio * (editor.scrollHeight - editor.clientHeight);
    }
    if (findState.open) doFind(($.findInput || document.getElementById('find-input')).value);
  }
}

function setTitle(title) {
  ($.titlebarTitle || document.getElementById('titlebar-title')).textContent = title;
}

function onFileSaved() {
  var info = document.getElementById('status-info');
  info.textContent = 'Saved';
  setTimeout(function() { info.textContent = ''; }, 2000);
}

function showError(message) {
  var info = document.getElementById('status-info');
  info.textContent = 'Error: ' + message;
  info.style.color = '#c15050';
  setTimeout(function() { info.textContent = ''; info.style.color = ''; }, 5000);
}

// Split View
function toggleSplit() {
  var iconPreview = document.getElementById('icon-preview');
  var iconEdit = document.getElementById('icon-edit');

  if (splitMode) {
    splitMode = false;
    document.body.classList.remove('split-mode');
    document.getElementById('btn-split').classList.remove('active');
    ($.previewContainer || document.getElementById('preview-container')).classList.remove('active');
    currentMode = 'edit';
    document.getElementById('btn-toggle').classList.remove('active');
    document.getElementById('status-mode').textContent = 'EDIT';
    iconPreview.style.display = '';
    iconEdit.style.display = 'none';
    ($.editor || document.getElementById('editor')).focus();
  } else {
    splitMode = true;
    document.body.classList.add('split-mode');
    document.getElementById('btn-split').classList.add('active');
    ($.editorContainer || document.getElementById('editor-container')).classList.add('active');
    ($.previewContainer || document.getElementById('preview-container')).classList.add('active');
    var splitTab = TabManager.getActiveTab();
    var splitContent = ($.editor || document.getElementById('editor')).value;
    var splitPreviewEl = $.preview || document.getElementById('preview');
    if (splitTab && splitTab.parsedHtml) {
      splitPreviewEl.innerHTML = splitTab.parsedHtml;
    } else {
      var splitHtml = marked.parse(splitContent);
      splitPreviewEl.innerHTML = splitHtml;
      if (splitTab) splitTab.parsedHtml = splitHtml;
    }
    resolveLocalImages();
    currentMode = 'edit';
    document.getElementById('btn-toggle').classList.remove('active');
    document.getElementById('status-mode').textContent = 'SPLIT';
    iconPreview.style.display = '';
    iconEdit.style.display = 'none';
    document.getElementById('editor').focus();
  }
}

var splitPreviewTimer = null;

function updateSplitPreview() {
  if (!splitMode) return;

  clearTimeout(splitPreviewTimer);

  splitPreviewTimer =
    setTimeout(function() {

      var editor =
        $.editor ||
        document.getElementById('editor');

      var preview =
        $.preview ||
        document.getElementById('preview');

      var previewContainer =
        $.previewContainer ||
        document.getElementById(
          'preview-container'
        );

      /*
       * Capture the editor position before
       * rebuilding the preview.
       */
      var scrollRatio =
        getScrollRatio(editor);

      var tab =
        TabManager.getActiveTab();

      var content =
        editor.value;

      var html =
        marked.parse(content);

      preview.innerHTML = html;

      if (tab) {
        tab.parsedHtml = html;
      }

      resolveLocalImages();

      /*
       * Re-apply the corresponding scroll
       * position after the rendered document
       * has changed height.
       */
      requestAnimationFrame(function() {
        setScrollRatio(
          previewContainer,
          scrollRatio
        );
      });

    }, 150);
}

// Split-view scroll synchronization

var splitScrollSyncing = false;

function getScrollRatio(element) {
  var maxScroll =
    element.scrollHeight -
    element.clientHeight;

  if (maxScroll <= 0) {
    return 0;
  }

  return element.scrollTop / maxScroll;
}

function setScrollRatio(element, ratio) {
  var maxScroll =
    element.scrollHeight -
    element.clientHeight;

  if (maxScroll <= 0) {
    element.scrollTop = 0;
    return;
  }

  element.scrollTop =
    Math.max(0, Math.min(1, ratio)) *
    maxScroll;
}

function syncEditorToPreview() {
  if (!splitMode || splitScrollSyncing) {
    return;
  }

  var editor =
    $.editor ||
    document.getElementById('editor');

  var previewContainer =
    $.previewContainer ||
    document.getElementById(
      'preview-container'
    );

  splitScrollSyncing = true;

  var ratio =
    getScrollRatio(editor);

  requestAnimationFrame(function() {
    setScrollRatio(
      previewContainer,
      ratio
    );

    splitScrollSyncing = false;
  });
}

function syncPreviewToEditor() {
  if (!splitMode || splitScrollSyncing) {
    return;
  }

  var editor =
    $.editor ||
    document.getElementById('editor');

  var previewContainer =
    $.previewContainer ||
    document.getElementById(
      'preview-container'
    );

  splitScrollSyncing = true;

  var ratio =
    getScrollRatio(previewContainer);

  requestAnimationFrame(function() {
    setScrollRatio(
      editor,
      ratio
    );

    splitScrollSyncing = false;
  });
}

document
  .getElementById('editor')
  .addEventListener(
    'scroll',
    syncEditorToPreview
  );

document
  .getElementById('preview-container')
  .addEventListener(
    'scroll',
    syncPreviewToEditor
  );


// Word count
function updateEditorStatus() {
  var editor = $.editor || document.getElementById('editor');
  var text = editor.value;

  var length = text.length;
  var lines = text.split('\n').length;

  var pos = editor.selectionStart || 0;
  var beforeCaret = text.substring(0, pos);

  var line = beforeCaret.split('\n').length;
  var lastNewline = beforeCaret.lastIndexOf('\n');
  var col = pos - lastNewline;

  var words = text.trim()
    ? text.trim().split(/\s+/).length
    : 0;

  document.getElementById('status-length').textContent =
    'length: ' + length.toLocaleString();

  document.getElementById('status-lines').textContent =
    'lines: ' + lines.toLocaleString();

  document.getElementById('status-cursor').textContent =
    'Ln: ' + line +
    '   Col: ' + col +
    '   Pos: ' + pos.toLocaleString();

  document.getElementById('status-counts').textContent =
    words.toLocaleString() +
    ' word' +
    (words === 1 ? '' : 's');
}

function updateWordCount() {
  updateEditorStatus();
}

function updateLineNumbers() {
  var editor = $.editor || document.getElementById('editor');
  var gutter = document.getElementById('line-numbers');

  if (!editor || !gutter) return;

  var lineCount = editor.value.split('\n').length;
  var numbers = [];

  for (var i = 1; i <= lineCount; i++) {
    numbers.push(i);
  }

  gutter.textContent = numbers.join('\n');
}

function syncLineNumberScroll() {
  var editor = $.editor || document.getElementById('editor');
  var gutter = document.getElementById('line-numbers');

  if (!editor || !gutter) return;

  gutter.scrollTop = editor.scrollTop;
}

// Recent Files
function getRecentFiles() {
  try { return JSON.parse(localStorage.getItem('markdown-viewer-recent')) || []; } catch(e) { return []; }
}

function addRecentFile(path) {
  if (!path) return;
  var recent = getRecentFiles();
  var filename = path.split(/[/\\]/).pop();
  recent = recent.filter(function(r) { return r.path.replace(/\\/g, '/').toLowerCase() !== path.replace(/\\/g, '/').toLowerCase(); });
  recent.unshift({ path: path, filename: filename });
  if (recent.length > 10) recent = recent.slice(0, 10);
  try { localStorage.setItem('markdown-viewer-recent', JSON.stringify(recent)); } catch(e) {}
}

function showRecentPanel() {
  var panel = document.getElementById('recent-panel');
  var tab = TabManager.getActiveTab();
  if (!tab || tab.path || tab.dirty || tab.content !== '') {
    panel.classList.remove('visible');
    return;
  }
  var recent = getRecentFiles();
  if (recent.length === 0) { panel.classList.remove('visible'); return; }
  panel.innerHTML = '';
  var title = document.createElement('div');
  title.className = 'recent-title';
  title.textContent = 'Recent Files';
  panel.appendChild(title);
  recent.forEach(function(r) {
    var item = document.createElement('div');
    item.className = 'recent-item';
    var name = document.createElement('span');
    name.className = 'recent-name';
    name.textContent = r.filename;
    var path = document.createElement('span');
    path.className = 'recent-path';
    path.textContent = r.path;
    item.appendChild(name);
    item.appendChild(path);
    item.addEventListener('click', function() {
      sendToRust('open_file', { path: r.path });
    });
    panel.appendChild(item);
  });
  panel.classList.add('visible');
}

// Table of Contents
var tocOpen = false;

function parseTOC(text) {
  var lines = text.split('\n');
  var headings = [];
  var inCodeBlock = false;
  for (var i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i])) { inCodeBlock = !inCodeBlock; continue; }
    if (inCodeBlock) continue;
    var match = lines[i].match(/^(#{1,6})\s+(.+)/);
    if (match) {
      headings.push({ level: match[1].length, text: match[2].replace(/\s+#+\s*$/, '').replace(/[*_`\[\]]/g, '').trim(), line: i });
    }
  }
  return headings;
}

function updateTOC() {
  var list = $.tocItems || document.getElementById('toc-list');
  var text = ($.editor || document.getElementById('editor')).value;
  var headings = parseTOC(text);
  list.innerHTML = '';
  if (headings.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'toc-empty';
    empty.textContent = 'No headings';
    list.appendChild(empty);
    return;
  }
  headings.forEach(function(h, idx) {
    var item = document.createElement('div');
    item.className = 'toc-item toc-h' + h.level;
    item.textContent = h.text;
    item.addEventListener('click', function() {
      if (currentMode === 'edit') {
        scrollEditorToLine(h.line);
      } else {
        scrollPreviewToHeading(idx);
      }
    });
    list.appendChild(item);
  });
}

function scrollEditorToLine(lineNum) {
  var editor = document.getElementById('editor');
  var lines = editor.value.split('\n');
  var pos = 0;
  for (var i = 0; i < lineNum && i < lines.length; i++) {
    pos += lines[i].length + 1;
  }
  editor.focus();
  editor.selectionStart = pos;
  editor.selectionEnd = pos + (lines[lineNum] || '').length;
  var approxLineHeight = editor.scrollHeight / lines.length;
  editor.scrollTop = lineNum * approxLineHeight - editor.clientHeight / 3;
}

function scrollPreviewToHeading(idx) {
  var headings = document.getElementById('preview').querySelectorAll('h1,h2,h3,h4,h5,h6');
  if (headings[idx]) {
    headings[idx].scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function toggleTOC() {
  tocOpen = !tocOpen;
  document.getElementById('toc-panel').classList.toggle('open', tocOpen);
  document.getElementById('btn-toc').classList.toggle('active', tocOpen);
  if (tocOpen) updateTOC();
}

function doSave() {
  var tab = TabManager.getActiveTab();
  var data = { content: document.getElementById('editor').value };
  if (tab && tab.path) data.path = tab.path;
  sendToRust('save_file', data);
}

// Zoom
var zoomLevel = 1;
var ZOOM_STEP = 0.1;
var ZOOM_MIN = 0.5;
var ZOOM_MAX = 3;

function applyZoom(level) {
  zoomLevel = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level));
  document.documentElement.style.setProperty('--zoom', zoomLevel);
  var toast = $.zoomToast || document.getElementById('zoom-toast');
  toast.textContent = Math.round(zoomLevel * 100) + '%';
  toast.classList.add('visible');
  clearTimeout(applyZoom._timer);
  applyZoom._timer = setTimeout(function() {
    toast.classList.remove('visible');
  }, 800);
}

document.addEventListener('wheel', function(e) {
  if (e.ctrlKey) {
    e.preventDefault();
    applyZoom(zoomLevel + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
  }
}, { passive: false });

// Preview width resize
(function() {
  var handle = document.getElementById('preview-resize-handle');
  var preview = document.getElementById('preview-wrapper');
  var container = document.getElementById('preview-container');
  var DEFAULT_WIDTH = 720;
  var MIN_WIDTH = 300;

  var saved = null;
  try { saved = localStorage.getItem('markdown-viewer-preview-width'); } catch(e) {}
  if (saved) preview.style.maxWidth = saved + 'px';

  var dragging = false;

  handle.addEventListener('mousedown', function(e) {
    e.preventDefault();
    dragging = true;
    handle.classList.add('dragging');
    document.body.classList.add('preview-resizing');
  });

  document.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    var containerRect = container.getBoundingClientRect();
    var centerX = containerRect.left + containerRect.width / 2;
    var width = Math.max(MIN_WIDTH, (e.clientX - centerX) * 2);
    width = Math.min(width, containerRect.width);
    preview.style.maxWidth = Math.round(width) + 'px';
  });

  document.addEventListener('mouseup', function() {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.classList.remove('preview-resizing');
    try { localStorage.setItem('markdown-viewer-preview-width', parseInt(preview.style.maxWidth)); } catch(e) {}
  });

  handle.addEventListener('dblclick', function() {
    preview.style.maxWidth = DEFAULT_WIDTH + 'px';
    try { localStorage.setItem('markdown-viewer-preview-width', DEFAULT_WIDTH); } catch(e) {}
  });
})();

// Find
var findState = { open: false, matches: [], current: -1, marks: [] };

function openFind() {
  document.getElementById('find-bar').classList.add('open');
  findState.open = true;
  var input = document.getElementById('find-input');
  input.focus();
  input.select();
  if (input.value) doFind(input.value);
}

function closeFind() {
  document.getElementById('find-bar').classList.remove('open');
  findState.open = false;
  findState.matches = [];
  findState.current = -1;
  clearPreviewHighlights();
  document.getElementById('find-count').textContent = '';
  if (currentMode === 'edit') document.getElementById('editor').focus();
}

function doFind(term) {
  findState.matches = [];
  findState.current = -1;
  clearPreviewHighlights();
  if (!term) {
    ($.findCount || document.getElementById('find-count')).textContent = '';
    return;
  }
  if (currentMode === 'edit') {
    var text = ($.editor || document.getElementById('editor')).value.toLowerCase();
    var termLower = term.toLowerCase();
    var idx = 0;
    while ((idx = text.indexOf(termLower, idx)) !== -1) {
      findState.matches.push({ start: idx, end: idx + term.length });
      idx += term.length;
    }
  } else {
    var preview = $.preview || document.getElementById('preview');
    var walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT);
    var node, ranges = [], termLower = term.toLowerCase();
    while (node = walker.nextNode()) {
      var nodeText = node.textContent.toLowerCase();
      var idx = 0;
      while ((idx = nodeText.indexOf(termLower, idx)) !== -1) {
        var range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + term.length);
        ranges.push(range);
        idx += term.length;
      }
    }
    for (var i = ranges.length - 1; i >= 0; i--) {
      var mark = document.createElement('mark');
      mark.className = 'find-match';
      ranges[i].surroundContents(mark);
      findState.marks.unshift(mark);
    }
    findState.matches = findState.marks.map(function(_, i) { return i; });
  }
  if (findState.matches.length > 0) {
    findState.current = 0;
    goToMatch(0);
  }
  updateFindCount();
}

function clearPreviewHighlights() {
  findState.marks.forEach(function(mark) {
    var parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  });
  findState.marks = [];
}

function goToMatch(idx) {
  findState.current = idx;
  if (currentMode === 'edit') {
    var match = findState.matches[idx];
    var editor = document.getElementById('editor');
    editor.focus();
    editor.selectionStart = match.start;
    editor.selectionEnd = match.end;
  } else {
    findState.marks.forEach(function(m) { m.classList.remove('find-active'); });
    var mark = findState.marks[idx];
    mark.classList.add('find-active');
    mark.scrollIntoView({ block: 'center' });
  }
  updateFindCount();
}

function findNext() {
  if (findState.matches.length === 0) return;
  goToMatch((findState.current + 1) % findState.matches.length);
}

function findPrev() {
  if (findState.matches.length === 0) return;
  goToMatch((findState.current - 1 + findState.matches.length) % findState.matches.length);
}

function updateFindCount() {
  var el = document.getElementById('find-count');
  if (findState.matches.length === 0) {
    el.textContent = document.getElementById('find-input').value ? 'No results' : '';
  } else {
    el.textContent = (findState.current + 1) + ' of ' + findState.matches.length;
  }
}

document.getElementById('find-input').addEventListener('input', function() {
  doFind(this.value);
});
document.getElementById('find-input').addEventListener('keydown', function(e) {
  if (e.key === 'Escape') { closeFind(); e.preventDefault(); }
  else if (e.key === 'Enter' && !e.shiftKey) { findNext(); e.preventDefault(); }
  else if (e.key === 'Enter' && e.shiftKey) { findPrev(); e.preventDefault(); }
});
document.getElementById('find-close').addEventListener('click', closeFind);
document.getElementById('find-next').addEventListener('click', findNext);
document.getElementById('find-prev').addEventListener('click', findPrev);


// PDF Export
var pdfExportInProgress = false;

function getPdfOptions() {
  var colorEl = document.getElementById('pdf-color');
  var paperSizeEl = document.getElementById('pdf-paper-size');
  var orientationEl = document.getElementById('pdf-orientation');
  var marginsEl = document.getElementById('pdf-margins');
  var dateEl = document.getElementById('pdf-show-date');
  var pagesEl = document.getElementById('pdf-show-pages');

  return {
    color: colorEl ? colorEl.value : 'blue',
    paperSize: paperSizeEl ? paperSizeEl.value : 'a4',
    orientation: orientationEl ? orientationEl.value : 'portrait',
    margins: marginsEl ? marginsEl.value : 'default',
    showDate: dateEl ? dateEl.checked : true,
    showPages: pagesEl ? pagesEl.checked : true
  };
}

function savePdfOptions(options) {
  try {
    localStorage.setItem('markdown-viewer-pdf-options', JSON.stringify(options));
  } catch (e) {}
}

function restorePdfOptions() {
  var saved = null;

  try {
    saved = JSON.parse(
      localStorage.getItem('markdown-viewer-pdf-options')
    );
  } catch (e) {}

  if (!saved) return;

  var colorEl = document.getElementById('pdf-color');
  var paperSizeEl = document.getElementById('pdf-paper-size');
  var orientationEl = document.getElementById('pdf-orientation');
  var marginsEl = document.getElementById('pdf-margins');
  var dateEl = document.getElementById('pdf-show-date');
  var pagesEl = document.getElementById('pdf-show-pages');

  if (
    colorEl &&
    (saved.color === 'blue' || saved.color === 'black')
  ) {
    colorEl.value = saved.color;
  }

  if (
    paperSizeEl &&
    (saved.paperSize === 'a4' ||
     saved.paperSize === 'letter')
  ) {
    paperSizeEl.value = saved.paperSize;
  }

  if (
    orientationEl &&
    (saved.orientation === 'portrait' ||
     saved.orientation === 'landscape')
  ) {
    orientationEl.value = saved.orientation;
  }

  if (
    marginsEl &&
    (
      saved.margins === 'default' ||
      saved.margins === 'narrow' ||
      saved.margins === 'wide'
    )
  ) {
    marginsEl.value = saved.margins;
  }

  if (
    dateEl &&
    typeof saved.showDate === 'boolean'
  ) {
    dateEl.checked = saved.showDate;
  }

  if (
    pagesEl &&
    typeof saved.showPages === 'boolean'
  ) {
    pagesEl.checked = saved.showPages;
  }
}

function openPdfOptions() {
  var modal = document.getElementById('pdf-options-modal');

  if (!modal) {
    // Fallback in case the modal HTML has not been added yet.
    exportPdf({
      color: 'blue',
      paperSize: 'a4',
      orientation: 'portrait',
      margins: 'default',
      showDate: true,
      showPages: true
    });
    return;
  }

  restorePdfOptions();
  modal.classList.add('visible');

  var colorEl = document.getElementById('pdf-color');
  if (colorEl) {
    setTimeout(function() {
      colorEl.focus();
    }, 0);
  }
}

function closePdfOptions() {
  var modal = document.getElementById('pdf-options-modal');
  if (modal) {
    modal.classList.remove('visible');
  }
}

function isPdfOptionsOpen() {
  var modal = document.getElementById('pdf-options-modal');
  return !!(modal && modal.classList.contains('visible'));
}

function setPdfPageStyle(options) {
  options = options || {};

  var now = new Date();

  var date =
    String(now.getDate()).padStart(2, '0') + '/' +
    String(now.getMonth() + 1).padStart(2, '0') + '/' +
    now.getFullYear();

  var time =
    String(now.getHours()).padStart(2, '0') + ':' +
    String(now.getMinutes()).padStart(2, '0');

  var timestamp = date + ' ' + time;

  var safeTimestamp = timestamp
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');

  var leftContent = options.showDate
    ? '"' + safeTimestamp + '"'
    : '""';

  var rightContent = options.showPages
    ? 'counter(page) " / " counter(pages)'
    : '""';

  var paperSize =
    options.paperSize === 'letter'
      ? 'Letter'
      : 'A4';

  var orientation =
    options.orientation === 'landscape'
      ? 'landscape'
      : 'portrait';

  var margins;

  switch (options.margins) {
    case 'narrow':
      margins = '10mm 10mm 12mm';
      break;

    case 'wide':
      margins = '25mm 25mm 25mm';
      break;

    default:
      margins = '16mm 16mm 18mm';
      break;
  }

  var style =
    document.getElementById(
      'pdf-dynamic-page-style'
    );

  if (!style) {
    style = document.createElement('style');
    style.id = 'pdf-dynamic-page-style';
    document.head.appendChild(style);
  }

  style.textContent =
    '@media print {' +
      '@page {' +
        'size: ' + paperSize + ' ' + orientation + ';' +
        'margin: ' + margins + ';' +

        '@bottom-left {' +
          'content: ' + leftContent + ';' +
        '}' +

        '@bottom-right {' +
          'content: ' + rightContent + ';' +
        '}' +
      '}' +
    '}';
}

function exportPdf(options) {
  options = options || {
    color: 'blue',
    paperSize: 'a4',
    orientation: 'portrait',
    margins: 'default',
    showDate: true,
    showPages: true
  };

  if (pdfExportInProgress) return;

  pdfExportInProgress = true;

  var editor =
    document.getElementById('editor');

  var preview =
    document.getElementById('preview');

  var html = marked.parse(editor.value);
  preview.innerHTML = html;

  var tab = TabManager.getActiveTab();

  if (tab) {
    tab.parsedHtml = html;
  }

  resolveLocalImages();

  document.body.classList.add(
    'pdf-export',
    'pdf-paper'
  );

  document.body.classList.toggle(
    'pdf-black',
    options.color === 'black'
  );

  setPdfPageStyle({
    paperSize: options.paperSize,
    orientation: options.orientation,
    margins: options.margins,
    showDate: options.showDate,
    showPages: options.showPages
  });

  savePdfOptions({
    color: options.color === 'black' ? 'black' : 'blue',
    paperSize: options.paperSize === 'letter' ? 'letter' : 'a4',
    orientation: options.orientation === 'landscape'
      ? 'landscape'
      : 'portrait',
    margins:
      options.margins === 'narrow' || options.margins === 'wide'
        ? options.margins
        : 'default',
    showDate: options.showDate !== false,
    showPages: options.showPages !== false
  });

  setTimeout(function() {
    sendToRust('export_pdf');

    setTimeout(function() {
      pdfExportInProgress = false;
    }, 1500);

  }, 250);
};

function bindPdfOptionsUi() {
  var cancelButton = document.getElementById('pdf-cancel');
  var exportButton = document.getElementById('pdf-export-confirm');
  var modal = document.getElementById('pdf-options-modal');

  if (cancelButton) {
    cancelButton.addEventListener('click', function() {
      closePdfOptions();
    });
  }

  if (exportButton) {
    exportButton.addEventListener('click', function() {
      var options = getPdfOptions();
      closePdfOptions();
      exportPdf(options);
    });
  }

  if (modal) {
    modal.addEventListener('click', function(e) {
      if (e.target === modal) {
        closePdfOptions();
      }
    });
  }

  restorePdfOptions();
}

// Keyboard Shortcuts
document.addEventListener('keydown', function(e) {
  if (e.ctrlKey && e.key === 'f') {
    e.preventDefault();
    openFind();
  } else if (e.key === 'Escape' && findState.open) {
    e.preventDefault();
    closeFind();
  } else if (e.ctrlKey && e.key === 'o') {
    e.preventDefault();
    sendToRust('open_file');
  } else if (e.ctrlKey && !e.shiftKey && e.key === 's') {
    e.preventDefault();
    doSave();
  } else if (e.ctrlKey && e.shiftKey && (e.key === 'S' || e.key === 's')) {
    e.preventDefault();
    sendToRust('save_as', { content: document.getElementById('editor').value });
  } else if (e.ctrlKey && e.key === 'e') {
    e.preventDefault();
    toggleMode();
  } else if (e.ctrlKey && e.key === 'n') {
    e.preventDefault();
    TabManager.createTab(null, '');
  } else if (e.ctrlKey && e.key === 'w') {
    e.preventDefault();
    var active = TabManager.getActiveTab();
    if (active) TabManager.closeTab(active.id);
  } else if (e.ctrlKey && !e.shiftKey && e.key === 'Tab') {
    e.preventDefault();
    TabManager.nextTab();
  } else if (e.ctrlKey && e.shiftKey && e.key === 'Tab') {
    e.preventDefault();
    TabManager.prevTab();
  } else if (e.ctrlKey && (e.key === '=' || e.key === '+')) {
    e.preventDefault();
    applyZoom(zoomLevel + ZOOM_STEP);
  } else if (e.ctrlKey && e.key === '-') {
    e.preventDefault();
    applyZoom(zoomLevel - ZOOM_STEP);
  } else if (e.ctrlKey && e.key === '0') {
    e.preventDefault();
    applyZoom(1);
  } else if (e.ctrlKey && e.key === '\\') {
    e.preventDefault();
    toggleSplit();
  } else if (e.ctrlKey && e.shiftKey && (e.key === 'O' || e.key === 'o')) {
    e.preventDefault();
    toggleTOC();
  } else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'p') {
    e.preventDefault();
    openPdfOptions();
  } else if (e.key === 'Escape' && isPdfOptionsOpen()) {
    e.preventDefault();
    closePdfOptions();
  }
});

// Window Controls
document.getElementById('btn-minimize').addEventListener('click', function() { sendToRust('window_minimize'); });
document.getElementById('btn-maximize').addEventListener('click', function() { sendToRust('window_maximize'); });
function openCloseConfirm() {
  document
    .getElementById('close-confirm-modal')
    .classList.add('visible');
}

function closeCloseConfirm() {
  document
    .getElementById('close-confirm-modal')
    .classList.remove('visible');
}

document
  .getElementById('btn-close')
  .addEventListener('click', function() {

    if (TabManager.hasAnyDirty()) {
      openCloseConfirm();
      return;
    }

    sendToRust('window_close');
  });

document
  .getElementById('close-cancel')
  .addEventListener('click', closeCloseConfirm);

document
  .getElementById('close-confirm')
  .addEventListener('click', function() {
    closeCloseConfirm();
    sendToRust('window_close');
  });

document
  .getElementById('close-confirm-modal')
  .addEventListener('click', function(e) {
    if (e.target === this) {
      closeCloseConfirm();
    }
  });
// Toolbar Buttons
document.getElementById('btn-new').addEventListener('click', function() { TabManager.createTab(null, ''); });
document.getElementById('btn-open').addEventListener('click', function() { sendToRust('open_file'); });
document.getElementById('btn-save').addEventListener('click', doSave);
document.getElementById('btn-toggle').addEventListener('click', toggleMode);
document.getElementById('btn-split').addEventListener('click', toggleSplit);
document.getElementById('btn-toc').addEventListener('click', toggleTOC);

var printButton = document.getElementById('btn-print');
if (printButton) {
  printButton.addEventListener('click', openPdfOptions);
}

// Theme Toggle
function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('icon-sun').style.display = theme === 'light' ? '' : 'none';
  document.getElementById('icon-moon').style.display = theme === 'light' ? 'none' : '';
  try { localStorage.setItem('markdown-viewer-theme', theme); } catch(e) {}
}

document.getElementById('btn-theme').addEventListener('click', function() {
  var current = document.documentElement.getAttribute('data-theme') || 'dark';
  setTheme(current === 'dark' ? 'light' : 'dark');
});

var editorStatusElement =
  $.editor || document.getElementById('editor');

editorStatusElement.addEventListener('click', updateEditorStatus);
editorStatusElement.addEventListener('keyup', updateEditorStatus);
editorStatusElement.addEventListener('select', updateEditorStatus);

editorStatusElement.addEventListener('scroll', function() {
  syncLineNumberScroll();
  updateEditorStatus();
});

// Init
document.addEventListener('DOMContentLoaded', function() {
  var saved = null;
  try { saved = localStorage.getItem('markdown-viewer-theme'); } catch(e) {}
  if (saved) setTheme(saved);
  TabManager.createTab(null, '');
  updateWordCount();
  showRecentPanel();
  bindPdfOptionsUi();
  sendToRust('ready');
});
