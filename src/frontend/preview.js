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
  
  var plainTextLanguages = ['text', 'txt', 'plaintext', 'plain'];

  if (!lang || plainTextLanguages.includes(lang.toLowerCase())) {
    // Plain text must not be syntax-highlighted.
    highlighted = escapeHtmlText(code);
  } else if (hljs.getLanguage(lang)) {
    highlighted = hljs.highlight(code, { language: lang }).value;
  } else {
    // Unknown languages are displayed as plain text.
    highlighted = escapeHtmlText(code);
  }
  var cls = lang ? ' class="language-' + escapeHtmlText(lang) + '"' : '';
  var language = '';
  if (token.lang) {
    language = String(token.lang).trim();
  }

  
var languageNames = {
  js: 'JavaScript',
  javascript: 'JavaScript',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  py: 'Python',
  python: 'Python',
  rs: 'Rust',
  rust: 'Rust',
  json: 'JSON',
  html: 'HTML',
  css: 'CSS',
  bash: 'Bash',
  sh: 'Shell',
  ps1: 'PowerShell',
  powershell: 'PowerShell',
  sql: 'SQL',
  yaml: 'YAML',
  yml: 'YAML',
  xml: 'XML',
  md: 'Markdown',
  markdown: 'Markdown',
  cpp: 'C++',
  csharp: 'C#',
  cs: 'C#',
  plaintext: 'Plain Text',
  text: 'Plain Text',
  txt: 'Plain Text'
};

var languageKey = language.split(/\s+/)[0].toLowerCase();

var languageLabel = languageKey
  ? (languageNames[languageKey] ||
     languageKey.charAt(0).toUpperCase() + languageKey.slice(1))
  : '';

languageLabel = escapeHtmlText(languageLabel);

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


/*
 * Convert Markdown into sanitized HTML.
 * Do not allow unsafe HTML to reach the WebView.
 */
function renderMarkdownSafe(markdown) {
  if (typeof DOMPurify === 'undefined') {
    throw new Error('DOMPurify failed to load');
  }

  var html = marked.parse(markdown || '');

  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ALLOW_DATA_ATTR: false
  });
}


