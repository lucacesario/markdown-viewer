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

/*
 * Open external Markdown links in the default browser.
 * Keep the Markdown Viewer on its own document.
 */
document.addEventListener('click', function(event) {
  if (!event.target || !event.target.closest) return;

  var link = event.target.closest('a[href]');
  if (!link) return;

  if (!link.closest('#preview, #guide-content')) return;

  event.preventDefault();
  event.stopPropagation();

  var href = link.getAttribute('href');
  if (!href) return;

  // Preserve in-document heading navigation.
  if (href.charAt(0) === '#') {
    var target = document.getElementById(
      decodeURIComponent(href.substring(1))
    );
    if (target) target.scrollIntoView({ behavior: 'smooth' });
    return;
  }

  try {
    var url = new URL(href, document.baseURI);

    // Only external HTTP(S) URLs can launch the browser.
    if (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.hostname !== 'markdown-viewer.localhost'
    ) {
      sendToRust('open_external', { path: url.href });
    }
  } catch (error) {
    console.warn('Invalid Markdown link:', href);
  }
});

// Rust calls this to send events to JS
window.__fromRust = function(event, data) {
  switch (event) {
    case 'screenshot_saved': {
      var pending = window.pendingScreenshotPaste;
      window.pendingScreenshotPaste = null;

      if (!pending || !data || !data.path) {
        showError('Screenshot saved, but no insertion location was found.');
        break;
      }

      var activeTab = TabManager.getActiveTab();
      var editor = document.getElementById('editor');

      // Avoid inserting into the wrong document if tabs changed.
      if (
        !activeTab ||
        activeTab.id !== pending.tabId ||
        activeTab.path !== pending.documentPath
      ) {
        showError(
          'Screenshot saved, but the active document changed. ' +
          'Return to the original document to insert its image path.'
        );
        break;
      }

      // Escape spaces and parentheses for Markdown links.
      var imagePath = encodeURI(
        data.path.replace(/\\/g, '/')
      ).replace(/\(/g, '%28').replace(/\)/g, '%29');

      var markdown = '![Screenshot](' + imagePath + ')';

      editor.setRangeText(
        markdown,
        pending.start,
        pending.end,
        'end'
      );

      // Programmatic changes need an input event.
      editor.dispatchEvent(new Event('input', {
        bubbles: true
      }));

      // Mark the document dirty immediately.
      TabManager.markDirty();

      editor.focus();

      console.log('Screenshot saved:', data.path);
      break;
    }
    case 'file_check_result':
      handleLiveReadResult(data);
      break;
    case 'file_opened': {
      addRecentFile(data.path);
      TabManager.createTab(data.path, data.content);

      var openedTab = TabManager.getActiveTab();
      if (openedTab) {
        openedTab.liveReadDiskContent = data.content;
        openedTab.liveReadConflict = false;
      }
      break;
    }
    case 'save_conflict':
      showSaveConflict(data);
      break;
    case 'file_saved':
      TabManager.markClean();
      var savedTab = TabManager.getActiveTab();
      if (savedTab) {
        savedTab.liveReadDiskContent =
          document.getElementById('editor').value;
        savedTab.liveReadConflict = false;
      }
      updateLiveReadWarning();
      if (data.path) {
        TabManager.updateTabPath(null, data.path);
        addRecentFile(data.path);
      }
      onFileSaved();
      break;
    case 'stdin_opened':
      TabManager.createTab(null, data.content, 'preview', data.title || 'stdin');
      break;
    case 'error':
      window.pendingScreenshotPaste = null;
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


/* Live Read —
 * Watch only the active, saved document.
 * Never replace unsaved editor changes.
 */
var liveReadPending = null;
var liveReadLastCheck = 0;
var liveReadRequestId = 0;

/* Live Read user preference */
var liveReadEnabled = true;


/* Follow Mode */
var followModeEnabled = false;

try {
  followModeEnabled =
    localStorage.getItem('markdown-viewer-follow-mode') === 'on';
} catch (error) {
  // Follow Mode stays off if storage is unavailable.
}

function updateFollowButton() {
  var button = document.getElementById('btn-follow');
  var label = document.getElementById('follow-label');
  if (!button || !label) return;

  button.classList.toggle('active', followModeEnabled);
  button.setAttribute('aria-pressed', String(followModeEnabled));
  button.title = followModeEnabled
    ? 'Disable Follow Mode'
    : 'Enable Follow Mode';

  label.textContent = followModeEnabled
    ? 'FOLLOW ON'
    : 'FOLLOW OFF';
}

function toggleFollowMode() {
  followModeEnabled = !followModeEnabled;

  try {
    localStorage.setItem(
      'markdown-viewer-follow-mode',
      followModeEnabled ? 'on' : 'off'
    );
  } catch (error) {
    console.warn('Unable to save Follow Mode preference:', error);
  }

  updateFollowButton();
}

try {
  liveReadEnabled =
    localStorage.getItem('markdown-viewer-live-read') !== 'off';
} catch (error) {
  // Keep Live Read enabled if storage is unavailable.
}

function updateLiveReadButton() {
  var button = document.getElementById('btn-live-read');
  var label = document.getElementById('live-read-label');

  if (!button || !label) return;

  button.classList.toggle('active', liveReadEnabled);
  button.setAttribute('aria-pressed', String(liveReadEnabled));
  button.title = liveReadEnabled
    ? 'Pause Live Read'
    : 'Resume Live Read';

  label.textContent = liveReadEnabled ? 'LIVE ON' : 'LIVE OFF';
}

function updateLiveReadWarning() {
  var warning = document.getElementById('live-read-warning');
  var tab = TabManager.getActiveTab();

  if (!warning) return;

  warning.hidden = !(
    tab &&
    tab.path &&
    tab.dirty &&
    tab.liveReadConflict
  );
}

// Create a warning separate from transient status messages.
var liveReadWarning = document.createElement('span');
liveReadWarning.id = 'live-read-warning';
liveReadWarning.textContent =
  '⚠ File changed on disk — unsaved edits preserved';
liveReadWarning.title =
  'The file changed externally. Your local edits were not replaced. ' +
  'Saving now may overwrite the external changes.';
liveReadWarning.hidden = true;

document.getElementById('status-info')
  .insertAdjacentElement('afterend', liveReadWarning);

function toggleLiveRead() {
  liveReadEnabled = !liveReadEnabled;

  try {
    localStorage.setItem(
      'markdown-viewer-live-read',
      liveReadEnabled ? 'on' : 'off'
    );
  } catch (error) {
    console.warn('Unable to save Live Read preference:', error);
  }

  updateLiveReadButton();

  if (liveReadEnabled) {
    liveReadLastCheck = 0;
    checkLiveRead();
  }
}

function checkLiveRead() {
  if (!liveReadEnabled) return;

  var tab = TabManager.getActiveTab();

  if (!tab || !tab.path) return;
  if (liveReadPending) return;

  var now = Date.now();
  if (now - liveReadLastCheck < 1000) return;

  liveReadLastCheck = now;
  var requestId = ++liveReadRequestId;

  liveReadPending = {
    tabId: tab.id,
    path: tab.path,
    started: now,
    requestId: requestId
  };

  sendToRust('check_file_change', {
    path: tab.path,
    request_id: requestId
  });
}

function findLiveChangePosition(oldText, newText) {
  if (oldText === newText) return -1;

  var position = 0;
  var limit = Math.min(oldText.length, newText.length);

  while (
    position < limit &&
    oldText.charAt(position) === newText.charAt(position)
  ) {
    position++;
  }

  return position;
}

function handleLiveReadResult(data) {
  var pending = liveReadPending;

  // Ignore manual, outdated or unrelated IPC responses.
  if (!pending || !data ||
      data.request_id !== pending.requestId) {
    return;
  }

  liveReadPending = null;
  if (!liveReadEnabled) return;

  var tab = TabManager.getActiveTab();

  // Ignore responses for a document that is no longer active.
  if (!tab ||
      tab.id !== pending.tabId ||
      tab.path !== pending.path ||
      data.path !== pending.path) {
    return;
  }

  if (!data.ok) {
    // Temporary missing/locked files must not clear the editor.
    console.warn('Live Read:', data.message);
    return;
  }

  // Establish the last known disk version for this tab.
  if (typeof tab.liveReadDiskContent !== 'string') {
    tab.liveReadDiskContent = tab.content;
  }

  // Detect external changes without replacing unsaved local edits.
  if (tab.dirty) {
    tab.liveReadConflict =
      data.content !== tab.liveReadDiskContent;

    updateLiveReadWarning();
    return;
  }

  tab.liveReadConflict = false;
  updateLiveReadWarning();

  var editor = document.getElementById('editor');

  var newContent = data.content;
  if (typeof newContent !== 'string') return;
  if (newContent === editor.value) {
    tab.liveReadDiskContent = newContent;
    return;
  }

  /* detect content appended after existing Markdown. */
  var oldContent = editor.value;
  var liveChangePosition =
    findLiveChangePosition(oldContent, newContent);

  var preview = document.getElementById('preview');
  var previewContainer =
    document.getElementById('preview-container');

  var maxScroll =
    previewContainer.scrollHeight - previewContainer.clientHeight;

  var scrollRatio = maxScroll > 0
    ? previewContainer.scrollTop / maxScroll
    : 0;

  var editorScroll = editor.scrollTop;
  var cursorStart = editor.selectionStart;
  var cursorEnd = editor.selectionEnd;

  // Update the existing tab, not a new tab.
  tab.content = newContent;
  tab.liveReadDiskContent = newContent;
  tab.liveReadConflict = false;
  tab.parsedHtml = null;
  editor.value = newContent;

  // Preserve editor position within the new document length.
  editor.selectionStart =
    Math.min(cursorStart, newContent.length);
  editor.selectionEnd =
    Math.min(cursorEnd, newContent.length);

  editor.scrollTop = editorScroll;

  // Rebuild the preview only when it is visible.
  if (splitMode || currentMode === 'preview') {

    // Render the previous document separately so diagram
    // enhancements and copy buttons don't affect comparison.
    var oldPreview = document.createElement('div');
    oldPreview.innerHTML = renderMarkdownSafe(oldContent);

    var html = renderMarkdownSafe(newContent);

    var newPreview = document.createElement('div');
    newPreview.innerHTML = html;

    var oldBlocks = Array.from(oldPreview.children);
    var newBlocks = Array.from(newPreview.children);

    // Find unchanged blocks at the beginning.
    var firstChanged = 0;

    while (
      firstChanged < oldBlocks.length &&
      firstChanged < newBlocks.length &&
      oldBlocks[firstChanged].outerHTML ===
        newBlocks[firstChanged].outerHTML
    ) {
      firstChanged++;
    }

    // Find unchanged blocks at the end.
    var oldTail = oldBlocks.length - 1;
    var newTail = newBlocks.length - 1;

    while (
      oldTail >= firstChanged &&
      newTail >= firstChanged &&
      oldBlocks[oldTail].outerHTML ===
        newBlocks[newTail].outerHTML
    ) {
      oldTail--;
      newTail--;
    }

    tab.parsedHtml = html;
    preview.innerHTML = html;

    restoreCodeCopyIcons(preview);
    renderAllDiagrams(preview);
    resolveLocalImages();

    // Highlight all affected blocks in the updated document.
    var changedBlocks = Array.from(preview.children)
      .slice(firstChanged, newTail + 1);

    // If blocks were only deleted, highlight the nearest
    // surviving block to show where the change happened.
    if (
      changedBlocks.length === 0 &&
      oldPreview.innerHTML !== newPreview.innerHTML &&
      preview.children.length > 0
    ) {
      var nearestIndex = Math.min(
        firstChanged,
        preview.children.length - 1
      );

      changedBlocks.push(preview.children[nearestIndex]);
    }

    changedBlocks.forEach(function(block) {
      block.classList.add('live-read-new-block');
    });

    requestAnimationFrame(function() {
      var currentTab = TabManager.getActiveTab();
      if (!currentTab || currentTab.id !== pending.tabId) return;

      var newMaxScroll =
        previewContainer.scrollHeight -
        previewContainer.clientHeight;

      if (followModeEnabled && liveReadEnabled &&
          liveChangePosition >= 0) {

        var textBeforeChange =
          newContent.slice(0, liveChangePosition);

        var changedLine =
          textBeforeChange.split('\n').length - 1;

        var totalLines =
          Math.max(1, newContent.split('\n').length);

        var changeRatio = changedLine / totalLines;

        previewContainer.scrollTop =
          Math.max(0, newMaxScroll * changeRatio);

      } else {
        // Preserve reading position when Follow Mode is OFF.
        previewContainer.scrollTop =
          scrollRatio * Math.max(0, newMaxScroll);
      }

      updateReadingIndicators();
    });
  }

  if (typeof updateLineNumbers === 'function') {
    updateLineNumbers();
  }

  if (typeof updateWordCount === 'function') {
    updateWordCount();
  }

  if (typeof tocOpen !== 'undefined' &&
      tocOpen &&
      typeof updateTOC === 'function') {
    updateTOC();
  }

  console.log('Live Read: refreshed', tab.path);

}

// Clear Live Read highlights when the user clicks inside
// the document. Scrolling alone does not clear them.
document.getElementById('content')
  .addEventListener('pointerdown', function(event) {
    if (!event.target.closest(
      '#editor-container, #preview-container'
    )) {
      return;
    }

    document.querySelectorAll(
      '#preview .live-read-new-block'
    ).forEach(function(block) {
      block.classList.remove('live-read-new-block');
    });
  });

// Poll only the active file; no folder watching.
setInterval(function() {
  if (liveReadPending &&
      Date.now() - liveReadPending.started > 5000) {
    liveReadPending = null;
  }
  updateLiveReadWarning();
  checkLiveRead();
}, 1000);

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
      var html = renderMarkdownSafe(content);
      previewEl.innerHTML = html;
      if (tab) tab.parsedHtml = html;
    }
    restoreCodeCopyIcons(previewEl);
    renderAllDiagrams(previewEl);
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

  requestAnimationFrame(updateReadingIndicators);
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
      var splitHtml = renderMarkdownSafe(splitContent);
      splitPreviewEl.innerHTML = splitHtml;
      if (splitTab) splitTab.parsedHtml = splitHtml;
    }
    restoreCodeCopyIcons(splitPreviewEl);
    renderAllDiagrams(splitPreviewEl);
    resolveLocalImages();
    currentMode = 'edit';
    document.getElementById('btn-toggle').classList.remove('active');
    document.getElementById('status-mode').textContent = 'SPLIT';
    iconPreview.style.display = '';
    iconEdit.style.display = 'none';
    document.getElementById('editor').focus();
  }

  requestAnimationFrame(updateReadingIndicators);
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
        renderMarkdownSafe(content);

      preview.innerHTML = html;
      restoreCodeCopyIcons(preview);
      renderAllDiagrams(preview);

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

        updateReadingIndicators();
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

