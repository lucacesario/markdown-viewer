
/* ============================================
   Offline ASCII STL Viewer
   No external libraries or network requests.
   ============================================ */

function renderStlDiagrams(container) {
  if (!container) return;

  var blocks = container.querySelectorAll(
    'pre code.language-stl, pre code.language-ascii-stl'
  );

  blocks.forEach(function(code) {
    var pre = code.closest('pre');
    if (!pre) return;

    var panel = document.createElement('div');
    panel.className = 'stl-diagram';
    pre.replaceWith(panel);

    try {
      var triangles = parseAsciiStl(code.textContent);

      var canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 400;
      canvas.tabIndex = 0;
      canvas.setAttribute('aria-label',
        'Interactive 3D STL model. Drag to rotate, wheel to zoom.');

      var help = document.createElement('div');
      help.className = 'stl-controls';
      help.textContent =
        'Drag: rotate  |  Wheel: model zoom  |  Double-click: reset';

      panel.appendChild(canvas);
      panel.appendChild(help);

      attachStlControls(canvas, triangles);

    } catch (error) {
      panel.classList.add('stl-error');
      panel.textContent =
        'Unable to render STL: ' + (error.message || String(error));
      console.warn('STL rendering error:', error);
    }
  });
}

function parseAsciiStl(source) {
  if (source.length > 1500000) {
    throw new Error('STL exceeds the 1.5 MB text limit.');
  }

  var lines = source.split(/\r?\n/).map(function(line) {
    return line.trim();
  }).filter(Boolean);

  var triangles = [];
  var i = 0;

  function expect(value) {
    if (i >= lines.length || lines[i].toLowerCase() !== value) {
      throw new Error('Expected "' + value +
        '" near line ' + (i + 1) + '.');
    }
    i++;
  }

  function vertex() {
    var parts = (lines[i] || '').split(/\s+/);
    if (parts.length !== 4 || parts[0].toLowerCase() !== 'vertex') {
      throw new Error('Expected vertex near line ' + (i + 1) + '.');
    }

    var point = parts.slice(1).map(Number);

    if (!point.every(Number.isFinite)) {
      throw new Error('Invalid vertex coordinates at line ' + (i + 1) + '.');
    }

    i++;
    return point;
  }

  while (i < lines.length) {
    var line = lines[i];

    if (/^(solid|endsolid)(\s|$)/i.test(line)) {
      i++;
      continue;
    }

    if (!/^facet\s+normal\s+/i.test(line)) {
      throw new Error('Unexpected STL content at line ' + (i + 1) + '.');
    }

    var normalParts = line.split(/\s+/);
    if (normalParts.length !== 5 ||
        !normalParts.slice(2).map(Number).every(Number.isFinite)) {
      throw new Error('Invalid facet normal at line ' + (i + 1) + '.');
    }

    i++;
    expect('outer loop');

    var a = vertex();
    var b = vertex();
    var c = vertex();

    expect('endloop');
    expect('endfacet');

    triangles.push([a, b, c]);

    if (triangles.length > 5000) {
      throw new Error('STL exceeds the 5000-triangle limit.');
    }
  }

  if (!triangles.length) {
    throw new Error('No STL triangles found.');
  }

  return triangles;
}