function restoreCodeCopyIcons(root) {
  if (!root) return;

  var buttons = root.querySelectorAll('.code-copy-button');

  function createIcon(paths) {
    var svg = document.createElementNS(
      'http://www.w3.org/2000/svg', 'svg'
    );

    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    paths.forEach(function(item) {
      var shape = document.createElementNS(
        'http://www.w3.org/2000/svg', item.tag
      );

      Object.keys(item.attrs).forEach(function(key) {
        shape.setAttribute(key, item.attrs[key]);
      });

      svg.appendChild(shape);
    });

    return svg;
  }

  buttons.forEach(function(button) {
    var copy = button.querySelector('.code-copy-icon');
    var check = button.querySelector('.code-check-icon');

    if (copy) {
      copy.replaceChildren(createIcon([
        {
          tag: 'rect',
          attrs: { x: '9', y: '9', width: '11', height: '11', rx: '2' }
        },
        {
          tag: 'rect',
          attrs: { x: '4', y: '4', width: '11', height: '11', rx: '2' }
        }
      ]));
    }

    if (check) {
      check.replaceChildren(createIcon([
        {
          tag: 'path',
          attrs: { d: 'M20 6L9 17l-5-5' }
        }
      ]));
    }
  });
}

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
  document.addEventListener('click', async function(event) {
    var button = event.target.closest('.code-copy-button');
    if (!button || !button.closest('#preview, #guide-content')) return;

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


/* ============================================
   Offline Mermaid diagram rendering
   ============================================ */

var mermaidDiagramCounter = 0;
var mermaidRendererInitialized = false;

function renderMermaidDiagrams(container) {
  if (!container) return;

  var wrapper = window.__esbuild_esm_mermaid_nm;
  var mermaid = wrapper &&
    wrapper.mermaid &&
    wrapper.mermaid.default;

  if (!mermaid || typeof mermaid.render !== 'function') {
    console.warn('Offline Mermaid renderer unavailable');
    return;
  }

  if (!mermaidRendererInitialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      htmlLabels: false,
      theme: 'default'
    });

    mermaidRendererInitialized = true;
  }

  var blocks = container.querySelectorAll('pre');

  blocks.forEach(function(pre) {
    var code = pre.querySelector('code');

    if (!code) return;

    var language = Array.from(code.classList).some(
      function(cls) {
        return cls.toLowerCase() === 'language-mermaid';
      }
    );

    if (!language) return;

    // Preserve the original source for rendering.
    var source = code.textContent.trim();

    if (!source) return;

    var diagram = document.createElement('div');
    diagram.className = 'mermaid-diagram';
    diagram.textContent = 'Rendering diagram...';

    // Replace only Mermaid blocks, not ordinary code.
    pre.replaceWith(diagram);

    var id = 'markdown-mermaid-' +
      (++mermaidDiagramCounter);

    mermaid.parse(source, { suppressErrors: true })
      .then(function(parsed) {
        // The user may have switched tabs or edited the document.
        if (!diagram.isConnected) return null;

        // Invalid syntax should never reach Mermaid's SVG renderer.
        if (!parsed) {
          throw new Error('Invalid Mermaid syntax. Check the diagram code.');
        }

        return mermaid.render(id, source);
      })
      .then(function(result) {
        if (!result || !diagram.isConnected) return;

        var safeSvg = DOMPurify.sanitize(result.svg, {
          USE_PROFILES: {
            svg: true,
            svgFilters: true
          }
        });

        if (!safeSvg.trim()) {
          throw new Error('Diagram SVG was empty after sanitizing.');
        }

        diagram.innerHTML = safeSvg;

        // Do not bind Mermaid-generated links or click handlers.
      })
      .catch(function(error) {
        if (!diagram.isConnected) return;

        diagram.classList.add('mermaid-error');
        diagram.textContent =
          'Unable to render Mermaid diagram: ' +
          (error.message || String(error));

        console.warn('Mermaid error:', error);
      });
  });
}


/*
 * Limit geographic data complexity before converting
 * TopoJSON or generating SVG paths.
 */
function validateGeoComplexity(data, isTopoJSON) {
  var MAX_POSITIONS = 30000;
  var MAX_DEPTH = 32;
  var positions = 0;

  var stack = [{
    value: isTopoJSON ? data.arcs : data,
    depth: 0
  }];

  if (isTopoJSON && !Array.isArray(data.arcs)) {
    throw new Error('TopoJSON must contain an arcs array.');
  }

  while (stack.length > 0) {
    var item = stack.pop();
    var value = item.value;

    if (item.depth > MAX_DEPTH) {
      throw new Error('Geographic data is nested too deeply.');
    }

    if (!value || typeof value !== 'object') {
      continue;
    }

    if (Array.isArray(value)) {
      // A geographic position contains at least two numbers.
      if (
        value.length >= 2 &&
        typeof value[0] === 'number' &&
        typeof value[1] === 'number'
      ) {
        if (!Number.isFinite(value[0]) ||
            !Number.isFinite(value[1])) {
          throw new Error('Invalid geographic coordinates.');
        }

        positions++;

        if (positions > MAX_POSITIONS) {
          throw new Error(
            'Geographic data exceeds the ' +
            MAX_POSITIONS + '-position limit.'
          );
        }

        continue;
      }

      for (var i = 0; i < value.length; i++) {
        stack.push({
          value: value[i],
          depth: item.depth + 1
        });
      }
    } else if (!isTopoJSON) {
      // Traverse only GeoJSON geometry-related fields.
      ['features', 'geometry', 'geometries', 'coordinates']
        .forEach(function(key) {
          if (value[key] != null) {
            stack.push({
              value: value[key],
              depth: item.depth + 1
            });
          }
        });
    }
  }
}