document.getElementById('preview-container')
  .addEventListener('scroll', updateReadingIndicators);

/* Reading time and progress */

var READING_WORDS_PER_MINUTE = 225;

function updateReadingIndicators() {
  var editor = document.getElementById('editor');
  var wordCount = document.getElementById('status-counts');
  var previewContainer = document.getElementById('preview-container');

  if (!editor || !wordCount || !previewContainer) return;

  var readingInfo = document.getElementById('status-reading');

  // Create the status bar elements once.
  if (!readingInfo) {
    readingInfo = document.createElement('span');
    readingInfo.id = 'status-reading';
    readingInfo.className = 'reading-status';
    wordCount.insertAdjacentElement('afterend', readingInfo);
  }

  var progressInfo = document.getElementById('status-reading-progress');

  if (!progressInfo) {
    progressInfo = document.createElement('span');
    progressInfo.id = 'status-reading-progress';
    progressInfo.className = 'reading-progress-status';

    var progressText = document.createElement('span');
    progressText.className = 'reading-progress-text';

    var track = document.createElement('span');
    track.className = 'reading-progress-track';

    var fill = document.createElement('span');
    fill.className = 'reading-progress-fill';
    track.appendChild(fill);

    progressInfo.appendChild(progressText);
    progressInfo.appendChild(track);

    readingInfo.insertAdjacentElement('afterend', progressInfo);
  }

  // Count words using the same simple method as the status bar.
  var text = editor.value.trim();
  var words = text ? text.split(/\s+/).length : 0;

  var minutes = words === 0
    ? 0
    : Math.max(1, Math.ceil(words / READING_WORDS_PER_MINUTE));

  readingInfo.textContent = minutes + ' min read';

  // Reading progress is only meaningful with a visible preview.
  var previewVisible = splitMode || currentMode === 'preview';

  progressInfo.style.display = previewVisible ? 'inline-flex' : 'none';

  if (!previewVisible) return;

  var maxScroll =
    previewContainer.scrollHeight - previewContainer.clientHeight;

  var percentage = maxScroll <= 0
    ? 100
    : Math.round((previewContainer.scrollTop / maxScroll) * 100);

  percentage = Math.max(0, Math.min(100, percentage));

  progressInfo.querySelector('.reading-progress-text').textContent =
    percentage + '%';

  progressInfo.querySelector('.reading-progress-fill').style.width =
    percentage + '%';
}

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

  updateReadingIndicators();
}

