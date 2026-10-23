// Configure marked.js with highlight.js via custom renderer
var renderer = new marked.Renderer();
function escapeHtmlText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
renderer.code = function(token) {
  var lang = (token.lang || '').trim();
  var code = token.text;
  var highlighted;
  if (lang && hljs.getLanguage(lang)) {
    highlighted = hljs.highlight(code, { language: lang }).value;
  } else {
    highlighted = hljs.highlightAuto(code).value;
  }
  var cls = lang ? ' class="language-' + escapeHtmlText(lang) + '"' : '';
  var language = '';
  if (token.lang) {
    language = String(token.lang).trim();
  }

  var languageLabel = language ? escapeHtmlText(language.toUpperCase()) : 'CODE';

  var copyIcon =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<rect x="9" y="9" width="11" height="11" rx="2" ry="2"></rect>' +
      '<rect x="4" y="4" width="11" height="11" rx="2" ry="2"></rect>' +
    '</svg>';

  var checkIcon =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path d="M20 6L9 17l-5-5"></path>' +
    '</svg>';

  return (
    '<pre class="code-block-with-copy">' +
      '<div class="code-block-toolbar">' +
        '<div class="code-block-language">' + languageLabel + '</div>' +
        '<button type="button" class="code-copy-button" aria-label="Copy code to clipboard" title="Copy code">' +
          '<span class="code-copy-icon">' + copyIcon + '</span>' +
          '<span class="code-check-icon">' + checkIcon + '</span>' +
        '</button>' +
      '</div>' +
      '<code' + cls + '>' + highlighted + '</code>' +
    '</pre>'
  );
};

marked.setOptions({
  breaks: true,
  gfm: true,
  renderer: renderer,
});

// Post-process: resolve local images via IPC
function resolveLocalImages() {
  var tab = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
  if (!tab || !tab.path) return;
  var dir = tab.path.replace(/[/\\][^/\\]*$/, '');
  var imgs = document.getElementById('preview').querySelectorAll('img');
  for (var i = 0; i < imgs.length; i++) {
    var src = imgs[i].getAttribute('src');
    if (!src || /^https?:\/\/|^data:/i.test(src)) continue;
    if (imgs[i].getAttribute('data-local-src')) continue;
    // Decode URL-encoded characters (%20 → space, %5C → backslash, etc.)
    var decoded = decodeURIComponent(src);
    // Strip file:// prefix if present
    decoded = decoded.replace(/^file:\/\/\/?/, '');
    // Detect absolute paths (D:/... or /...) vs relative
    var absPath;
    if (/^[a-zA-Z]:[\\/]/.test(decoded) || decoded.startsWith('/')) {
      absPath = decoded;
    } else {
      absPath = dir + '/' + decoded.replace(/^\.\//, '');
    }
    // Normalize to forward slashes
    absPath = absPath.replace(/\\/g, '/');
    imgs[i].setAttribute('data-local-src', absPath);
    imgs[i].removeAttribute('src');
    sendToRust('read_image', { path: absPath });
  }
}

// Rust calls this with base64 data
window.__setImage = function(path, dataUri) {
  var imgs = document.querySelectorAll('img[data-local-src]');
  for (var i = 0; i < imgs.length; i++) {
    if (imgs[i].getAttribute('data-local-src') === path) {
      imgs[i].src = dataUri;
    }
  }
};


/* Copy code blocks to clipboard */
document.addEventListener('DOMContentLoaded', function() {
  var preview = document.getElementById('preview');

  if (!preview) return;

  preview.addEventListener('click', async function(event) {
    var button = event.target.closest('.code-copy-button');
    if (!button || !preview.contains(button)) return;

    var codeBlock = button.closest('pre');
    var code = codeBlock && codeBlock.querySelector('code');

    if (!code) return;

    var text = code.textContent;

    try {
      // Preferred modern clipboard API
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for WebView2 environments
        var temp = document.createElement('textarea');
        temp.value = text;
        temp.style.position = 'fixed';
        temp.style.opacity = '0';

        document.body.appendChild(temp);
        temp.select();

        var copied = document.execCommand('copy');
        document.body.removeChild(temp);

        if (!copied) throw new Error('Copy failed');
      }

      button.classList.add('copied');
      button.setAttribute('aria-label', 'Copied');
      button.setAttribute('title', 'Copied');

      setTimeout(function() {
        if (button.isConnected) {
          button.classList.remove('copied');
          button.setAttribute('aria-label', 'Copy code to clipboard');
          button.setAttribute('title', 'Copy code');
        }
      }, 1500);

    } catch (error) {
      button.classList.remove('copied');
      button.setAttribute('aria-label', 'Copy failed');
      button.setAttribute('title', 'Copy failed');

      setTimeout(function() {
        if (button.isConnected) {
          button.setAttribute('aria-label', 'Copy code to clipboard');
          button.setAttribute('title', 'Copy code');
        }
      }, 2000);
    }
  });
});