/* ============================================
   Offline GeoJSON and TopoJSON rendering
   ============================================ */

function renderGeoDiagrams(container) {
  if (!container || !window.MarkdownGeo) return;

  var geo = window.MarkdownGeo;
  var svgNS = 'http://www.w3.org/2000/svg';

  container.querySelectorAll('pre').forEach(function(pre) {
    var code = pre.querySelector('code');
    if (!code) return;

    var isGeoJSON = code.classList.contains('language-geojson');
    var isTopoJSON = code.classList.contains('language-topojson');

    if (!isGeoJSON && !isTopoJSON) return;

    var source = code.textContent.trim();
    var panel = document.createElement('div');
    panel.className = 'geo-diagram';
    pre.replaceWith(panel);

    function showError(message) {
      panel.classList.add('geo-error');
      panel.textContent = 'Unable to render geographic data: ' + message;
    }

    try {
      // Avoid processing very large, untrusted documents.
      if (source.length > 2_000_000) {
        throw new Error('Data exceeds the 2 MB text limit.');
      }

      var data = JSON.parse(source);
      var features;

      // Reject excessive geometry before projection or conversion.
      validateGeoComplexity(data, isTopoJSON);

      if (isTopoJSON) {
        if (
          !data ||
          data.type !== 'Topology' ||
          !data.objects ||
          typeof data.objects !== 'object'
        ) {
          throw new Error('Expected a TopoJSON Topology object.');
        }

        features = [];

        Object.keys(data.objects).forEach(function(key) {
          var converted = geo.topojsonFeature(
            data,
            data.objects[key]
          );

          if (converted.type === 'FeatureCollection') {
            features.push.apply(features, converted.features);
          } else {
            features.push(converted);
          }
        });
      } else {
        if (!data || typeof data.type !== 'string') {
          throw new Error('Expected a GeoJSON object with a type.');
        }

        if (data.type === 'FeatureCollection') {
          features = data.features;
        } else if (data.type === 'Feature') {
          features = [data];
        } else {
          features = [{
            type: 'Feature',
            geometry: data,
            properties: {}
          }];
        }
      }

      if (!Array.isArray(features) || !features.length) {
        throw new Error('No geographic features found.');
      }

      if (features.length > 5000) {
        throw new Error('Too many features (maximum 5000).');
      }

      var collection = {
        type: 'FeatureCollection',
        features: features
      };

      var width = 640;
      var height = 400;

      var projection = geo.geoMercator();

      projection.fitExtent(
        [[24, 24], [width - 24, height - 24]],
        collection
      );

      var path = geo.geoPath(projection).pointRadius(5);

      var svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
      svg.setAttribute('width', String(width));
      svg.setAttribute('height', String(height));
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label',
        isTopoJSON ? 'TopoJSON map' : 'GeoJSON map');

      features.forEach(function(feature) {
        if (!feature || !feature.geometry) return;

        var geometryType = feature.geometry.type;
        var pathData = path(feature);

        if (!pathData) return;

        var shape = document.createElementNS(svgNS, 'path');
        shape.setAttribute('d', pathData);

        if (
          geometryType === 'Point' ||
          geometryType === 'MultiPoint'
        ) {
          shape.setAttribute('class', 'geo-point');
        } else if (
          geometryType === 'LineString' ||
          geometryType === 'MultiLineString'
        ) {
          shape.setAttribute('class', 'geo-line');
        } else {
          shape.setAttribute('class', 'geo-area');
        }

        svg.appendChild(shape);
      });

      if (!svg.childNodes.length) {
        throw new Error('No drawable geometry found.');
      }

      panel.appendChild(svg);

    } catch (error) {
      showError(error.message || String(error));
      console.warn('Geo diagram error:', error);
    }
  });
}

/* Render all supported offline diagram formats. */
function renderAllDiagrams(container) {
  if (!container) return;

  renderMermaidDiagrams(container);
  renderGeoDiagrams(container);
  renderStlDiagrams(container);
}