function updateWordCount() {
  updateEditorStatus();
}

function updateLineNumbers() {
  var editor =
    $.editor ||
    document.getElementById('editor');

  var gutter =
    document.getElementById('line-numbers');

  if (!editor || !gutter) return;

  /*
   * Logical lines only.
   *
   * This preserves empty lines and also preserves
   * the final empty line when the document ends
   * with a newline.
   */
  var lines = editor.value.split(/\r\n|\r|\n/);

  /*
   * Hidden mirror used only to determine how many
   * visual rows a logical line occupies.
   */
  var mirror =
    document.getElementById('line-measure-mirror');

  if (!mirror) {
    mirror = document.createElement('div');
    mirror.id = 'line-measure-mirror';

    mirror.style.position = 'absolute';
    mirror.style.left = '-100000px';
    mirror.style.top = '0';
    mirror.style.visibility = 'hidden';
    mirror.style.pointerEvents = 'none';

    mirror.style.boxSizing = 'border-box';
    mirror.style.margin = '0';
    mirror.style.padding = '0';
    mirror.style.border = '0';
    
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.overflowWrap = 'break-word';
    mirror.style.wordBreak = 'normal';

    document.body.appendChild(mirror);
  }

  var style =
    window.getComputedStyle(editor);

  /*
   * Copy the typography used by the textarea.
   */
  mirror.style.fontFamily =
    style.fontFamily;

  mirror.style.fontSize =
    style.fontSize;

  mirror.style.fontWeight =
    style.fontWeight;

  mirror.style.fontStyle =
    style.fontStyle;

  mirror.style.lineHeight =
    style.lineHeight;

  mirror.style.letterSpacing =
    style.letterSpacing;

  mirror.style.fontKerning =
    style.fontKerning;

  mirror.style.fontVariantLigatures =
    style.fontVariantLigatures;

  mirror.style.fontFeatureSettings =
    style.fontFeatureSettings;

  mirror.style.tabSize =
    style.tabSize;

  /*
   * Measure against the usable text width,
   * excluding textarea padding.
   */
  var paddingLeft =
    parseFloat(style.paddingLeft) || 0;

  var paddingRight =
    parseFloat(style.paddingRight) || 0;

  var contentWidth =
    editor.clientWidth -
    paddingLeft -
    paddingRight;

  mirror.style.width =
    Math.max(1, contentWidth) + 'px';

  var lineHeight =
    parseFloat(style.lineHeight);

  if (!lineHeight || isNaN(lineHeight)) {
    lineHeight =
      parseFloat(style.fontSize) * 1.8;
  }

  gutter.innerHTML = '';

  lines.forEach(function(line, index) {
    /*
     * An empty logical line must still consume
     * exactly one visual editor row.
     *
     * Zero-width space gives the mirror something
     * measurable without changing the width.
     */
    mirror.textContent =
      line === ''
        ? '\u200b'
        : line;

    var measuredHeight =
      mirror.getBoundingClientRect().height;

    /*
     * Convert the measured height into whole
     * visual rows.
     */
    var visualRows =
      Math.max(
        1,
        Math.round(
          measuredHeight / lineHeight
        )
      );

    var number =
      document.createElement('div');

    number.className =
      'line-number';

    number.textContent =
      index + 1;

    /*
     * One logical number, but enough height to
     * follow any visual wrapping in the textarea.
     */
    number.style.height =
      (visualRows * lineHeight) + 'px';

    number.style.lineHeight =
      lineHeight + 'px';

    gutter.appendChild(number);
  });

  syncLineNumberScroll();
}

