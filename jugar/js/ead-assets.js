/*
 * eAdventure 2 runtime for the web — assets: images, bitmap fonts, runtime
 * drawables (frames, states, filters, shapes, captions), sounds and videos.
 */
(function () {
  'use strict';
  const EAD = window.EAD;
  const { num, enumName, jstr } = EAD;

  // ------------------------------------------------------------- renderer
  // Keeps a logical (800x600) transform stack; ctx gets base * logical.
  class Renderer {
    constructor(ctx) {
      this.ctx = ctx;
      this.base = new DOMMatrix();
      this.m = new DOMMatrix();
      this.stack = [];
      this.alpha = 1;
    }
    begin(base) { this.base = base; this.m = new DOMMatrix(); this.stack.length = 0; this.alpha = 1; }
    save() { this.stack.push(this.m); }
    restore() { this.m = this.stack.pop(); }
    mul(mat) { this.m = this.m.multiply(mat); }
    translate(x, y) { this.m = this.m.translate(x, y); }
    preTranslate(x, y) { this.m = new DOMMatrix().translate(x, y).multiply(this.m); }
    apply() { this.ctx.setTransform(this.base.multiply(this.m)); this.ctx.globalAlpha = Math.max(0, Math.min(1, this.alpha)); }
  }

  // --------------------------------------------------------- bitmap fonts
  class BitmapFont {
    constructor(data, img) {
      this.d = data;
      this.img = img;
      this.chars = {};
      for (const k in data.chars) this.chars[k] = data.chars[k];
      const sp = this.chars[32];
      this.spaceWidth = sp ? sp[6] + sp[2] : 1;
      this.tints = new Map();
    }
    glyph(code) { return this.chars[code]; }
    kerning(a, b) { const k = this.d.kern[a]; return k && k[b] ? k[b] : 0; }
    boundsWidth(s) {
      let width = 0, i = 0, last = null, lastCode = 0;
      for (; i < s.length; i++) {
        const c = s.charCodeAt(i);
        const g = this.glyph(c);
        if (g) { width = g[6]; last = g; lastCode = c; i++; break; }
      }
      for (; i < s.length; i++) {
        const c = s.charCodeAt(i);
        const g = this.glyph(c);
        if (!g) continue;
        width += this.kerning(lastCode, c);
        last = g; lastCode = c;
        width += g[6];
      }
      return width;
    }
    stringWidth(s) { return Math.round(this.boundsWidth(s)); }
    lineHeight() { return Math.round(this.d.lineHeight); }
    tinted(color) {
      let c = this.tints.get(color);
      if (c) return c;
      c = document.createElement('canvas');
      c.width = this.img.width; c.height = this.img.height;
      const g = c.getContext('2d');
      g.drawImage(this.img, 0, 0);
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = color;
      g.fillRect(0, 0, c.width, c.height);
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(this.img, 0, 0);
      this.tints.set(color, c);
      return c;
    }
    draw(r, text, x, y, color, alpha) {
      const ctx = r.ctx;
      const src = this.tinted(color);
      const a0 = r.alpha;
      r.alpha = a0 * alpha;
      r.apply();
      let lastCode = -1;
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        const g = this.glyph(code);
        if (!g) continue;
        if (lastCode >= 0) x += this.kerning(lastCode, code);
        if (g[2] > 0 && g[3] > 0) ctx.drawImage(src, g[0], g[1], g[2], g[3], x + g[4], y + g[5], g[2], g[3]);
        x += g[6];
        lastCode = code;
      }
      r.alpha = a0;
    }
  }

  function colorCss(c) {
    if (!c) return 'rgba(0,0,0,0)';
    return 'rgb(' + c.red + ',' + c.green + ',' + c.blue + ')';
  }
  function colorAlpha(c) { return c ? (c.alpha === undefined ? 255 : c.alpha) / 255 : 0; }
  function paintFill(p) { if (!p) return null; return p.$c === 'Paint' ? p.fill : p; }
  function paintBorder(p) { if (!p) return null; return p.$c === 'Paint' ? p.border : null; }
  function paintWidth(p) { if (!p) return 0; return p.$c === 'Paint' ? (p.width || 0) : 0; }

  function drawText(r, text, x, y, font, paint) {
    // GdxCanvas.drawText
    x += Math.trunc(font.spaceWidth / 2);
    const border = paintBorder(paint);
    const fill = paintFill(paint);
    if (border && border.$c === 'ColorFill') {
      const col = colorCss(border), a = colorAlpha(border);
      font.draw(r, text, x, y, col, a);
      font.draw(r, text, x + 1, y + 1, col, a);
      font.draw(r, text, x - 1, y + 1, col, a);
      font.draw(r, text, x + 1, y - 1, col, a);
      font.draw(r, text, x - 1, y - 1, col, a);
    }
    if (fill && fill.$c === 'ColorFill') {
      font.draw(r, text, x, y, colorCss(fill), colorAlpha(fill));
    }
  }

  // ------------------------------------------------------- runtime assets
  class RImage {
    constructor(ah, d) {
      this.ah = ah; this.d = d;
      const e = ah.manifest[d.uri];
      this.img = ah.images.get(d.uri) || null;
      this.w = e ? e.w : 64; this.h = e ? e.h : 64;
      this.alpha = null;
    }
    getWidth() { return this.w; }
    getHeight() { return this.h; }
    getDrawable() { return this; }
    render(r) {
      if (!this.img) this.img = this.ah.images.get(this.d.uri) || null;
      if (!this.img) return;
      r.apply();
      r.ctx.drawImage(this.img, 0, 0, this.w, this.h);
    }
    alphaAt(x, y) {
      if (!this.img) this.img = this.ah.images.get(this.d.uri) || null;
      if (!this.img) return 255;
      if (!this.alpha) {
        const c = document.createElement('canvas');
        c.width = this.w; c.height = this.h;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(this.img, 0, 0, this.w, this.h);
        try { this.alpha = g.getImageData(0, 0, this.w, this.h).data; } catch (e) { this.alpha = 'none'; }
      }
      if (this.alpha === 'none') return 255;
      return this.alpha[(y * this.w + x) * 4 + 3];
    }
    contains(x, y) {
      x = Math.trunc(x); y = Math.trunc(y);
      if (x > 0 && y > 0 && x < this.w && y < this.h) return this.alphaAt(x, y) > 128;
      return false;
    }
  }

  class RFrames {
    constructor(ah, d) {
      this.ah = ah; this.d = d;
      this.frames = []; this.times = []; this.total = 0;
      for (const f of d.frames || []) {
        this.frames.push(ah.get(f.drawable));
        this.total += f.time;
        this.times.push(this.total);
      }
    }
    getWidth() { return 0; }
    getHeight() { return 0; }
    render() {}
    contains(x, y) { const d = this.getDrawable(this.lt || 0, this.ls, this.ll || 0); return d ? d.contains(x, y) : false; }
    getDrawable(time, states, level) {
      this.lt = time; this.ls = states; this.ll = level;
      if (!this.frames.length || this.total <= 0) return this.frames[0] ? this.frames[0].getDrawable(time, states, level) : null;
      const t = ((time % this.total) + this.total) % this.total;
      let i = 0;
      while (i < this.times.length - 1 && t > this.times[i]) i++;
      const f = this.frames[i];
      return f ? f.getDrawable(time, states, level) : null;
    }
  }

  class RStates {
    constructor(ah, d) {
      this.ah = ah; this.d = d;
      this.map = new Map();
      if (d.drawables) for (const [k, v] of d.drawables.entries) if (v) this.map.set(enumName(k), ah.get(v));
    }
    getWidth() { return 0; }
    getHeight() { return 0; }
    render() {}
    contains(x, y) { const d = this.getDrawable(this.lt || 0, this.ls, this.ll || 0); return d ? d.contains(x, y) : false; }
    getDrawable(time, states, level) {
      this.lt = time; this.ls = states; this.ll = level;
      if (!states) {
        const first = this.map.values().next().value;
        return first ? first.getDrawable(time, states, level) : null;
      }
      const s = states[level];
      const d = this.map.get(s);
      if (!d) return null;
      return d.getDrawable(time, states, level + 1);
    }
  }

  class RFiltered {
    constructor(ah, d) {
      this.ah = ah; this.d = d;
      this.inner = ah.get(d.drawable);
      this.time = 0; this.states = null; this.level = 0;
    }
    cur() { return this.inner ? this.inner.getDrawable(this.time, this.states, this.level) : null; }
    getWidth() { const c = this.cur(); return c ? c.getWidth() : 0; }
    getHeight() { const c = this.cur(); return c ? c.getHeight() : 0; }
    getDrawable(time, states, level) { this.time = time; this.states = states; this.level = level; return this; }
    contains(x, y) { return this.inner ? this.inner.contains(x, y) : false; }
    render(r) {
      const c = this.cur();
      if (!c) return;
      const f = this.d.filter;
      if (f && f.$c === 'MatrixFilter') {
        const mm = (f.matrix && f.matrix.matrix) || [];
        const v = mm.map(num);
        r.save();
        r.preTranslate(num(f.originX) * c.getWidth(), num(f.originY) * c.getHeight());
        r.mul(new DOMMatrix([v[0], v[1], v[3], v[4], v[6], v[7]]));
        c.render(r);
        r.restore();
      } else c.render(r);
    }
  }

  class RNinePatch {
    constructor(ah, d) {
      this.ah = ah; this.d = d;
      this.image = ah.get(d.image);
      this.width = this.image.getWidth();
      this.height = this.image.getHeight();
    }
    getWidth() { return this.width; }
    getHeight() { return this.height; }
    getDrawable() { return this; }
    contains(x, y) { return x >= 0 && x < this.width && y >= 0 && y < this.height; }
    render(r) {
      const img = this.image.img;
      if (!img) return;
      // NinePatch regions are not flipped: in the engine's y-down camera the
      // patch appears vertically mirrored, so we reproduce that.
      r.save();
      r.mul(new DOMMatrix([1, 0, 0, -1, 0, this.height]));
      r.apply();
      r.restore();
      const ctx = r.ctx;
      const iw = this.image.w, ih = this.image.h;
      const L = this.d.left, R = this.d.right, Tp = this.d.top, B = this.d.bottom;
      const W = this.width, H = this.height;
      const cw = Math.max(0, W - L - R), ch = Math.max(0, H - Tp - B);
      const sw = iw - L - R, sh = ih - Tp - B;
      const P = (sx, sy, sW, sH, dx, dy, dW, dH) => { if (sW > 0 && sH > 0 && dW > 0 && dH > 0) ctx.drawImage(img, sx, sy, sW, sH, dx, dy, dW, dH); };
      P(0, 0, L, Tp, 0, 0, L, Tp);
      P(L, 0, sw, Tp, L, 0, cw, Tp);
      P(iw - R, 0, R, Tp, L + cw, 0, R, Tp);
      P(0, Tp, L, sh, 0, Tp, L, ch);
      P(L, Tp, sw, sh, L, Tp, cw, ch);
      P(iw - R, Tp, R, sh, L + cw, Tp, R, ch);
      P(0, ih - B, L, B, 0, Tp + ch, L, B);
      P(L, ih - B, sw, B, L, Tp + ch, cw, B);
      P(iw - R, ih - B, R, B, L + cw, Tp + ch, R, B);
    }
  }

  function fillStyleFor(ctx, fill) {
    if (!fill) return null;
    if (fill.$c === 'ColorFill') {
      return 'rgba(' + fill.red + ',' + fill.green + ',' + fill.blue + ',' + colorAlpha(fill) + ')';
    }
    if (fill.$c === 'LinearGradientFill') {
      const g = ctx.createLinearGradient(num(fill.x0), num(fill.y0), num(fill.x1), num(fill.y1));
      const c1 = fill.color1, c2 = fill.color2;
      g.addColorStop(0, 'rgba(' + c1.red + ',' + c1.green + ',' + c1.blue + ',' + colorAlpha(c1) + ')');
      g.addColorStop(1, 'rgba(' + c2.red + ',' + c2.green + ',' + c2.blue + ',' + colorAlpha(c2) + ')');
      return g;
    }
    return null;
  }

  class RRectangle {
    constructor(ah, d) {
      this.d = d;
      const p = d.paint;
      const bw = paintWidth(p);
      this.pw = d.width + bw * 2;
      this.ph = d.height + bw * 2;
      const c = document.createElement('canvas');
      c.width = Math.max(1, this.pw); c.height = Math.max(1, this.ph);
      const g = c.getContext('2d');
      const border = paintBorder(p);
      if (border) {
        const col = border.$c === 'LinearGradientFill' ? border.color1 : border;
        g.strokeStyle = fillStyleFor(g, col);
        g.lineWidth = 1;
        g.strokeRect(0.5, 0.5, this.pw - 1, this.ph - 1);
      }
      const fill = paintFill(p);
      if (fill) {
        g.fillStyle = fillStyleFor(g, fill);
        g.fillRect(bw, bw, d.width, d.height);
      }
      this.canvas = c;
    }
    getWidth() { return this.pw; }
    getHeight() { return this.ph; }
    getDrawable() { return this; }
    contains(x, y) { return x > 0 && y > 0 && x < this.pw && y < this.ph; }
    render(r) { r.apply(); r.ctx.drawImage(this.canvas, 0, 0); }
  }

  // Bezier / balloon shape: port of GdxBezierShape (polygon fill on a pixmap,
  // border drawn as diagonal-offset Bresenham lines).
  class RBezier {
    constructor(ah, d) {
      this.d = d;
      const pts = (d.points || []).map(num);
      const f32 = Math.fround;
      const shape = [];
      let x0 = pts[0], y0 = pts[1];
      shape.push(x0, y0);
      let i = 2;
      while (i < pts.length) {
        const len = pts[i++];
        if (len === 1) {
          const x1 = pts[i++], y1 = pts[i++];
          shape.push(x1, y1); x0 = x1; y0 = y1;
        } else if (len === 2) {
          const x1 = pts[i++], y1 = pts[i++], x2 = pts[i++], y2 = pts[i++];
          for (let t = f32(0.2); t <= 1.0; t = f32(t + f32(0.2))) {
            shape.push(f32((1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * x1 + t * t * x2),
              f32((1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * y1 + t * t * y2));
          }
          x0 = x2; y0 = y2;
        } else if (len === 3) {
          const x1 = pts[i++], y1 = pts[i++], x2 = pts[i++], y2 = pts[i++], x3 = pts[i++], y3 = pts[i++];
          for (let t = f32(0.2); t <= 1.0; t = f32(t + f32(0.1))) {
            const a = (1 - t) * (1 - t), b = a * (1 - t);
            shape.push(f32(b * x0 + 3 * a * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t * x3),
              f32(b * y0 + 3 * a * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t * y3));
          }
          x0 = x3; y0 = y3;
        } else break;
      }
      const p = d.paint || { $c: 'ColorFill', red: 255, green: 255, blue: 255, alpha: 255 };
      const bw = paintWidth(p);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let k = 0; k < shape.length; k += 2) {
        minX = Math.min(minX, shape[k]); maxX = Math.max(maxX, shape[k]);
        minY = Math.min(minY, shape[k + 1]); maxY = Math.max(maxY, shape[k + 1]);
      }
      const x = Math.trunc(minX), y = Math.trunc(minY), width = Math.trunc(maxX), height = Math.trunc(maxY);
      const W = width + bw * 2, H = height + bw * 2;
      this.pw = W; this.ph = H; this.bw = bw;
      const c = document.createElement('canvas');
      c.width = Math.max(1, W); c.height = Math.max(1, H);
      const g = c.getContext('2d');
      const img = g.createImageData(c.width, c.height);
      const px = img.data;
      const mask = new Uint8Array(c.width * c.height);
      const put = (xx, yy, col) => {
        if (xx < 0 || yy < 0 || xx >= c.width || yy >= c.height) return;
        const o = (yy * c.width + xx) * 4;
        const a = col[3] / 255, inv = 1 - a;
        const da = px[o + 3] / 255;
        const oa = a + da * inv;
        if (oa <= 0) { px[o] = px[o + 1] = px[o + 2] = px[o + 3] = 0; }
        else {
          px[o] = Math.round((col[0] * a + px[o] * da * inv) / oa);
          px[o + 1] = Math.round((col[1] * a + px[o + 1] * da * inv) / oa);
          px[o + 2] = Math.round((col[2] * a + px[o + 2] * da * inv) / oa);
          px[o + 3] = Math.round(oa * 255);
        }
        mask[yy * c.width + xx] = 1;
      };
      const fill = paintFill(p);
      const fcol = fill && fill.$c === 'ColorFill' ? [fill.red, fill.green, fill.blue, colorAlpha(fill) * 255] : [0, 0, 0, 255];
      // even-odd fill, same test as libGDX Polygon.contains on integer points
      const n = shape.length;
      for (let j = y; j < height; j++) {
        const xs = [];
        for (let k = 0; k < n; k += 2) {
          const x1 = shape[k], y1 = shape[k + 1], x2 = shape[(k + 2) % n], y2 = shape[(k + 3) % n];
          if ((y1 <= j && j < y2) || (y2 <= j && j < y1)) xs.push((x2 - x1) / (y2 - y1) * (j - y1) + x1);
        }
        if (!xs.length) continue;
        for (let ii = x; ii < width; ii++) {
          let cnt = 0;
          for (const xi of xs) if (ii < xi) cnt++;
          if (cnt & 1) put(bw + ii, bw + j, fcol);
        }
      }
      const border = paintBorder(p);
      if (border && border.$c === 'ColorFill') {
        const bcol = [border.red, border.green, border.blue, colorAlpha(border) * 255];
        const line = (ax, ay, bx, by) => {
          let dx = Math.abs(bx - ax), dy = -Math.abs(by - ay);
          const sx = ax < bx ? 1 : -1, sy = ay < by ? 1 : -1;
          let err = dx + dy;
          for (;;) {
            put(ax, ay, bcol);
            if (ax === bx && ay === by) break;
            const e2 = 2 * err;
            if (e2 >= dy) { err += dy; ax += sx; }
            if (e2 <= dx) { err += dx; ay += sy; }
          }
        };
        let prevX = 0, prevY = 0;
        for (let k = 0; k < n; k += 2) {
          const cx = shape[k], cy = shape[k + 1];
          if (k >= 2) for (let q = 1; q <= bw; q++) line(Math.trunc(prevX) + q, Math.trunc(prevY) + q, Math.trunc(cx) + q, Math.trunc(cy) + q);
          prevX = cx; prevY = cy;
        }
        for (let q = 1; q <= bw; q++) line(Math.trunc(prevX) + q, Math.trunc(prevY) + q, Math.trunc(shape[0]) + q, Math.trunc(shape[1]) + q);
      }
      g.putImageData(img, 0, 0);
      this.canvas = c; this.mask = mask;
    }
    getWidth() { return this.pw; }
    getHeight() { return this.ph; }
    getDrawable() { return this; }
    contains(x, y) {
      if (x > 0 && y > 0 && x < this.pw && y < this.ph) return this.mask[y * this.canvas.width + x] === 1;
      return false;
    }
    render(r) { r.apply(); r.ctx.drawImage(this.canvas, 0, 0); }
  }

  // Caption (RuntimeCaption)
  class RCaption {
    constructor(ah, d) {
      this.ah = ah; this.d = d;
      this.gs = ah.engine.gameState;
      this.strings = ah.engine.strings;
      this.font = ah.font(d.font);
      this.text = this.processed();
      this.lines = []; this.widths = [];
      this.wrap();
      this.shape = null;
      if (d.hasBubble && d.bubblePaint) {
        this.shape = new RRectangle(ah, { width: this.getWidth(), height: this.getHeight(), paint: d.bubblePaint });
      }
    }
    processed() {
      const s = this.strings.getString(this.d.label);
      if (this.d.operations && this.d.operations.length) return this.gs.processTextVars(s, this.d.operations);
      return s;
    }
    update() {
      this.text = this.processed();
      if (this.currentText !== this.text) this.wrap();
    }
    load() { this.font = this.ah.font(this.d.font); this.text = this.processed(); this.wrap(); }
    getWidth() { return this.bounds ? this.bounds.w : 1; }
    getHeight() { return this.bounds ? this.bounds.h : 1; }
    wrap() {
      const d = this.d, font = this.font;
      this.currentText = this.text;
      this.lines = []; this.widths = [];
      this.totalParts = 0;
      this.bounds = { w: 0, h: 0 };
      this.lh = font.lineHeight();
      const pad = d.padding || 0;
      let pw = d.preferredWidth === -1 ? 2147483647 : d.preferredWidth === -2 ? 800 : d.preferredWidth;
      pw -= pad * 2;
      let words = this.text.split(' ');
      while (words.length > 1 && words[words.length - 1] === '') words.pop(); // Java split drops trailing empties
      if (words.length === 0) words = [this.text];
      let line = '', i = 0, cur = 0;
      while (i < words.length) {
        const nw = font.stringWidth(words[i] + ' ');
        if (cur + nw <= pw) {
          cur += nw; line += words[i++] + ' ';
        } else if (line !== '') {
          this.lines.push(line);
          cur = font.stringWidth(line);
          this.widths.push(cur);
          this.bounds.w = Math.max(this.bounds.w, cur);
          cur = 0; line = '';
        } else {
          line = this.splitLong(words[i++], pw);
          cur = font.stringWidth(line);
        }
      }
      if (line !== '') {
        this.lines.push(line);
        cur = font.stringWidth(line);
        this.widths.push(cur);
        this.bounds.w = Math.max(this.bounds.w, cur);
      }
      let ph = d.preferredHeight === -2 ? 600 : d.preferredHeight === -1 ? 2147483647 : d.preferredHeight;
      ph -= pad * 2;
      this.linesInPart = Math.trunc(ph / this.lh);
      this.linesInPart = this.linesInPart < this.lines.length ? this.linesInPart : this.lines.length;
      this.totalParts = this.linesInPart > 0 ? Math.ceil(this.lines.length / this.linesInPart) : 0;
      this.bounds.h = d.preferredHeight === -1 ? this.linesInPart * this.lh : ph;
      this.bounds.w = d.preferredWidth === -1 ? this.bounds.w : pw;
      this.heightOffset = d.preferredHeight !== -1 ? Math.trunc((ph - this.linesInPart * this.lh) / 2) : 0;
      this.bounds.w += pad * 2;
      this.bounds.h += pad * 2;
      this.reset();
    }
    splitLong(word, lw) {
      let finished = false, cur = '', i = 0;
      while (!finished) {
        cur = '';
        while (i < word.length && this.font.stringWidth(cur + word[i]) < lw) cur += word[i++];
        if (i === word.length) finished = true;
        else {
          if (cur === '' && i < word.length) { cur += word[i++]; }
          this.lines.push(cur);
          const w = this.font.stringWidth(cur);
          this.widths.push(w);
          this.bounds.w = Math.max(this.bounds.w, w);
        }
      }
      return cur;
    }
    goForward(n) {
      if (this.totalParts > 0) {
        this.currentPart += n;
        if (this.currentPart >= this.totalParts) {
          while (this.currentPart >= this.totalParts) { this.currentPart -= this.totalParts; this.loops--; this.timesRead++; }
          if (this.loops <= 0) this.currentPart = this.totalParts - 1;
        }
      }
    }
    reset() { this.currentPart = 0; this.timesRead = 0; this.loops = 0; }
    getText() {
      const b = this.currentPart * this.linesInPart;
      const e = Math.min(b + this.linesInPart, this.lines.length);
      return this.lines.slice(b, e);
    }
    getDrawable() { this.update(); return this; }
    contains(x, y) { return x > 0 && y > 0 && x < this.getWidth() && y < this.getHeight(); }
    render(r) {
      if (this.shape) this.shape.render(r);
      const d = this.d;
      const pad = d.padding || 0;
      let y = pad;
      if (this.currentPart === this.totalParts - 1 && this.linesInPart > 0 && this.lines.length % this.linesInPart !== 0) {
        y += Math.trunc((this.bounds.h - pad * 2 - ((this.lines.length % this.linesInPart) * this.lh)) / 2);
      } else y += this.heightOffset;
      let i = this.currentPart * this.linesInPart;
      const align = enumName(d.alignment);
      for (const s of this.getText()) {
        let x;
        if (align === 'CENTER') x = Math.trunc((this.bounds.w - this.widths[i]) / 2);
        else if (align === 'RIGHT') x = (this.bounds.w - this.widths[i]) - pad;
        else x = pad;
        drawText(r, s, x, y, this.font, d.textPaint);
        y += this.lh;
        i++;
      }
    }
  }

  class RComposed {
    constructor(ah, d) {
      this.ah = ah; this.d = d;
      this.list = d.assetList.map((a) => ah.get(a));
    }
    getWidth() { let w = 0; for (const a of this.list) w = Math.max(w, a.getWidth()); return w; }
    getHeight() { let h = 0; for (const a of this.list) h = Math.max(h, a.getHeight()); return h; }
    getDrawable(time, states, level) {
      for (const a of this.list) if (a) a.getDrawable(time, states, level);
      return this;
    }
    pos(i, a) {
      const p = this.d.positions[i];
      return [Math.trunc(p.x - p.dispX * a.getWidth()), Math.trunc(p.y - p.dispY * a.getHeight())];
    }
    render(r) {
      this.list.forEach((a, i) => {
        const [x, y] = this.pos(i, a);
        r.save(); r.translate(x, y); a.render(r); r.restore();
      });
    }
    contains(x, y) {
      return this.list.some((a, i) => { const [dx, dy] = this.pos(i, a); return a.contains(x - dx, y - dy); });
    }
  }

  // --------------------------------------------------------------- sounds
  // RuntimeSound: libGDX Sound semantics on top of HTMLAudio elements taken
  // from the engine's audio pool (needed to play audio on iOS).
  class RSound {
    constructor(ah, d) {
      this.ah = ah; this.d = d;
      const e = ah.manifest[d.uri];
      this.src = e ? ah.base + e.p : null;
      this.current = null;
      this.instances = [];
    }
    make(volume, loop) {
      if (!this.src) return null;
      const slot = this.ah.engine.audio.acquire(this.src, volume, loop, () => {
        const i = this.instances.indexOf(slot);
        if (i >= 0) this.instances.splice(i, 1);
      });
      if (slot) this.instances.push(slot);
      return slot;
    }
    play(override, volume) {
      if (override || !this.current) this.current = this.make(volume, false);
      else { this.stopOne(this.current); this.current = this.make(volume, false); }
    }
    loop(volume) { this.current = this.make(volume, true); }
    stopOne(slot) {
      if (!slot) return;
      this.ah.engine.audio.release(slot);
      const i = this.instances.indexOf(slot);
      if (i >= 0) this.instances.splice(i, 1);
    }
    stop() { this.stopOne(this.current); }
    setVolume(v) { if (this.current) this.ah.engine.audio.setVolume(this.current, v); }
  }

  class SoundManager {
    constructor(engine) {
      this.engine = engine;
      this.bg = null;
      this.silence = false;
      this.current = [];
      engine.gameState.setValue(null, EAD.SYS.SOUND_ON, !this.silence);
    }
    playSound(d, overlay, volume) {
      const s = this.engine.assets.get(d);
      if (!s) return;
      s.play(overlay, this.silence ? 0 : num(volume));
      if (this.current.indexOf(s) < 0) this.current.push(s);
    }
    playBackgroundMusic(d, volume) {
      if (this.bg) { this.bg.stop(); this.bg = null; }
      if (d) {
        this.bg = this.engine.assets.get(d);
        if (this.bg) this.bg.loop(this.silence ? 0 : num(volume));
      }
    }
    toggleSound() { this.setSilence(!this.silence); }
    setSilence(s) {
      this.silence = s;
      const v = s ? 0 : 1;
      if (this.bg) this.bg.setVolume(v);
      for (const x of this.current) x.setVolume(v);
      this.engine.gameState.setValue(null, EAD.SYS.SOUND_ON, !this.silence);
    }
    stopAll() {
      if (this.bg) this.bg.stop();
      for (const x of this.current) x.stop();
      this.engine.gameState.setValue(null, EAD.SYS.SOUND_ON, !this.silence);
    }
  }

  // ---------------------------------------------------------- asset handler
  class AssetHandler {
    constructor(engine, manifest, base) {
      this.engine = engine;
      this.manifest = manifest.assets;
      this.fontManifest = manifest.fonts;
      this.packs = manifest.packs || null;
      this.base = base || '';
      this.images = new Map();
      this.fonts = new Map();
      this.cache = new Map();
    }
    loadImage(uri) {
      const e = this.manifest[uri];
      if (!e) return Promise.resolve();
      const src = e.url || (e.p && /\.(webp|png|jpg)$/.test(e.p) ? this.base + e.p : null);
      if (!src) return Promise.resolve();
      return new Promise((res) => {
        const img = new Image();
        img.onload = () => { this.images.set(uri, img); res(); };
        img.onerror = () => { console.warn('image failed', uri); res(); };
        img.src = src;
      });
    }
    // Images may come packed in a few binary files (see make_dist.py):
    // fetch them with byte progress and expose each image as a blob URL.
    async loadPacks(onProgress) {
      const packs = this.packs || [];
      const total = packs.reduce((a, p) => a + (p.b64 || p.n), 0) || 1;
      let loaded = 0;
      const bufs = await Promise.all(packs.map(async (p) => {
        const size = p.b64 || p.n;
        const r = await fetch(this.base + p.p);
        let out;
        if (!r.body || !r.body.getReader) {
          out = new Uint8Array(await r.arrayBuffer()); loaded += size; if (onProgress) onProgress(Math.min(1, loaded / total));
        } else {
          const reader = r.body.getReader();
          out = new Uint8Array(size);
          let off = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (off + value.length > out.length) { const o2 = new Uint8Array(Math.max(out.length * 2, off + value.length)); o2.set(out); out = o2; }
            out.set(value, off); off += value.length; loaded += value.length;
            if (onProgress) onProgress(Math.min(1, loaded / total));
          }
          out = out.subarray(0, off);
        }
        if (p.b64) {
          const bin = atob(new TextDecoder().decode(out));
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          return bytes.buffer;
        }
        return out.buffer.byteLength === out.length ? out.buffer : out.slice().buffer;
      }));
      for (const uri in this.manifest) {
        const e = this.manifest[uri];
        if (e.k === undefined) continue;
        e.url = URL.createObjectURL(new Blob([new Uint8Array(bufs[e.k], e.o, e.n)], { type: e.t }));
      }
    }
    async loadFonts() {
      const entries = Object.entries(this.fontManifest);
      await Promise.all(entries.map(async ([uri, path]) => {
        const data = await (await fetch(this.base + path)).json();
        const img = await new Promise((res) => {
          const i = new Image(); i.onload = () => res(i); i.onerror = () => res(i); i.src = this.base + data.image;
        });
        this.fonts.set(uri, new BitmapFont(data, img));
      }));
    }
    async preload(onProgress) {
      await this.loadFonts();
      const hasPacks = this.packs && this.packs.length;
      if (hasPacks) await this.loadPacks((f) => onProgress && onProgress(f * 0.7));
      const uris = Object.keys(this.manifest).filter((u) => {
        const e = this.manifest[u];
        return e.k !== undefined || (e.p && /\.(webp|png|jpg)$/.test(e.p));
      }).filter((u) => !this.images.has(u));
      let done = 0;
      const queue = uris.slice();
      const worker = async () => {
        while (queue.length) {
          const u = queue.shift();
          await this.loadImage(u);
          done++;
          if (onProgress) onProgress((hasPacks ? 0.7 : 0) + (hasPacks ? 0.3 : 1) * done / uris.length);
        }
      };
      await Promise.all(Array.from({ length: 8 }, worker));
    }
    font(desc) {
      let uri = desc && desc.uri;
      if (!uri) {
        const size = Math.round(num(desc && desc.size) || 13);
        const st = enumName(desc && desc.style);
        const mod = st === 'BOLD' ? '-bold' : st === 'ITALIC' ? '-italic' : '';
        uri = '@font/droid-' + size + mod;
        if (!this.fonts.has(uri)) uri = '@font/droid-' + size;
        if (!this.fonts.has(uri)) uri = '@font/droid-12';
      }
      return this.fonts.get(uri) || this.fonts.values().next().value;
    }
    get(d) {
      if (!d) return null;
      let a = this.cache.get(d);
      if (a) return a;
      switch (d.$c) {
        case 'Image': a = new RImage(this, d); break;
        case 'FramesAnimation': a = new RFrames(this, d); break;
        case 'StateDrawable': a = new RStates(this, d); break;
        case 'FilteredDrawable': a = new RFiltered(this, d); break;
        case 'NinePatchImage': a = new RNinePatch(this, d); break;
        case 'RectangleShape': a = new RRectangle(this, d); break;
        case 'BezierShape': case 'BalloonShape': a = new RBezier(this, d); break;
        case 'Caption': a = new RCaption(this, d); break;
        case 'ComposedDrawable': a = new RComposed(this, d); break;
        case 'Sound': a = new RSound(this, d); break;
        default:
          if (EAD.debug) console.warn('Unknown asset', d.$c);
          return null;
      }
      this.cache.set(d, a);
      return a;
    }
  }

  Object.assign(EAD, { Renderer, BitmapFont, AssetHandler, SoundManager, drawText, RRectangle, RBezier, colorCss });
})();