function attachStlControls(canvas, triangles) {
  var ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable.');

  var vertices = triangles.flat();

  var minimum = [Infinity, Infinity, Infinity];
  var maximum = [-Infinity, -Infinity, -Infinity];

  vertices.forEach(function(point) {
    for (var axis = 0; axis < 3; axis++) {
      minimum[axis] = Math.min(minimum[axis], point[axis]);
      maximum[axis] = Math.max(maximum[axis], point[axis]);
    }
  });

  var centre = minimum.map(function(value, axis) {
    return value / 2 + maximum[axis] / 2;
  });

  var size = Math.max(
    maximum[0] - minimum[0],
    maximum[1] - minimum[1],
    maximum[2] - minimum[2]
  );

  if (!Number.isFinite(size) || size <= 0) {
    throw new Error('STL has no measurable dimensions.');
  }

  // Centre and normalise the geometry once.
  var mesh = triangles.map(function(triangle) {
    return triangle.map(function(point) {
      return [
        (point[0] - centre[0]) / size,
        (point[1] - centre[1]) / size,
        (point[2] - centre[2]) / size
      ];
    });
  });

  var rotationX = -0.35;
  var rotationY = 0.6;
  var modelZoom = 1;

  var dragging = false;
  var previousX = 0;
  var previousY = 0;

  function rotate(point) {
    var cy = Math.cos(rotationY);
    var sy = Math.sin(rotationY);
    var cx = Math.cos(rotationX);
    var sx = Math.sin(rotationX);

    var x = point[0] * cy + point[2] * sy;
    var z = -point[0] * sy + point[2] * cy;
    var y = point[1] * cx - z * sx;
    z = point[1] * sx + z * cx;

    return [x, y, z];
  }

  function draw() {
    var width = canvas.width;
    var height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    var scale = Math.min(width, height) * 0.7 * modelZoom;

    var faces = mesh.map(function(triangle) {
      var points = triangle.map(rotate);

      var u = [
        points[1][0] - points[0][0],
        points[1][1] - points[0][1],
        points[1][2] - points[0][2]
      ];

      var v = [
        points[2][0] - points[0][0],
        points[2][1] - points[0][1],
        points[2][2] - points[0][2]
      ];

      var normal = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0]
      ];

      var normalLength = Math.hypot(
        normal[0], normal[1], normal[2]
      ) || 1;

      // Two-sided lighting for imperfect STL meshes.
      var lighting = Math.abs(
        (normal[0] * 0.4 +
         normal[1] * 0.5 +
         normal[2] * 0.77) / normalLength
      );

      return {
        points: points,
        depth: (points[0][2] + points[1][2] + points[2][2]) / 3,
        lighting: lighting
      };
    });

    // Painter's algorithm: draw distant faces first.
    faces.sort(function(a, b) {
      return a.depth - b.depth;
    });

    faces.forEach(function(face) {
      var shade = Math.round(100 + face.lighting * 115);

      ctx.beginPath();

      face.points.forEach(function(point, index) {
        var x = width / 2 + point[0] * scale;
        var y = height / 2 - point[1] * scale;

        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });

      ctx.closePath();
      ctx.fillStyle = 'rgb(' +
        Math.round(shade * 0.35) + ',' +
        Math.round(shade * 0.75) + ',' +
        shade + ')';

      ctx.fill();

      ctx.strokeStyle = 'rgba(35, 52, 78, 0.65)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    });
  }

  canvas.addEventListener('pointerdown', function(event) {
    if (event.button !== 0) return;

    dragging = true;
    previousX = event.clientX;
    previousY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointermove', function(event) {
    if (!dragging) return;

    rotationY += (event.clientX - previousX) * 0.01;
    rotationX += (event.clientY - previousY) * 0.01;

    previousX = event.clientX;
    previousY = event.clientY;

    draw();
  });

  function stopDragging() {
    dragging = false;
  }

  canvas.addEventListener('pointerup', stopDragging);
  canvas.addEventListener('pointercancel', stopDragging);
  canvas.addEventListener('lostpointercapture', stopDragging);

  canvas.addEventListener('wheel', function(event) {
    // Leave Ctrl+wheel to the Markdown Viewer.
    if (event.ctrlKey) return;

    event.preventDefault();

    var factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    modelZoom = Math.max(0.3, Math.min(5, modelZoom * factor));

    draw();
  }, { passive: false });

  canvas.addEventListener('dblclick', function() {
    rotationX = -0.35;
    rotationY = 0.6;
    modelZoom = 1;
    draw();
  });

  draw();
}