var lineNumberResizeObserver =
  new ResizeObserver(function() {
    updateLineNumbers();
  });

lineNumberResizeObserver.observe(
  document.getElementById('editor')
);

// Keep search decorations aligned after layout changes.
window.addEventListener('resize', function() {
  if (editorSearchLayer) updateEditorSearchHighlights();
});

document.getElementById('editor').addEventListener('input', function() {
  if (findState.open) {
    doFind(document.getElementById('find-input').value);
  }
});

function syncLineNumberScroll() {
  var editor = $.editor || document.getElementById('editor');
  var gutter = document.getElementById('line-numbers');

  if (!editor || !gutter) return;

  gutter.scrollTop = editor.scrollTop;
  if (editorSearchLayer) {
    editorSearchLayer.scrollTop = editor.scrollTop;
    editorSearchLayer.scrollLeft = editor.scrollLeft;
  }
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

  if (
    !tab ||
    tab.showRecent !== true ||
    tab.path ||
    tab.dirty ||
    tab.content !== ''
  ) {
    panel.classList.remove('visible');
    return;
  }

  var recent = getRecentFiles();

  if (recent.length === 0) {
    panel.classList.remove('visible');
    return;
  }

  panel.innerHTML = '';

  var title = document.createElement('div');
  title.className = 'recent-title';
  title.textContent = 'Recent Files';
  panel.appendChild(title);

  
  // Button to clear the recent files history
  var clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.className = 'recent-clear-button';
  clearButton.textContent = 'Clear Recent Files';

  clearButton.addEventListener('click', function() {
    openConfirmModal(
      'Are you sure you want to clear your recent files? Your actual files will not be deleted.',
      function() {
        try {
          localStorage.removeItem('markdown-viewer-recent');
          showRecentPanel();
        } catch (e) {
          showError('Unable to clear recent files.');
        }
      },
      'Clear Recent Files',
      'Clear'
    );
  });


  panel.appendChild(clearButton);


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

/* ============================================
   Quick Open — Files and Commands
   ============================================ */

var quickOpenItems = [];
var quickOpenSelected = 0;
var quickOpenPreviousFocus = null;

var quickOpenCommands = [
  {
    label: 'New Document',
    description: 'Create a new Markdown tab',
    keywords: 'new document tab',
    run: function() {
      TabManager.createTab(null, '', 'edit', 'Untitled', false);
    }
  },
  {
    label: 'Open File...',
    description: 'Choose a file from your computer',
    keywords: 'open browse file',
    run: function() {
      sendToRust('open_file');
    }
  },
  {
    label: 'Save Document',
    description: 'Save the active document',
    keywords: 'save write',
    run: function() {
      doSave();
    }
  },
  {
    label: 'Save As...',
    description: 'Choose a filename and location',
    keywords: 'save as rename location',
    run: function() {
      sendToRust('save_as', {
        content: document.getElementById('editor').value
      });
    }
  },
  {
    label: 'Toggle Preview',
    description: 'Switch between editing and reading',
    keywords: 'preview edit read',
    run: function() {
      toggleMode();
    }
  },
  {
    label: 'Toggle Split View',
    description: 'Show editor and preview together',
    keywords: 'split view side by side',
    run: function() {
      toggleSplit();
    }
  },
  {
    label: 'Markdown Guide',
    description: 'Open the Markdown reference guide',
    keywords: 'guide help markdown',
    run: function() {
      openMarkdownGuide();
    }
  },
  {
    label: 'Export PDF',
    description: 'Open PDF export options',
    keywords: 'pdf export print',
    run: function() {
      openPdfOptions();
    }
  },
  {
    label: 'Find in Document',
    description: 'Search the current Markdown document',
    keywords: 'find search text',
    run: function() {
      openFind();
    }
  },
  {
    label: 'Table of Contents',
    description: 'Toggle the document outline',
    keywords: 'toc outline headings',
    run: function() {
      toggleTOC();
    }
  }
];

function isQuickOpenVisible() {
  var modal = document.getElementById('quick-open-modal');
  return !!modal && modal.classList.contains('visible');
}

function openQuickOpen() {
  var modal = document.getElementById('quick-open-modal');
  var input = document.getElementById('quick-open-input');

  if (isQuickOpenVisible()) return;

  quickOpenPreviousFocus = document.activeElement;

  modal.classList.add('visible');
  modal.setAttribute('aria-hidden', 'false');

  input.value = '';
  quickOpenSelected = 0;

  renderQuickOpen();
  input.focus();
}

function closeQuickOpen() {
  var modal = document.getElementById('quick-open-modal');

  if (!isQuickOpenVisible()) return;

  var target = quickOpenPreviousFocus;
  quickOpenPreviousFocus = null;

  // Restore focus before marking the modal hidden.
  if (target && target.isConnected &&
      typeof target.focus === 'function') {
    target.focus();
  } else {
    document.getElementById('editor').focus();
  }

  modal.classList.remove('visible');
  modal.setAttribute('aria-hidden', 'true');
}

function renderQuickOpen() {
  var input = document.getElementById('quick-open-input');
  var results = document.getElementById('quick-open-results');
  var query = input.value.trim().toLowerCase();

  var commands = quickOpenCommands
    .filter(function(command) {
      return (
        command.label.toLowerCase().includes(query) ||
        command.description.toLowerCase().includes(query) ||
        command.keywords.toLowerCase().includes(query)
      );
    })
    .map(function(command) {
      return {
        type: 'command',
        label: command.label,
        description: command.description,
        run: command.run
      };
    });

  var files = getRecentFiles()
    .filter(function(file) {
      return (
        String(file.filename || '').toLowerCase().includes(query) ||
        String(file.path || '').toLowerCase().includes(query)
      );
    })
    .map(function(file) {
      return {
        type: 'file',
        label: file.filename || file.path,
        description: file.path,
        path: file.path
      };
    });

  // Commands first, recent files second.
  quickOpenItems = commands.concat(files);

  results.replaceChildren();

  if (!quickOpenItems.length) {
    var empty = document.createElement('div');
    empty.className = 'quick-open-empty';
    empty.textContent = 'No matching files or commands';
    results.appendChild(empty);
    quickOpenSelected = -1;
    return;
  }

  quickOpenSelected = Math.max(
    0,
    Math.min(quickOpenSelected, quickOpenItems.length - 1)
  );

  quickOpenItems.forEach(function(entry, index) {
    var item = document.createElement('button');
    item.type = 'button';
    item.className = 'quick-open-item';

    if (index === quickOpenSelected) {
      item.classList.add('selected');
    }

    var name = document.createElement('span');
    name.className = 'quick-open-filename';
    name.textContent = entry.label;

    var description = document.createElement('span');
    description.className = 'quick-open-path';
    description.textContent = entry.description;

    item.appendChild(name);
    item.appendChild(description);

    item.addEventListener('mouseenter', function() {
      quickOpenSelected = index;
      updateQuickOpenSelection();
    });

    item.addEventListener('click', function() {
      activateQuickOpenItem(index);
    });

    results.appendChild(item);
  });
}

function updateQuickOpenSelection() {
  var items = document.querySelectorAll('.quick-open-item');

  items.forEach(function(item, index) {
    item.classList.toggle(
      'selected',
      index === quickOpenSelected
    );
  });

  if (items[quickOpenSelected]) {
    items[quickOpenSelected].scrollIntoView({
      block: 'nearest'
    });
  }
}

function activateQuickOpenItem(index) {
  var entry = quickOpenItems[index];

  if (!entry) return;

  closeQuickOpen();

  if (entry.type === 'command') {
    entry.run();
  } else if (entry.type === 'file' && entry.path) {
    sendToRust('open_file', {
      path: entry.path
    });
  }
}

document.getElementById('quick-open-input')
  .addEventListener('input', function() {
    quickOpenSelected = 0;
    renderQuickOpen();
  });

document.getElementById('quick-open-input')
  .addEventListener('keydown', function(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();

      if (quickOpenItems.length) {
        quickOpenSelected =
          (quickOpenSelected + 1) % quickOpenItems.length;
        updateQuickOpenSelection();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();

      if (quickOpenItems.length) {
        quickOpenSelected =
          (quickOpenSelected - 1 + quickOpenItems.length) %
          quickOpenItems.length;
        updateQuickOpenSelection();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      activateQuickOpenItem(quickOpenSelected);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeQuickOpen();
    }
  });

document.getElementById('quick-open-modal')
  .addEventListener('click', function(e) {
    if (e.target === this) {
      closeQuickOpen();
    }
  });

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

var saveConflictPath = null;
var saveConflictDiskContent = null;
var saveConflictTabId = null;

function showSaveConflict(data) {
  var tab = TabManager.getActiveTab();

  if (!tab || !data ||
      tab.path !== data.path ||
      typeof data.disk_content !== 'string') {
    return;
  }

  saveConflictPath = data.path;
  saveConflictDiskContent = data.disk_content;
  saveConflictTabId = tab.id;

  var modal = document.getElementById('save-conflict-modal');
  modal.classList.add('visible');
  modal.setAttribute('aria-hidden', 'false');

  document.getElementById('save-conflict-cancel').focus();
}

function closeSaveConflict() {
  saveConflictPath = null;
  saveConflictDiskContent = null;
  saveConflictTabId = null;

  var modal = document.getElementById('save-conflict-modal');
  modal.classList.remove('visible');
  modal.setAttribute('aria-hidden', 'true');
}

function getSaveConflictAction() {
  var tab = TabManager.getActiveTab();

  if (!tab ||
      tab.id !== saveConflictTabId ||
      tab.path !== saveConflictPath ||
      typeof saveConflictDiskContent !== 'string') {
    return null;
  }

  return {
    path: saveConflictPath,
    content: document.getElementById('editor').value,
    expected_content: saveConflictDiskContent
  };
}

function doSave() {
  var tab = TabManager.getActiveTab();

  var data = {
    content: document.getElementById('editor').value
  };

  if (tab && tab.path) {
    data.path = tab.path;

    // Rust uses this to detect external changes before writing.
    if (typeof tab.liveReadDiskContent === 'string') {
      data.expected_content = tab.liveReadDiskContent;
    }
  }

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


/* Search highlighting behind the editor textarea */
var editorSearchLayer = null;

function updateEditorSearchHighlights() {
  var editor = document.getElementById('editor');
  if (!editor) return;

  if (!editorSearchLayer) {
    var parent = editor.parentElement;

    if (getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }

    editorSearchLayer = document.createElement('div');
    editorSearchLayer.className = 'editor-search-layer';
    editorSearchLayer.setAttribute('aria-hidden', 'true');

    parent.insertBefore(editorSearchLayer, editor);

    var background = getComputedStyle(editor).backgroundColor;
    editorSearchLayer.style.backgroundColor = background;

    editor.style.position = 'relative';
    editor.style.zIndex = '1';
    editor.style.backgroundColor = 'transparent';
  }

  var layer = editorSearchLayer;
  var style = getComputedStyle(editor);
  var parentRect = editor.parentElement.getBoundingClientRect();
  var editorRect = editor.getBoundingClientRect();

  layer.style.left = (editorRect.left - parentRect.left) + 'px';
  layer.style.top = (editorRect.top - parentRect.top) + 'px';
  layer.style.width = editorRect.width + 'px';
  layer.style.height = editorRect.height + 'px';

  [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle',
    'lineHeight', 'letterSpacing', 'tabSize',
    'padding', 'border', 'borderRadius',
    'whiteSpace', 'overflowWrap', 'wordBreak'
  ].forEach(function(prop) {
    layer.style[prop] = style[prop];
  });

  layer.replaceChildren();

  if (findState.open && findState.matches.length) {
    var content = editor.value;
    var position = 0;
    var fragment = document.createDocumentFragment();

    findState.matches.forEach(function(match, index) {
      fragment.appendChild(
        document.createTextNode(
          content.substring(position, match.start)
        )
      );

      var mark = document.createElement('mark');
      mark.className = 'editor-find-match';

      if (index === findState.current) {
        mark.classList.add('active');
      }

      mark.textContent = content.substring(match.start, match.end);
      fragment.appendChild(mark);

      position = match.end;
    });

    fragment.appendChild(
      document.createTextNode(content.substring(position))
    );

    layer.appendChild(fragment);
  } else {
    layer.textContent = editor.value;
  }

  layer.scrollTop = editor.scrollTop;
  layer.scrollLeft = editor.scrollLeft;
}

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
  updateEditorSearchHighlights();
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
  updateEditorSearchHighlights();
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
    var findInput = document.getElementById('find-input');

    // Select the current match.
    editor.setSelectionRange(match.start, match.end);

    // Scroll to the line containing the match.
    var textBefore = editor.value.substring(0, match.start);
    var lineNumber = textBefore.split('\n').length - 1;

    var computedStyle = window.getComputedStyle(editor);
    var lineHeight = parseFloat(computedStyle.lineHeight);

    if (!lineHeight || isNaN(lineHeight)) {
      lineHeight = parseFloat(computedStyle.fontSize) * 1.8;
    }

    editor.scrollTop = Math.max(
      0,
      lineNumber * lineHeight - editor.clientHeight / 3
    );

    // Keep typing in Find uninterrupted.
    if (document.activeElement === findInput) {
      findInput.focus();
    }
  } else {
    findState.marks.forEach(function(m) { m.classList.remove('find-active'); });
    var mark = findState.marks[idx];
    mark.classList.add('find-active');
    mark.scrollIntoView({ block: 'center' });
  }
  updateFindCount();
  updateEditorSearchHighlights();
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
  if (e.key === 'Escape') {
    e.preventDefault();
    closeFind();
  } else if (e.key === 'Enter') {
    e.preventDefault();

    if (e.shiftKey) {
      findPrev();
    } else {
      findNext();
    }
  }
});
document.getElementById('find-close').addEventListener('click', closeFind);
document.getElementById('find-next').addEventListener('click', findNext);
document.getElementById('find-prev').addEventListener('click', findPrev);

