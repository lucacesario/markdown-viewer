
(function() {
  var editor = document.getElementById('editor');
  var changeTimer = null;

  // Handle editor changes
  editor.addEventListener('input', function() {
    updateLineNumbers();
    updateEditorStatus();

    var activeTab = TabManager.getActiveTab();

    if (activeTab) {
      activeTab.parsedHtml = null;
    }

    // Mark the tab dirty immediately on every edit.
    if (activeTab) {
      TabManager.markDirty();
    }

    clearTimeout(changeTimer);

    changeTimer = setTimeout(function() {
      updateWordCount();

      if (typeof updateLiveReadWarning === 'function') {
        updateLiveReadWarning();
      }

      if (typeof showRecentPanel === 'function') {
        showRecentPanel();
      }

      if (typeof tocOpen !== 'undefined' && tocOpen) {
        updateTOC();
      }
    }, 300);

    if (typeof splitMode !== 'undefined' && splitMode) {
      updateSplitPreview();
    }
  });

  // Tab key inserts four spaces.
  // Ctrl+Tab remains available for switching tabs.
  editor.addEventListener('keydown', function(e) {
    if (e.key === 'Tab' && !e.ctrlKey) {
      e.preventDefault();

      var start = editor.selectionStart;
      var end = editor.selectionEnd;

      editor.value =
        editor.value.substring(0, start) +
        '    ' +
        editor.value.substring(end);

      editor.selectionStart =
        editor.selectionEnd =
        start + 4;

      updateEditorStatus();
      editor.dispatchEvent(new Event('input'));

      TabManager.markDirty();

      if (typeof updateLiveReadWarning === 'function') {
        updateLiveReadWarning();
      }

      if (typeof splitMode !== 'undefined' && splitMode) {
        updateSplitPreview();
      }
    }
  });

  /*
   * Screenshot pasting
   *
   * Ctrl+V with an image:
   * 1. Read clipboard PNG.
   * 2. Send it to Rust.
   * 3. Wait for the screenshot_saved response.
   *
   * Normal text pasting remains unchanged.
   */
  editor.addEventListener('paste', function(event) {
    var items =
      event.clipboardData &&
      event.clipboardData.items;

    if (!items) return;

    var imageFile = null;

    for (var i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        imageFile = items[i].getAsFile();
        break;
      }
    }

    // No image: allow the browser's normal text paste.
    if (!imageFile) return;

    event.preventDefault();

    if (imageFile.type !== 'image/png') {
      showError('Only PNG screenshots are supported.');
      return;
    }

    var tab = TabManager.getActiveTab();

    // Unsaved documents need a location for their assets.
    if (!tab || !tab.path) {
      openScreenshotSaveModal();
      return;
    }

    // Prevent multiple simultaneous image-save requests.
    if (window.pendingScreenshotPaste) {
      showError('Another screenshot is still being saved.');
      return;
    }

    if (imageFile.size > 15 * 1024 * 1024) {
      showError('Screenshot exceeds the 15 MB limit.');
      return;
    }

    // Remember where the image should be inserted.
    var pending = {
      tabId: tab.id,
      documentPath: tab.path,
      start: editor.selectionStart,
      end: editor.selectionEnd
    };

    window.pendingScreenshotPaste = pending;

    var reader = new FileReader();

    reader.onload = function() {
      if (window.pendingScreenshotPaste !== pending) return;

      var dataUrl = reader.result;

      if (
        typeof dataUrl !== 'string' ||
        !dataUrl.startsWith('data:image/png;base64,')
      ) {
        window.pendingScreenshotPaste = null;
        showError('Could not encode the screenshot as PNG.');
        return;
      }

      var base64Data = dataUrl.substring(
        'data:image/png;base64,'.length
      );

      try {
        sendToRust('save_screenshot', {
          path: pending.documentPath,
          content: base64Data
        });
      } catch (error) {
        window.pendingScreenshotPaste = null;
        showError('Could not send the screenshot to Rust.');
      }
    };

    reader.onerror = function() {
      if (window.pendingScreenshotPaste === pending) {
        window.pendingScreenshotPaste = null;
        showError('Could not read the pasted screenshot.');
      }
    };

    reader.readAsDataURL(imageFile);
  });
})();
