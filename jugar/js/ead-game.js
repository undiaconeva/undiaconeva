/*
 * eAdventure 2 runtime for the web — engine: boot, main loop, input,
 * audio pool, video overlay and the browser-side dialogs.
 */
(function () {
  'use strict';
  const EAD = window.EAD;
  const { V, SYS, num, jfloat, JLong, M } = EAD;

  // ------------------------------------------------------------ audio pool
  function silentWavUrl() {
    const n = 800, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
    w(36, 'data'); v.setUint32(40, n, true);
    for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }
  // Short sounds are mixed with the Web Audio API. On Android, starting a second
  // <audio> element can pause the first one for good (the music stopped when the
  // coin sound played); one AudioContext mixes any number of sounds instead.
  class FxPlayer {
    constructor() { this.ctx = null; this.cache = new Map(); this.live = new Set(); this.limit = 1500000; this.hidden = false; }
    unlock() {
      if (this.ctx) { this.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
        const s = this.ctx.createBufferSource();
        s.buffer = this.ctx.createBuffer(1, 1, 22050);
        s.connect(this.ctx.destination);
        s.start(0);
        this.resume();
      } catch (e) { this.ctx = null; }
    }
    resume() { const c = this.ctx; if (c && !this.hidden && c.state !== 'running' && c.resume) c.resume().catch(() => {}); }
    // an AudioBuffer, or null when the file is better streamed by a media element
    buffer(url) {
      let p = this.cache.get(url);
      if (!p) {
        p = fetch(url).then((r) => r.arrayBuffer())
          .then((ab) => (ab.byteLength > this.limit ? null : new Promise((res, rej) => this.ctx.decodeAudioData(ab, res, rej))))
          .catch(() => null);
        this.cache.set(url, p);
      }
      return p;
    }
    // onEnd: the sound finished by itself; onFallback: it has to be played some other way
    play(url, volume, onEnd, onFallback) {
      const h = { gain: this.ctx.createGain(), node: null, stopped: false, done: false };
      h.gain.gain.value = volume;
      h.gain.connect(this.ctx.destination);
      this.live.add(h);
      this.resume();
      this.buffer(url).then((buf) => {
        if (h.stopped) return;
        if (!buf) { this.stop(h); if (onFallback) onFallback(); return; }
        const n = this.ctx.createBufferSource();
        n.buffer = buf;
        n.connect(h.gain);
        n.onended = () => {
          if (h.stopped || h.done) return;
          h.done = true; this.live.delete(h);
          try { h.gain.disconnect(); } catch (e) { /* ignore */ }
          if (onEnd) onEnd();
        };
        h.node = n;
        n.start(0);
      });
      return h;
    }
    setVolume(h, v) { h.gain.gain.value = v; }
    stop(h) {
      if (h.stopped) return;
      h.stopped = true; this.live.delete(h);
      if (h.node) { try { h.node.stop(); } catch (e) { /* not started */ } }
      try { h.gain.disconnect(); } catch (e) { /* ignore */ }
    }
    setHidden(hidden) {
      this.hidden = hidden;
      if (!this.ctx) return;
      if (hidden) { if (this.ctx.suspend) this.ctx.suspend().catch(() => {}); } else this.resume();
    }
  }

  class AudioPool {
    constructor() { this.slots = []; this.unlocked = false; this.counter = 0; this.fx = new FxPlayer(); this.hidden = false; this.fxSlots = new Set(); }
    unlock() {
      this.fx.unlock();
      if (this.unlocked) return;
      this.unlocked = true;
      const silent = silentWavUrl();
      for (let i = 0; i < 4; i++) {
        const a = new Audio();
        a.preload = 'auto';
        a.src = silent;
        const p = a.play();
        if (p && p.then) p.then(() => a.pause()).catch(() => {});
        this.slots.push(this.wrap(a));
      }
      // Android may pause the music on its own (another media element, a video):
      // start it again, as the game never pauses it itself.
      setInterval(() => {
        if (this.hidden) return;
        for (const s of this.slots) if (s.busy && s.loop && s.a.paused) { const p = s.a.play(); if (p && p.catch) p.catch(() => {}); }
      }, 1000);
    }
    // decode the short sounds ahead of time so the first one is not late
    preload(urls) { if (this.fx.ctx) for (const u of urls) this.fx.buffer(u); }
    wrap(a) {
      const slot = { a, busy: false, loop: false, t: 0, onEnd: null };
      a.addEventListener('ended', () => {
        if (slot.loop) return;
        slot.busy = false;
        if (slot.onEnd) { const f = slot.onEnd; slot.onEnd = null; f(); }
      });
      return slot;
    }
    acquire(src, volume, loop, onEnd) {
      if (!loop && this.fx.ctx) return this.acquireFx(src, volume, onEnd);
      return this.acquireElement(src, volume, loop, onEnd);
    }
    acquireFx(src, volume, onEnd) {
      const slot = { fx: true, busy: true, loop: false, t: ++this.counter, onEnd: onEnd || null, vol: Math.max(0, Math.min(1, num(volume))), h: null, el: null };
      this.fxSlots.add(slot);
      const finished = () => {
        if (!slot.busy) return;
        slot.busy = false; this.fxSlots.delete(slot);
        if (slot.onEnd) { const f = slot.onEnd; slot.onEnd = null; f(); }
      };
      slot.h = this.fx.play(src, slot.vol, finished, () => {
        // too long or undecodable: a media element after all
        if (!slot.busy) return;
        slot.el = this.acquireElement(src, slot.vol, false, finished);
      });
      return slot;
    }
    acquireElement(src, volume, loop, onEnd) {
      let slot = this.slots.find((s) => !s.busy);
      if (!slot) {
        if (!this.unlocked || this.slots.length < 24) { slot = this.wrap(new Audio()); this.slots.push(slot); }
        else {
          slot = this.slots.filter((s) => !s.loop).sort((x, y) => x.t - y.t)[0] || this.slots[0];
          this.release(slot);
        }
      }
      slot.busy = true; slot.loop = !!loop; slot.t = ++this.counter; slot.onEnd = onEnd || null;
      const a = slot.a;
      if (a.src !== src && !a.src.endsWith(src)) a.src = src;
      a.loop = !!loop;
      this.setVolume(slot, volume);
      try { a.currentTime = 0; } catch (e) { /* not loaded yet */ }
      if (!this.hidden) { const p = a.play(); if (p && p.catch) p.catch(() => {}); } else slot.wasPlaying = true;
      return slot;
    }
    setVolume(slot, v) {
      v = Math.max(0, Math.min(1, num(v)));
      if (slot.fx) {
        slot.vol = v;
        if (slot.h) this.fx.setVolume(slot.h, v);
        if (slot.el) this.setVolume(slot.el, v);
        return;
      }
      try { slot.a.volume = v; } catch (e) { /* iOS: read-only */ }
      slot.a.muted = v === 0;
    }
    release(slot) {
      if (!slot) return;
      if (slot.fx) {
        slot.busy = false; slot.onEnd = null; this.fxSlots.delete(slot);
        if (slot.h) this.fx.stop(slot.h);
        if (slot.el) this.release(slot.el);
        return;
      }
      slot.a.pause();
      slot.busy = false; slot.loop = false; slot.onEnd = null;
    }
    stopAll() {
      for (const s of this.slots) this.release(s);
      for (const s of [...this.fxSlots]) this.release(s);
    }
    // pause what is playing while the page is hidden; resume afterwards
    setHidden(h) {
      this.hidden = h;
      this.fx.setHidden(h);
      for (const s of this.slots) {
        if (h) { s.wasPlaying = s.busy && !s.a.paused; if (s.wasPlaying) s.a.pause(); }
        else if (s.wasPlaying) { s.wasPlaying = false; const p = s.a.play(); if (p && p.catch) p.catch(() => {}); }
      }
    }
  }

  // --------------------------------------------------------- video player
  class VideoPlayer {
    constructor(engine) { this.engine = engine; this.el = null; this.onEnd = null; }
    play(desc, onEnd) {
      this.stop();
      const e = desc && this.engine.assets.manifest[desc.uri];
      if (!e) { onEnd(); return; }
      const wrap = document.createElement('div');
      wrap.className = 'ead-video';
      const v = document.createElement('video');
      v.src = this.engine.base + e.p;
      v.playsInline = true;
      v.setAttribute('playsinline', '');
      v.preload = 'auto';
      const skip = document.createElement('button');
      skip.className = 'ead-skip';
      skip.type = 'button';
      skip.textContent = 'Saltar vídeo ›';
      wrap.appendChild(v);
      wrap.appendChild(skip);
      this.engine.frame.appendChild(wrap);
      this.el = wrap; this.video = v; this.onEnd = onEnd;
      // as the desktop video renderers did: silence the game's music and
      // sounds while the video plays, and give them back afterwards
      const sm = this.engine.sound;
      if (sm) { this.wasSilence = sm.silence; sm.setSilence(true); }
      const done = () => { if (this.el === wrap) { this.stop(); onEnd(); } };
      v.addEventListener('ended', done);
      v.addEventListener('error', done);
      skip.addEventListener('click', (ev) => { ev.stopPropagation(); done(); });
      const p = v.play();
      if (p && p.catch) p.catch(() => { v.muted = true; v.play().catch(done); });
    }
    stop() {
      if (this.el) {
        try { this.video.pause(); } catch (e) { /* ignore */ }
        this.el.remove();
        this.el = null; this.video = null;
        const sm = this.engine.sound;
        if (sm && this.wasSilence !== undefined) { sm.setSilence(this.wasSilence); this.wasSilence = undefined; }
      }
    }
  }

  // --------------------------------------------------------------- engine
  class Engine {
    constructor(opts) {
      this.frame = opts.frame;
      this.canvas = opts.canvas;
      this.base = opts.base || '';
      this.ctx = this.canvas.getContext('2d');
      this.renderer = new EAD.Renderer(this.ctx);
      this.delta = 0;
      this.acc = 0;
      this.last = 0;
      this.inputQueue = [];
      this.pointer = { x: 0, y: 0, down: 0 };
      // phones and tablets: no drawn cursor until a mouse shows up
      this.touchMode = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
      this.events = [];
      this.started = false;
      this.audio = new AudioPool();
      this.video = new VideoPlayer(this);
      this.ui = opts.ui || {};
    }

    async boot(onProgress) {
      const get = async (p) => (await fetch(this.base + p)).json();
      const [model, strings, manifest] = await Promise.all([
        get('data/model.json'), get('data/strings.json'), get('data/assets.json')]);
      this.model = EAD.loadModel(model);
      this.strings = new EAD.StringHandler(strings);
      this.gameState = new EAD.GameState(this.strings);
      this.gameState.engine = this;
      this.gameState.tweens = new EAD.TweenManager();
      this.assets = new EAD.AssetHandler(this, manifest, this.base);
      this.sef = new EAD.SceneElementGOFactory(this);
      this.gui = new EAD.GUI(this);
      this.stage = new EAD.Stage(this);
      this.sound = new EAD.SoundManager(this);
      // the game's own loading screen first
      await this.assets.loadFonts();
      await Promise.all(['@drawable/loading.png', '@drawable/loadingbar.png', '@drawable/default_cursor.png']
        .map((u) => this.assets.loadImage(u)));
      this.gui.initialize();
      this.installInput();
      this.resize();
      window.addEventListener('resize', () => this.resize());
      this.restart(true);
      requestAnimationFrame((t) => this.loop(t));
      await this.assets.preload((f) => {
        this.gameState.setValue(null, SYS.LOADING, Math.trunc(30 + 70 * f));
        if (onProgress) onProgress(f);
      });
      this.gameState.setValue(null, SYS.LOADING, 100);
    }

    // ------------------------------------------------------- lifecycle
    createEffectGO(e) { return EAD.createEffectGO(this, e); }
    createEventGO(e) { return EAD.createEventGO(this, e); }
    skippedMilliseconds() { return this.gameState.paused ? 0 : this.delta; }

    restart(reloadModel) {
      this.lastUpdate = Date.now();
      this.events = [];
      this.video.stop();
      this.gameState.reset();
      this.gui.reset();
      this.sound.stopAll();
      this.audio.stopAll();
      this.stage.root.clearChildren();
      this.stage.root.addActor(this.gui.root);
      this.stage.pointerOver = null; this.stage.mouseOver = null; this.stage.touchFocuses = [];
      if (reloadModel) {
        // LoadGameGO: loading screen and hidden cursor while assets load
        this.gui.setScene(this.sef.get(this.gui.makeLoadingScreen()));
        this.gameState.setValue({ id: '#engine.cursor' }, V.VISIBLE, false);
        this.gameState.setValue(null, SYS.LOADING, 30);
      } else this.startGame();
    }

    startGame() {
      const gs = this.gameState;
      this.chapter = this.model.chapters[0];
      gs.addEffect(M.effect('ChangeSceneEf', { nextScene: this.chapter.initialScene, transition: null }));
      this.events = [];
      for (const e of (this.chapter.events || []).concat(this.model.events || [])) {
        const go = this.createEventGO(e);
        if (!go) continue;
        go.setParent(null);
        go.initialize();
        this.events.push(go);
      }
      gs.setValue({ id: '#engine.cursor' }, V.VISIBLE, true);
      this.started = true;
    }

    // called from the start button (a user gesture: unlocks audio)
    begin() {
      this.audio.unlock();
      this.audio.preload(this.fxUrls());
      this.startGame();
    }
    // the files of the short sounds (PlaySoundEf that are not background music)
    fxUrls() {
      const out = new Set(), seen = new Set();
      const walk = (o) => {
        if (!o || typeof o !== 'object' || seen.has(o)) return;
        seen.add(o);
        if (o.$c === 'PlaySoundEf' && !o.background && o.sound && o.sound.uri) {
          const e = this.assets.manifest[o.sound.uri];
          if (e && e.p) out.add(this.base + e.p);
        }
        for (const k in o) walk(o[k]);
      };
      walk(this.model);
      return [...out];
    }

    quit() {
      this.sound.stopAll();
      this.audio.stopAll();
      if (this.ui.onQuit) this.ui.onQuit();
    }

    onSceneChanged(sceneGO) {
      if (this.ui.onScene) this.ui.onScene(sceneGO.element ? sceneGO.element.id : null);
    }

    showReport(rows) { if (this.ui.onReport) this.ui.onReport(rows); }

    setHidden(h) {
      this.audio.setHidden(h);
      if (this.video.video) { if (h) this.video.video.pause(); else this.video.video.play().catch(() => {}); }
    }

    // ------------------------------------------------------------- input
    toLogical(ev) {
      const r = this.canvas.getBoundingClientRect();
      const x = Math.floor((ev.clientX - r.left) * 800 / r.width);
      const y = Math.floor((ev.clientY - r.top) * 600 / r.height);
      return [x, y];
    }
    installInput() {
      const c = this.canvas;
      c.addEventListener('contextmenu', (e) => e.preventDefault());
      c.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'mouse') this.touchMode = false;
        const [x, y] = this.toLogical(e);
        this.pointer.x = x; this.pointer.y = y;
        this.inputQueue.push({ t: this.pointer.down ? 'drag' : 'move', x, y });
      });
      c.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const [x, y] = this.toLogical(e);
        this.pointer.x = x; this.pointer.y = y;
        this.touchMode = e.pointerType !== 'mouse';
        if (this.touchMode) this.inputQueue.push({ t: 'move', x, y, touch: true });
        this.pointer.down++;
        this.inputQueue.push({ t: 'down', x, y, button: e.button === 1 ? 1 : e.button === 2 ? 2 : 0 });
        try { c.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      });
      const up = (e) => {
        const [x, y] = this.toLogical(e);
        this.pointer.down = Math.max(0, this.pointer.down - 1);
        this.inputQueue.push({ t: 'up', x, y, button: e.button === 1 ? 1 : e.button === 2 ? 2 : 0 });
        if (e.pointerType !== 'mouse') {
          // a finger leaves the screen: nothing should stay highlighted where it was
          // (a mouse pointer would move away; the next answers appeared dimmed otherwise)
          this.pointer.x = -100; this.pointer.y = -100;
          this.inputQueue.push({ t: 'move', x: -100, y: -100 });
        }
      };
      c.addEventListener('pointerup', up);
      c.addEventListener('pointercancel', up);
    }
    processInput() {
      const st = this.stage;
      let touchMoved = false;
      while (this.inputQueue.length) {
        const ev = this.inputQueue[0];
        // a tap: let the hover (enter) happen one frame before the press
        if (ev.t === 'down' && touchMoved) break;
        this.inputQueue.shift();
        if (ev.t === 'move') { st.mouseMoved(ev.x, ev.y); if (ev.touch) touchMoved = true; }
        else if (ev.t === 'drag') st.touchDragged(ev.x, ev.y);
        else if (ev.t === 'down') st.touchDown(ev.x, ev.y, ev.button);
        else if (ev.t === 'up') st.touchUp(ev.x, ev.y, ev.button);
      }
    }

    // ------------------------------------------------------------ render
    resize() {
      const r = this.canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
      if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    }
    loop(t) {
      requestAnimationFrame((tt) => this.loop(tt));
      if (!this.last) this.last = t;
      const dt = Math.min(Math.max(0, t - this.last), 100);
      this.last = t;
      this.acc += dt;
      const d = Math.floor(this.acc);
      this.acc -= d;
      try { this.step(d); } catch (e) { console.error(e); }
    }
    step(d) {
      const gs = this.gameState;
      this.delta = d;
      this.processInput();
      const skipped = this.skippedMilliseconds();
      // Game.act
      gs.update(skipped);
      gs.setValue(null, SYS.ELAPSED_TIME_PER_UPDATE, skipped);
      gs.setValue(null, SYS.SECONDS_PLAYING, Math.trunc((Date.now() - this.lastUpdate) / 1000));
      if (!gs.paused) {
        const l = gs.getValue(null, SYS.GAME_TIME);
        gs.setValue(null, SYS.GAME_TIME, new JLong(num(l) + skipped));
        for (const e of this.events) e.act(skipped);
      }
      // Stage.act
      this.stage.act(skipped);
      gs.setValue(null, SYS.MOUSE_SCENE_X, jfloat(this.pointer.x));
      gs.setValue(null, SYS.MOUSE_SCENE_Y, jfloat(this.pointer.y));
      gs.setValue(null, SYS.MOUSE_X, jfloat(this.pointer.x));
      gs.setValue(null, SYS.MOUSE_Y, jfloat(this.pointer.y));
      this.draw();
    }
    draw() {
      const ctx = this.ctx, c = this.canvas;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      this.renderer.begin(new DOMMatrix([c.width / 800, 0, 0, c.height / 600, 0, 0]));
      this.stage.draw(this.renderer);
    }

    // ------------------------------------------------------------- debug
    findScene(id) { return this.model.chapters[0].scenes.find((s) => s.id === id) || null; }
    debugGoto(id) {
      const s = this.findScene(id);
      if (s) this.gameState.addEffect(M.effect('ChangeSceneEf', { nextScene: s, transition: null }));
      return !!s;
    }
  }

  EAD.Engine = Engine;
})();