/* Image Lightbox */
(function() {
  var modal = document.getElementById('image-lightbox');
  var image = document.getElementById('lightbox-image');
  var title = document.getElementById('lightbox-title');
  var zoomLabel = document.getElementById('lightbox-zoom-label');
  var viewport = document.getElementById('lightbox-viewport');
  var canvas = document.getElementById('lightbox-canvas');
  var zoom = 1;
  var previousFocus = null;

  function setZoom(value) {
    zoom = Math.max(0.5, Math.min(4, value));
    zoomLabel.textContent = Math.round(zoom * 100) + '%';

    if (!image.naturalWidth || !image.naturalHeight) return;

    // Fit the original image inside the viewport at 100%.
    var availableWidth = Math.max(1, viewport.clientWidth - 40);
    var availableHeight = Math.max(1, viewport.clientHeight - 40);

    var fit = Math.min(
      1,
      availableWidth / image.naturalWidth,
      availableHeight / image.naturalHeight
    );

    var width = Math.round(image.naturalWidth * fit * zoom);
    var height = Math.round(image.naturalHeight * fit * zoom);

    // Change actual layout dimensions, not just visual scale.
    image.style.width = width + 'px';
    image.style.height = height + 'px';
    image.style.transform = 'none';

    canvas.style.width = Math.max(
      viewport.clientWidth,
      width + 40
    ) + 'px';

    canvas.style.height = Math.max(
      viewport.clientHeight,
      height + 40
    ) + 'px';

    // Keep the enlarged image centred initially.
    viewport.scrollLeft =
      Math.max(0, (canvas.offsetWidth - viewport.clientWidth) / 2);

    viewport.scrollTop =
      Math.max(0, (canvas.offsetHeight - viewport.clientHeight) / 2);
  }

  image.addEventListener('load', function() {
    if (modal.classList.contains('visible')) {
      setZoom(zoom);
    }
  });

  window.addEventListener('resize', function() {
    if (modal.classList.contains('visible')) {
      setZoom(zoom);
    }
  });

  function openLightbox(sourceImage) {
    if (!sourceImage.complete || !sourceImage.naturalWidth) return;

    var src = sourceImage.currentSrc || sourceImage.src;
    if (!src) return;

    previousFocus = document.activeElement;

    image.src = src;
    image.alt = sourceImage.alt || '';
    title.textContent = sourceImage.alt || 'Image preview';

    modal.classList.add('visible');
    modal.setAttribute('aria-hidden', 'false');

    setZoom(1);
    document.getElementById('lightbox-close').focus();
  }

  function closeLightbox() {
    // Move focus outside the dialog before hiding it.
    if (
      previousFocus &&
      previousFocus.isConnected &&
      previousFocus !== document.body &&
      !modal.contains(previousFocus)
    ) {
      previousFocus.focus();
    } else {
      document.getElementById('editor').focus();
    }

    modal.classList.remove('visible');
    modal.setAttribute('aria-hidden', 'true');

    image.removeAttribute('src');
    image.style.width = '';
    image.style.height = '';

    canvas.style.width = '';
    canvas.style.height = '';

    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;

    zoom = 1;
    zoomLabel.textContent = '100%';
    previousFocus = null;
  }

  // Delegation works even when Markdown previews are rebuilt.
  document.addEventListener('click', function(event) {
    if (!event.target || !event.target.closest) return;

    var clickedImage = event.target.closest(
      '#preview img, #guide-content img'
    );

    if (clickedImage) {
      event.preventDefault();
      openLightbox(clickedImage);
    }
  });

  document.getElementById('lightbox-close')
    .addEventListener('click', closeLightbox);

  document.getElementById('lightbox-zoom-in')
    .addEventListener('click', function() {
      setZoom(zoom + 0.25);
    });

  document.getElementById('lightbox-zoom-out')
    .addEventListener('click', function() {
      setZoom(zoom - 0.25);
    });

  document.getElementById('lightbox-reset')
    .addEventListener('click', function() {
      setZoom(1);
    });

  modal.addEventListener('click', function(event) {
    if (event.target === modal) closeLightbox();
  });

  document.addEventListener('keydown', function(event) {
    if (!modal.classList.contains('visible')) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeLightbox();
    }
  }, true);
})();

/* Save-before-pasting screenshot modal */

function openScreenshotSaveModal() {
  var modal = document.getElementById('screenshot-save-modal');

  if (!modal) return;

  modal.classList.add('visible');
  modal.setAttribute('aria-hidden', 'false');

  document.getElementById('screenshot-save-confirm').focus();
}

function closeScreenshotSaveModal() {
  var modal = document.getElementById('screenshot-save-modal');

  if (!modal) return;

  // Return focus to the editor before hiding the modal.
  document.getElementById('editor').focus();

  modal.classList.remove('visible');
  modal.setAttribute('aria-hidden', 'true');
}

document.getElementById('screenshot-save-cancel')
  .addEventListener('click', function() {
    closeScreenshotSaveModal();
  });

document.getElementById('screenshot-save-confirm')
  .addEventListener('click', function() {
    closeScreenshotSaveModal();

    var tab = TabManager.getActiveTab();

    if (!tab) {
      showError('No active document to save.');
      return;
    }

    // Open the existing native Windows Save As dialog.
    sendToRust('save_as', {
      content: document.getElementById('editor').value
    });
  });

document.getElementById('screenshot-save-modal')
  .addEventListener('click', function(event) {
    if (event.target === this) {
      closeScreenshotSaveModal();
    }
  });

document.addEventListener('keydown', function(event) {
  var modal = document.getElementById('screenshot-save-modal');

  if (
    event.key === 'Escape' &&
    modal &&
    modal.classList.contains('visible')
  ) {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeScreenshotSaveModal();
  }
}, true);

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

function waitForPdfDiagrams(preview) {
  return new Promise(function(resolve, reject) {
    var started = Date.now();
    var timeout = 10000;

    function check() {
      var diagrams = preview.querySelectorAll(
        '.mermaid-diagram'
      );

      var pending = Array.from(diagrams).some(function(diagram) {
        return (
          !diagram.querySelector('svg') &&
          !diagram.classList.contains('mermaid-error')
        );
      });

      if (!pending) {
        resolve();
        return;
      }

      if (Date.now() - started > timeout) {
        reject(new Error(
          'Mermaid diagrams did not finish rendering.'
        ));
        return;
      }

      setTimeout(check, 50);
    }

    check();
  });
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

  var html = renderMarkdownSafe(editor.value);
  preview.innerHTML = html;
  restoreCodeCopyIcons(preview);

  // Convert diagram code blocks before exporting.
  renderAllDiagrams(preview);

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


  waitForPdfDiagrams(preview).then(function() {
    // Give WebView2 time to complete its layout
    // before capturing the print document.
    setTimeout(function() {
      sendToRust('export_pdf');

      setTimeout(function() {
        pdfExportInProgress = false;
      }, 1500);

    }, 250);

  }).catch(function(error) {
    pdfExportInProgress = false;

    document.body.classList.remove(
      'pdf-export',
      'pdf-paper',
      'pdf-black'
    );

    showError('PDF export: ' + error.message);
});
}

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

// Markdown Guide

function openMarkdownGuide() {
  var modal = document.getElementById('guide-modal');
  var content = document.getElementById('guide-content');

  if (!modal || !content) return;

  content.innerHTML = renderMarkdownSafe(
    window.__MARKDOWN_GUIDE__ || ''
  );
  restoreCodeCopyIcons(content);

  content.scrollTop = 0;
  modal.classList.add('visible');

  focusGuideSearch();
}

function closeMarkdownGuide() {
  var modal = document.getElementById('guide-modal');

  if (modal) {
    modal.classList.remove('visible');
  }
}

function isMarkdownGuideOpen() {
  var modal = document.getElementById('guide-modal');

  return !!(
    modal &&
    modal.classList.contains('visible')
  );
}

function focusGuideSearch() {
  var input = document.getElementById('guide-search-input');

  if (!input) return;

  setTimeout(function() {
    input.focus();
    input.select();
  }, 0);
}

var guideSearchState = {
  matches: [],
  current: -1
};

function clearGuideSearch() {
  var content = document.getElementById('guide-content');

  var marks = content.querySelectorAll('mark.guide-match');

  marks.forEach(function(mark) {
    var parent = mark.parentNode;

    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }

    parent.removeChild(mark);
    parent.normalize();
  });

  guideSearchState.matches = [];
  guideSearchState.current = -1;

  document.getElementById('guide-search-count').textContent = '';
}

function searchMarkdownGuide(term) {
  clearGuideSearch();

  if (!term) return;

  var content = document.getElementById('guide-content');
  var walker = document.createTreeWalker(
    content,
    NodeFilter.SHOW_TEXT
  );

  var ranges = [];
  var node;
  var needle = term.toLowerCase();

  while ((node = walker.nextNode())) {
    if (
      node.parentElement &&
      node.parentElement.closest('mark.guide-match')
    ) {
      continue;
    }

    var text = node.textContent;
    var lower = text.toLowerCase();
    var index = 0;

    while ((index = lower.indexOf(needle, index)) !== -1) {
      var range = document.createRange();

      range.setStart(node, index);
      range.setEnd(node, index + term.length);

      ranges.push(range);

      index += term.length;
    }
  }

  for (var i = ranges.length - 1; i >= 0; i--) {
    var mark = document.createElement('mark');
    mark.className = 'guide-match';

    ranges[i].surroundContents(mark);
  }

  guideSearchState.matches =
    Array.from(content.querySelectorAll('mark.guide-match'));

  if (guideSearchState.matches.length > 0) {
    guideSearchState.current = 0;
    showGuideSearchMatch(0);
  }

  updateGuideSearchCount();
}

function showGuideSearchMatch(index) {
  if (!guideSearchState.matches.length) return;

  guideSearchState.matches.forEach(function(mark) {
    mark.classList.remove('active');
  });

  guideSearchState.current = index;

  var mark = guideSearchState.matches[index];
  mark.classList.add('active');

  mark.scrollIntoView({
    block: 'center'
  });

  updateGuideSearchCount();
}

function updateGuideSearchCount() {
  var count = document.getElementById('guide-search-count');

  if (!guideSearchState.matches.length) {
    count.textContent = '';
    return;
  }

  count.textContent =
    (guideSearchState.current + 1) +
    '/' +
    guideSearchState.matches.length;
}

function nextGuideSearchMatch() {
  if (!guideSearchState.matches.length) return;

  var next =
    (guideSearchState.current + 1) %
    guideSearchState.matches.length;

  showGuideSearchMatch(next);
}

function prevGuideSearchMatch() {
  if (!guideSearchState.matches.length) return;

  var prev =
    (guideSearchState.current - 1 +
      guideSearchState.matches.length) %
    guideSearchState.matches.length;

  showGuideSearchMatch(prev);
}
// Keyboard Shortcuts
document.addEventListener('keydown', function(e) {
  var key = e.key.toLowerCase();

  // Ctrl+Shift+P = Quick Open
  if (e.ctrlKey && e.shiftKey && key === 'p') {
    e.preventDefault();

    if (isQuickOpenVisible()) {
      closeQuickOpen();
    } else {
      openQuickOpen();
    }

    return;
  }

  // While Quick Open is open, prevent other shortcuts.
  if (isQuickOpenVisible()) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeQuickOpen();
    }
    return;
  }


  // Ctrl+G = open Markdown Guide
  // If already open, focus the Guide search box
  if (e.ctrlKey && !e.shiftKey && key === 'g') {
    e.preventDefault();

    if (isMarkdownGuideOpen()) {
      focusGuideSearch();
    } else {
      openMarkdownGuide();
    }

  // Ctrl+F while Guide is open = focus Guide search
  } else if (
    e.ctrlKey &&
    !e.shiftKey &&
    key === 'f' &&
    isMarkdownGuideOpen()
  ) {
    e.preventDefault();
    focusGuideSearch();

  // Ctrl+F normally = main Find
  } else if (
    e.ctrlKey &&
    !e.shiftKey &&
    key === 'f'
  ) {
    e.preventDefault();
    openFind();

  // Escape closes Guide first
  } else if (
    e.key === 'Escape' &&
    isMarkdownGuideOpen()
  ) {
    e.preventDefault();
    closeMarkdownGuide();

  // Escape closes PDF options
  } else if (
    e.key === 'Escape' &&
    isPdfOptionsOpen()
  ) {
    e.preventDefault();
    closePdfOptions();

  // Escape closes main Find
  } else if (
    e.key === 'Escape' &&
    findState.open
  ) {
    e.preventDefault();
    closeFind();

  // Ctrl+O = Open
  } else if (
    e.ctrlKey &&
    !e.shiftKey &&
    key === 'o'
  ) {
    e.preventDefault();
    sendToRust('open_file');

  // Ctrl+Shift+S = Save As
  } else if (
    e.ctrlKey &&
    e.shiftKey &&
    key === 's'
  ) {
    e.preventDefault();

    sendToRust('save_as', {
      content: document.getElementById('editor').value
    });

  // Ctrl+S = Save
  } else if (
    e.ctrlKey &&
    !e.shiftKey &&
    key === 's'
  ) {
    e.preventDefault();
    doSave();

  // Ctrl+E = Toggle Preview
  } else if (
    e.ctrlKey &&
    !e.shiftKey &&
    key === 'e'
  ) {
    e.preventDefault();
    toggleMode();

  // Ctrl+N = New
  } else if (
    e.ctrlKey &&
    !e.shiftKey &&
    key === 'n'
  ) {
    e.preventDefault();

    TabManager.createTab(
      null,
      '',
      'edit',
      'Untitled',
      false
    );

  // Ctrl+W = Close active tab
  } else if (
    e.ctrlKey &&
    !e.shiftKey &&
    key === 'w'
  ) {
    e.preventDefault();

    var active = TabManager.getActiveTab();

    if (active) {
      TabManager.closeTab(active.id);
    }

  // Ctrl+Tab = Next tab
  } else if (
    e.ctrlKey &&
    !e.shiftKey &&
    e.key === 'Tab'
  ) {
    e.preventDefault();
    TabManager.nextTab();

  // Ctrl+Shift+Tab = Previous tab
  } else if (
    e.ctrlKey &&
    e.shiftKey &&
    e.key === 'Tab'
  ) {
    e.preventDefault();
    TabManager.prevTab();

  // Ctrl++ = Zoom in
  } else if (
    e.ctrlKey &&
    (e.key === '=' || e.key === '+')
  ) {
    e.preventDefault();
    applyZoom(zoomLevel + ZOOM_STEP);

  // Ctrl+- = Zoom out
  } else if (
    e.ctrlKey &&
    e.key === '-'
  ) {
    e.preventDefault();
    applyZoom(zoomLevel - ZOOM_STEP);

  // Ctrl+0 = Reset zoom
  } else if (
    e.ctrlKey &&
    e.key === '0'
  ) {
    e.preventDefault();
    applyZoom(1);

  // Ctrl+\ = Split View
  } else if (
    e.ctrlKey &&
    e.key === '\\'
  ) {
    e.preventDefault();
    toggleSplit();

  // Ctrl+Shift+O = Outline
  } else if (
    e.ctrlKey &&
    e.shiftKey &&
    key === 'o'
  ) {
    e.preventDefault();
    toggleTOC();

  // Ctrl+P = PDF Export
  } else if (
    e.ctrlKey &&
    !e.shiftKey &&
    key === 'p'
  ) {
    e.preventDefault();
    openPdfOptions();
  }
});

// Window Controls

document
  .getElementById('btn-minimize')
  .addEventListener('click', function() {
    sendToRust('window_minimize');
  });

document
  .getElementById('btn-maximize')
  .addEventListener('click', function() {
    sendToRust('window_maximize');
  });


// Shared confirmation modal

var confirmAction = null;


function openConfirmModal(message, onConfirm, title, buttonText) {
  var modal = document.getElementById('close-confirm-modal');
  var messageEl = modal.querySelector('.modal-message');
  var titleEl = modal.querySelector('.modal-title');
  var confirmButton = document.getElementById('close-confirm');

  if (messageEl) {
    messageEl.textContent = message;
  }

  if (titleEl) {
    titleEl.textContent = title || 'Unsaved changes';
  }

  if (confirmButton) {
    confirmButton.textContent = buttonText || 'Close';
  }

  confirmAction = onConfirm || null;

  modal.classList.add('visible');
}


function closeConfirmModal() {
  var modal = document.getElementById('close-confirm-modal');

  modal.classList.remove('visible');
  confirmAction = null;
}


// Main window close button

document
  .getElementById('btn-close')
  .addEventListener('click', function() {

    if (TabManager.hasAnyDirty()) {
      openConfirmModal(
        'You have unsaved changes. Close anyway?',
        function() {
          sendToRust('window_close');
        }
      );

      return;
    }

    sendToRust('window_close');
  });


// Confirmation modal buttons

document
  .getElementById('close-cancel')
  .addEventListener('click', closeConfirmModal);

document
  .getElementById('close-confirm')
  .addEventListener('click', function() {
    var action = confirmAction;

    closeConfirmModal();

    if (action) {
      action();
    }
  });


// Clicking outside the dialog cancels it

document
  .getElementById('close-confirm-modal')
  .addEventListener('click', function(e) {
    if (e.target === this) {
      closeConfirmModal();
    }
  });

// Toolbar Buttons
document.getElementById('btn-new').addEventListener('click', function() { TabManager.createTab(null, '', 'edit', 'Untitled', false); });
document.getElementById('btn-open').addEventListener('click', function() { sendToRust('open_file'); });
document.getElementById('btn-save').addEventListener('click', doSave);
document.getElementById('btn-toggle').addEventListener('click', toggleMode);
document.getElementById('btn-split').addEventListener('click', toggleSplit);
document.getElementById('btn-toc').addEventListener('click', toggleTOC);
var guideButton = document.getElementById('btn-guide');

if (guideButton) {
  guideButton.addEventListener('click', openMarkdownGuide);
}

var guideCloseButton = document.getElementById('guide-close');

if (guideCloseButton) {
  guideCloseButton.addEventListener('click', closeMarkdownGuide);
}

var guideModal = document.getElementById('guide-modal');

if (guideModal) {
  guideModal.addEventListener('click', function(e) {
    if (e.target === guideModal) {
      closeMarkdownGuide();
    }
  });
}

var guideSearchInput =
  document.getElementById('guide-search-input');

if (guideSearchInput) {
  guideSearchInput.addEventListener('input', function() {
    searchMarkdownGuide(this.value);
  });

  guideSearchInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      nextGuideSearchMatch();
    } else if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      prevGuideSearchMatch();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.value = '';
      clearGuideSearch();
    }
  });
}

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
  TabManager.createTab(null, '', 'edit', 'Untitled', true);
  updateWordCount();
  showRecentPanel();
  bindPdfOptionsUi();
  sendToRust('ready');
});

/* Live Read status-bar control */
document.getElementById('btn-live-read')
  .addEventListener('click', toggleLiveRead);

updateLiveReadButton();

document.getElementById('save-conflict-cancel')
  .addEventListener('click', closeSaveConflict);

document.getElementById('save-conflict-save-as')
  .addEventListener('click', function() {
    var data = getSaveConflictAction();
    if (!data) {
      closeSaveConflict();
      showError('The active document changed. Save As cancelled.');
      return;
    }

    closeSaveConflict();

    sendToRust('save_conflict_as', {
      path: data.path,
      content: data.content
    });
  });

document.getElementById('save-conflict-overwrite')
  .addEventListener('click', function() {
    var data = getSaveConflictAction();
    if (!data) {
      closeSaveConflict();
      showError('The active document changed. Overwrite cancelled.');
      return;
    }

    closeSaveConflict();

    sendToRust('overwrite_file', data);
  });

document.getElementById('btn-follow')
  .addEventListener('click', toggleFollowMode);

updateFollowButton();