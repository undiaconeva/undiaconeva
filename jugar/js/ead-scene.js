/*
 * eAdventure 2 runtime for the web — scene graph: model builders, scene
 * element game objects (libGDX scene2d semantics), GUI hierarchy, input
 * dispatching and event game objects.
 */
(function () {
  'use strict';
  const EAD = window.EAD;
  const { EMap, V, SYS, num, jfloat, jenum, enumName, elKey } = EAD;
  const F = (v) => jfloat(v);

  // ------------------------------------------------------- model builders
  let runtimeIds = 0;
  const M = {
    behavior() { return { $c: 'Behavior', behavior: new EMap() }; },
    def(appearance) {
      return {
        $c: 'SceneElementDef', vars: new EMap(),
        resources: new EMap([['initialBundle', new EMap(appearance ? [['appearance', appearance]] : [])]]),
        behavior: M.behavior(), events: [], id: null,
      };
    },
    base(cls, appearance, id) {
      const e = {
        $c: cls, id: id === undefined ? null : id, vars: new EMap(), definition: M.def(appearance),
        behavior: M.behavior(), events: [], containsBounds: false,
      };
      if (e.id === null) Object.defineProperty(e, '__k', { value: 'rt:' + (++runtimeIds), enumerable: false });
      M.setPosition(e, 0, 0, 0, 0);
      return e;
    },
    sceneElement(appearance, id) { return M.base('SceneElement', appearance, id); },
    ghost(catchAll, id) { const g = M.base('GhostElement', null, id); g.catchAll = !!catchAll; return g; },
    group(appearance, id) { const g = M.base('GroupElement', appearance, id); g.sceneElements = []; return g; },
    scene(bgDrawable, id, cls) {
      const s = M.group(null, id);
      s.$c = cls || 'BasicScene';
      s.background = M.sceneElement(bgDrawable);
      s.returnable = true;
      return s;
    },
    setPosition(e, x, y, dx, dy) {
      e.vars.set(V.X, F(x)); e.vars.set(V.Y, F(y));
      if (dx !== undefined) { e.vars.set(V.DISP_X, F(dx)); e.vars.set(V.DISP_Y, F(dy)); }
    },
    setVar(e, def, v) { e.vars.set(def, v); },
    setAppearance(e, bundle, d) {
      let m = e.definition.resources.get(bundle);
      if (!m) { m = new EMap(); e.definition.resources.set(bundle, m); }
      m.set('appearance', d);
    },
    addBehavior(e, gev, effect) {
      let l = e.behavior.behavior.get(gev);
      if (!l) { l = []; e.behavior.behavior.set(gev, l); }
      if (Array.isArray(effect)) l.push(...effect); else l.push(effect);
    },
    image(uri) { return { $c: 'Image', uri }; },
    rect(w, h, paint) { return { $c: 'RectangleShape', width: w, height: h, paint }; },
    color(r, g, b, a) { return { $c: 'ColorFill', red: r, green: g, blue: b, alpha: a === undefined ? 255 : a }; },
    paint(fill, border, width) { return { $c: 'Paint', fill, border, width: width === undefined ? 1 : width }; },
    field(el, def) { return { $c: 'BasicField', element: el, varDef: def }; },
    value(v) { return { $c: 'ValueOp', value: v }; },
    effect(cls, props) {
      return Object.assign({ $c: cls, persistent: false, nextEffects: [], simultaneousEffects: [], nextEffectsAlways: false, condition: null }, props || {});
    },
    mouse(type, button) { return { $c: 'MouseGEv', type: jenum('MouseGEvType', type), button: jenum('MouseGEvButtonType', button) }; },
  };
  M.WHITE = M.color(255, 255, 255); M.BLACK = M.color(0, 0, 0); M.TRANSPARENT = M.color(0, 0, 0, 0);
  M.BLACK_ON_WHITE = M.paint(M.WHITE, M.BLACK, 1);
  M.WHITE_ON_BLACK = M.paint(M.BLACK, M.WHITE, 1);
  const GEV = {
    LEFT_PRESSED: M.mouse('PRESSED', 'BUTTON_1'),
    RIGHT_PRESSED: M.mouse('PRESSED', 'BUTTON_3'),
    MIDDLE_PRESSED: M.mouse('PRESSED', 'BUTTON_2'),
    LEFT_RELEASED: M.mouse('RELEASED', 'BUTTON_1'),
    RIGHT_RELEASED: M.mouse('RELEASED', 'BUTTON_3'),
    MIDDLE_RELEASED: M.mouse('RELEASED', 'BUTTON_2'),
    ENTERED: M.mouse('ENTERED', 'NO_BUTTON'),
    EXITED: M.mouse('EXITED', 'NO_BUTTON'),
    MOVED: M.mouse('MOVED', 'NO_BUTTON'),
  };

  function getAsset(def, bundle, id) {
    if (!def || !def.resources) return null;
    const m = def.resources.get(bundle);
    if (!m) return null;
    const a = m.get(id);
    return a === undefined ? null : a;
  }
  function getEffects(withBehavior, gev) {
    if (!withBehavior || !withBehavior.behavior || !gev) return null;
    const l = withBehavior.behavior.behavior.get(gev);
    return l || null;
  }
  function effectsForEvent(ev, type) {
    if (!ev.effects) return null;
    for (const [k, v] of ev.effects.entries) if (enumName(k) === type) return v;
    return null;
  }

  // ---------------------------------------------------------- input event
  class InputEvent {
    constructor(type, x, y, button) {
      this.type = type; this.stageX = x; this.stageY = y; this.button = button || 0;
      this.cancelled = false; this.stopped = false; this.handled = false;
      this.target = null; this.relatedActor = null;
    }
    cancel() { this.cancelled = true; this.stopped = true; this.handled = true; }
    stop() { this.stopped = true; }
  }

  // ------------------------------------------------------------ base actor
  class Group {
    constructor() {
      this.children = [];
      this.parent = null;
      this.ax = 0; this.ay = 0; this.w = 0; this.h = 0;
      this.ox = 0; this.oy = 0; this.asx = 1; this.asy = 1; this.rot = 0;
      this.visible = true; this.touchable = true; this.alpha = 1;
      this.name = null;
      this.world = new DOMMatrix();
    }
    getX() { return this.ax; }
    getY() { return this.ay; }
    getScaleX() { return this.asx; }
    getScaleY() { return this.asy; }
    addActor(a) {
      a.remove();
      this.children.push(a);
      a.parent = this;
    }
    removeActor(a) {
      const i = this.children.indexOf(a);
      if (i < 0) return false;
      this.children.splice(i, 1);
      a.parent = null;
      return true;
    }
    remove() { return this.parent ? this.parent.removeActor(this) : false; }
    clearChildren() { for (const c of this.children) c.parent = null; this.children.length = 0; }
    findActor(name) {
      for (const c of this.children) if (c.name === name) return c;
      for (const c of this.children) if (c.findActor) { const a = c.findActor(name); if (a) return a; }
      return null;
    }
    computeTransform() {
      const ox = this.ox, oy = this.oy, rot = this.rot, sx = this.getScaleX(), sy = this.getScaleY();
      let m = new DOMMatrix();
      if (ox !== 0 || oy !== 0) m = m.translate(ox, oy);
      if (rot !== 0) m = m.rotate(rot);
      if (sx !== 1 || sy !== 1) m = m.scale(sx, sy);
      if (ox !== 0 || oy !== 0) m = m.translate(-ox, -oy);
      m.e += this.getX(); m.f += this.getY();
      this.world = this.parent ? this.parent.world.multiply(m) : m;
      return this.world;
    }
    parentToLocal(px, py) {
      const rotation = this.rot, scaleX = this.getScaleX(), scaleY = this.getScaleY();
      const childX = this.getX(), childY = this.getY();
      const originX = this.ox, originY = this.oy;
      if (rotation === 0) {
        if (scaleX === 1 && scaleY === 1) return [px - childX, py - childY];
        if (originX === 0 && originY === 0) return [(px - childX) / scaleX, (py - childY) / scaleY];
        return [(px - childX - originX) / scaleX + originX, (py - childY - originY) / scaleY + originY];
      }
      const cos = Math.cos(rotation * Math.PI / 180), sin = Math.sin(rotation * Math.PI / 180);
      if (scaleX === 1 && scaleY === 1) {
        if (originX === 0 && originY === 0) {
          const tox = px - childX, toy = py - childY;
          return [tox * cos + toy * sin, tox * -sin + toy * cos];
        }
        const wox = childX + originX, woy = childY + originY;
        const fx = -originX, fy = -originY;
        const x1 = cos * fx - sin * fy + wox, y1 = sin * fx + cos * fy + woy;
        const tox = px - x1, toy = py - y1;
        return [tox * cos + toy * sin, tox * -sin + toy * cos];
      }
      if (originX === 0 && originY === 0) {
        const tox = px - childX, toy = py - childY;
        return [(tox * cos + toy * sin) / scaleX, (tox * -sin + toy * cos) / scaleY];
      }
      const wox = childX + originX, woy = childY + originY;
      const fx = -originX * scaleX, fy = -originY * scaleY;
      const x1 = cos * fx - sin * fy + wox, y1 = sin * fx + cos * fy + woy;
      const tox = px - x1, toy = py - y1;
      return [(tox * cos + toy * sin) / scaleX, (tox * -sin + toy * cos) / scaleY];
    }
    actorHit(x, y, touchable) {
      if (touchable && !this.touchable) return null;
      return x >= 0 && x < this.w && y >= 0 && y < this.h ? this : null;
    }
    groupHit(x, y, touchable) {
      if (touchable && !this.touchable) return null;
      for (let i = this.children.length - 1; i >= 0; i--) {
        const c = this.children[i];
        if (!c || !c.visible) continue;
        const p = c.parentToLocal(x, y);
        const h = c.hit(p[0], p[1], touchable);
        if (h) return h;
      }
      return this.actorHit(x, y, touchable);
    }
    hit(x, y, touchable) { return this.groupHit(x, y, touchable); }
    act(delta) {
      const snap = this.children.slice();
      for (const c of snap) c.act(delta);
    }
    draw(r, parentAlpha) {
      this.computeTransform();
      this.drawChildren(r, parentAlpha);
    }
    drawChildren(r, parentAlpha) {
      parentAlpha *= this.alpha;
      for (const c of this.children.slice()) if (c.visible) c.draw(r, parentAlpha);
    }
    handle() { return false; }
    listeners() { return []; }
  }

  // ------------------------------------------------------- scene elements
  class SceneElementGO extends Group {
    constructor(engine) {
      super();
      this.engine = engine;
      this.gs = engine.gameState;
      this.dispX = 0; this.dispY = 0; this.z = 0; this.scale = 1;
      this.center = [0, 0]; this.topLeft = [0, 0]; this.bottomRight = [0, 0];
      this.statesList = [];
      this.eventGOList = [];
      this.comparator = null;
    }
    setElement(element) {
      const gs = this.gs;
      this.element = element;
      this.resetVars();
      this.name = element.id;
      if (!gs.contains(element)) {
        const def = element.definition;
        if (def && def.vars) for (const [d, v] of def.vars.entries) gs.setValue(element, d, v);
        if (element.vars) for (const [d, v] of element.vars.entries) gs.setValue(element, d, v);
      }
      this.initEvents(element.events);
      this.initEvents(element.definition ? element.definition.events : null);
      this.updateVars();
      this.setExtraVars();
    }
    resetVars() {
      this.statesList = [];
      this.eventGOList = [];
      this.currentBundle = null;
      this.currentDrawable = null;
      this.inputProcessor = null;
      this.mouseOver = false;
      this.reorder = false;
      this.runtimeDrawable = null;
      this.scale = 1;
      this.state = null;
      this.timeDisplayed = 0;
      this.alpha = 1;
    }
    initEvents(events) {
      if (this.element.events && events) {
        for (const ev of events) {
          const go = this.engine.createEventGO(ev);
          if (!go) continue;
          go.setParent(this.element);
          go.initialize();
          this.eventGOList.push(go);
        }
      }
    }
    updateVars() {
      const gs = this.gs, el = this.element;
      this.touchable = !!gs.getValue(el, V.ENABLE);
      this.orientation = gs.getValue(el, V.ORIENTATION);
      this.state = gs.getValue(el, V.STATE);
      this.setZ(gs.getValue(el, V.Z));
      this.setVisible(gs.getValue(el, V.VISIBLE));
      this.setRotation(num(gs.getValue(el, V.ROTATION)));
      this.setScale(num(gs.getValue(el, V.SCALE)));
      this.setScaleX(num(gs.getValue(el, V.SCALE_X)));
      this.setScaleY(num(gs.getValue(el, V.SCALE_Y)));
      this.setAlpha(num(gs.getValue(el, V.ALPHA)));
      this.statesList = [this.state, EAD.jstr(this.orientation)];
      this.updateBundle();
      this.setX(num(gs.getValue(el, V.X)));
      this.setY(num(gs.getValue(el, V.Y)));
      this.setDispX(num(gs.getValue(el, V.DISP_X)));
      this.setDispY(num(gs.getValue(el, V.DISP_Y)));
    }
    updateBundle() {
      const gs = this.gs, el = this.element;
      const newBundle = gs.getValue(el, V.BUNDLE_ID);
      const newMouseOver = !!gs.getValue(el, V.MOUSE_OVER);
      if (this.currentBundle === null || this.currentBundle !== newBundle || newMouseOver !== this.mouseOver) {
        this.currentBundle = newBundle;
        this.mouseOver = newMouseOver;
        let a = getAsset(el.definition, this.currentBundle, this.mouseOver ? 'overAppearance' : 'appearance');
        if (!a) a = getAsset(el.definition, this.currentBundle, 'appearance');
        if (a) {
          this.runtimeDrawable = this.engine.assets.get(a);
          if (this.runtimeDrawable) {
            this.currentDrawable = this.runtimeDrawable.getDrawable(this.timeDisplayed, this.statesList, 0);
            if (this.currentDrawable) {
              if (this.currentDrawable.getWidth() !== this.w) this.setWidth(this.currentDrawable.getWidth());
              if (this.currentDrawable.getHeight() !== this.h) this.setHeight(this.currentDrawable.getHeight());
            }
          }
        }
      }
    }
    setExtraVars() {
      const gs = this.gs, el = this.element;
      gs.setValue(el, V.LEFT, F(this.topLeft[0]));
      gs.setValue(el, V.TOP, F(this.topLeft[1]));
      gs.setValue(el, V.BOTTOM, F(this.bottomRight[1]));
      gs.setValue(el, V.RIGHT, F(this.bottomRight[0]));
      gs.setValue(el, V.CENTER_X, F(this.center[0]));
      gs.setValue(el, V.CENTER_Y, F(this.center[1]));
    }
    getElement() { return this.element; }
    addSceneElementModel(element) {
      const go = this.engine.sef.get(element);
      this.addSceneElement(go);
      return go;
    }
    addSceneElement(go) { if (go) this.addActor(go); }
    addActor(a) { super.addActor(a); this.invalidateOrder(); }
    setRotation(r) {
      this.rot = r;
      this.gs.setValue(this.element, V.ROTATION, F(r));
      this.updateRelativesFlag = true;
    }
    setX(x) {
      this.updateRelativesFlag = true;
      this.ax = x;
      this.gs.setValue(this.element, V.X, F(x));
    }
    setY(y) {
      this.updateRelativesFlag = true;
      this.ay = y;
      this.gs.setValue(this.element, V.Y, F(y));
    }
    getX() { return this.ax - this.ox; }
    getY() { return this.ay - this.oy; }
    getRelativeX() { return this.ax; }
    getRelativeY() { return this.ay; }
    setPositionXY(x, y) { this.setX(x); this.setY(y); }
    updateRelatives() {
      const m = this.computeTransform();
      const tr = (x, y) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
      this.center = tr(this.w / 2, this.h / 2);
      this.topLeft = tr(0, 0);
      this.bottomRight = tr(this.w, this.h);
      this.setExtraVars();
    }
    getCenterX() { return this.center[0]; }
    getCenterY() { return this.center[1]; }
    getRight() { return this.bottomRight[0]; }
    getBottom() { return this.bottomRight[1]; }
    getTop() { return this.topLeft[1]; }
    getLeft() { return this.topLeft[0]; }
    setDispX(d) {
      this.dispX = d;
      this.ox = this.w * d;
      this.gs.setValue(this.element, V.DISP_X, F(d));
    }
    setDispY(d) {
      this.dispY = d;
      this.oy = this.h * d;
      this.gs.setValue(this.element, V.DISP_Y, F(d));
    }
    getDispX() { return this.dispX; }
    getDispY() { return this.dispY; }
    getZ() { return this.z; }
    setZ(z) {
      if (this.z !== z) {
        this.gs.setValue(this.element, V.Z, z);
        this.z = z;
        if (this.parent && this.parent.invalidateOrder) this.parent.invalidateOrder();
      }
    }
    setScale(s) {
      if (s !== this.scale) {
        this.scale = s;
        this.updateRelativesFlag = true;
        this.gs.setValue(this.element, V.SCALE, F(s));
      }
    }
    getScale() { return this.scale; }
    getScaleX() { return this.asx * this.scale; }
    getScaleY() { return this.asy * this.scale; }
    setAlpha(a) {
      if (a !== this.alpha) {
        this.alpha = a;
        this.gs.setValue(this.element, V.ALPHA, F(a));
      }
    }
    setInputProcessor(p, transmit) {
      this.inputProcessor = p;
      if (transmit) for (const c of this.children) if (c instanceof SceneElementGO) c.setInputProcessor(p, transmit);
    }
    getDrawable() { return this.currentDrawable; }
    setState(s) {
      this.state = s;
      this.gs.setValue(this.element, V.STATE, s);
    }
    setVisible(v) {
      v = !!v;
      if (v !== this.visible) {
        this.visible = v;
        this.gs.setValue(this.element, V.VISIBLE, v);
      }
    }
    getOrientation() { return this.orientation; }
    setOrientation(o) {
      this.orientation = o;
      this.gs.setValue(this.element, V.ORIENTATION, o);
    }
    getChild(e) { return e.id !== null ? this.findActor(e.id) : null; }
    getFirstGOIn(x, y, touchable) { return this.hit(x, y, touchable); }
    setComparator(c) { this.comparator = c; }
    addEffects(list, event) {
      if (list && list.length) for (const e of list) this.gs.addEffect(e, event, this.element);
    }
    act(delta) {
      const gs = this.gs;
      if (this.reorder) {
        if (this.comparator) {
          const l = this.children.slice();
          l.sort(this.comparator); // Array.prototype.sort is stable, like Collections.sort
          this.children.length = 0;
          this.children.push(...l);
        }
        this.reorder = false;
      }
      for (const ev of this.eventGOList) ev.act(delta);
      gs.setUpdateListEnable(false);
      this.timeDisplayed += delta;
      gs.setValue(this.element, V.TIME_DISPLAYED, this.timeDisplayed | 0);
      gs.setUpdateListEnable(true);
      if (gs.checkForUpdates(this.element)) {
        gs.setUpdateListEnable(false);
        this.updateVars();
        this.setExtraVars();
        gs.setUpdateListEnable(true);
      }
      this.updateCurrentDrawable();
      if (this.updateRelativesFlag) {
        this.updateRelativesFlag = false;
        this.updateRelatives();
      }
      if (this.visible && this.element.definition) {
        gs.setValue(this.element.definition, V.SCENE_ELEMENT, this.element);
      }
      super.act(delta);
    }
    updateCurrentDrawable() {
      if (this.runtimeDrawable) {
        this.currentDrawable = this.runtimeDrawable.getDrawable(this.timeDisplayed, this.statesList, 0);
        if (this.currentDrawable) {
          if (this.currentDrawable.getWidth() !== this.w) this.setWidth(this.currentDrawable.getWidth());
          if (this.currentDrawable.getHeight() !== this.h) this.setHeight(this.currentDrawable.getHeight());
        }
      }
    }
    invalidateOrder() { this.reorder = true; }
    drawChildren(r, parentAlpha) {
      if (this.currentDrawable) {
        r.m = this.world;
        r.alpha = this.alpha * parentAlpha;
        this.currentDrawable.render(r);
      }
      super.drawChildren(r, parentAlpha);
    }
    hit(x, y, touchable) {
      const a = this.groupHit(x, y, touchable);
      if (a === this) return this.contains(x, y) ? this : null;
      return a;
    }
    contains(x, y) {
      return !!this.element.containsBounds || (!!this.currentDrawable && this.currentDrawable.contains(Math.trunc(x), Math.trunc(y)));
    }
    handle(event) {
      if (this.inputProcessor) this.inputProcessor.handle(event);
      let cancel = true;
      if (this.touchable) {
        const t = event.type;
        if (t === 'enter') { this.setMouseOver(true); cancel = false; }
        else if (t === 'exit') { this.setMouseOver(false); cancel = false; }
      }
      if (!event.cancelled) {
        const gev = this.getGUIEvent(event);
        let list = getEffects(this.element, gev);
        let size = list ? list.length : 0;
        this.addEffects(list, event);
        list = getEffects(this.element.definition, gev);
        size += list ? list.length : 0;
        if (size > 0 && cancel) event.cancel();
        this.addEffects(list, event);
      }
      return event.cancelled;
    }
    getGUIEvent(e) {
      switch (e.type) {
        case 'mouseMoved': return GEV.MOVED;
        case 'touchDown': return e.button === 0 ? GEV.LEFT_PRESSED : e.button === 2 ? GEV.RIGHT_PRESSED : GEV.MIDDLE_PRESSED;
        case 'touchUp': return e.button === 0 ? GEV.LEFT_RELEASED : e.button === 2 ? GEV.RIGHT_RELEASED : GEV.MIDDLE_RELEASED;
        case 'enter': return GEV.ENTERED;
        case 'exit': return GEV.EXITED;
      }
      return null;
    }
    setWidth(w) {
      this.updateRelativesFlag = true;
      this.w = w;
      this.ox = w * this.dispX;
      this.gs.setValue(this.element, V.WIDTH, Math.trunc(w));
    }
    setHeight(h) {
      this.updateRelativesFlag = true;
      this.h = h;
      this.oy = h * this.dispY;
      this.gs.setValue(this.element, V.HEIGHT, Math.trunc(h));
    }
    getWidth() { return this.w; }
    getHeight() { return this.h; }
    setMouseOver(b) { this.gs.setValue(this.element, V.MOUSE_OVER, !!b); }
    setScaleX(s) {
      this.updateRelativesFlag = true;
      this.asx = s;
      this.gs.setValue(this.element, V.SCALE_X, F(s));
    }
    setScaleY(s) {
      this.updateRelativesFlag = true;
      this.asy = s;
      this.gs.setValue(this.element, V.SCALE_Y, F(s));
    }
    free() {
      for (const a of this.children.slice()) if (a instanceof SceneElementGO) a.free();
      this.engine.sef.removeGO(this);
      for (const ev of this.eventGOList) if (ev.release) ev.release();
      this.children.length = 0;
      this.parent = null;
      this.currentDrawable = null;
      this.runtimeDrawable = null;
    }
    release() { this.remove(); }
  }

  class GroupElementGO extends SceneElementGO {
    setElement(element) {
      super.setElement(element);
      for (const se of element.sceneElements || []) this.addSceneElementModel(se);
    }
  }

  function zComparator(a, b) { return Math.sign((a.getZ() - b.getZ()) | 0); }

  class SceneGO extends GroupElementGO {
    constructor(engine) { super(engine); this.setComparator(zComparator); }
    setElement(element) {
      super.setElement(element);
      const bg = element.background;
      if (bg) {
        const bgGO = this.engine.sef.get(bg);
        this.addSceneElement(bgGO);
        bgGO.setZ((-2147483648 / 2) | 0);
      }
    }
    getReturnable() { return !!this.element.returnable; }
  }

  class GhostElementGO extends SceneElementGO {
    setElement(e) {
      super.setElement(e);
      this.catchAll = !!e.catchAll;
      this.ghostVisible = false;
    }
    drawChildren(r, pa) { if (this.ghostVisible) super.drawChildren(r, pa); }
    hit(x, y, touchable) {
      if (this.catchAll && touchable) return this;
      return super.hit(x, y, touchable);
    }
    contains(x, y) { return this.catchAll ? true : super.contains(x, y); }
  }

  class MouseHudGO extends SceneGO {
    setElement(e) {
      super.setElement(e);
      this.mouse = this.engine.sef.getById('#engine.cursor');
    }
    act(delta) {
      super.act(delta);
      this.mouse.setX(num(this.gs.getValue(null, SYS.MOUSE_X)));
      this.mouse.setY(num(this.gs.getValue(null, SYS.MOUSE_Y)));
    }
    // on a touch screen there is no pointer to show (the game's own HUD lives here too)
    draw(r, parentAlpha) {
      const m = this.mouse, v = m.visible;
      if (this.engine.touchMode) m.visible = false;
      try { super.draw(r, parentAlpha); } finally { m.visible = v; }
    }
  }

  // --------------------------------------------------------- transitions
  class TransitionGO extends SceneGO {
    setElement(e) {
      super.setElement(e);
      this.transition = e;
      this.previousScene = null; this.transitionListener = null; this.nextScene = null;
    }
    transition_(prev, next, l) {
      this.clearChildrenRaw();
      this.previousScene = prev; this.nextScene = next; this.transitionListener = l;
    }
    clearChildrenRaw() { this.children.length = 0; } // SnapshotArray.clear(): parents untouched
    handle(e) { e.cancel(); return true; }
    hit() { return this; }
    finish() {
      this.transitionListener.transitionEnded();
      this.nextScene = null; this.previousScene = null; this.transitionListener = null;
    }
  }
  class EmptyTransitionGO extends TransitionGO {
    act() { this.finish(); }
  }
  class FadeInTransitionGO extends TransitionGO {
    constructor(engine) { super(engine); this.currentTime = 0; }
    act(delta) {
      if (this.nextScene) {
        this.currentTime += delta;
        this.sceneAlpha = this.currentTime / this.transition.time;
        this.nextScene.setAlpha(Math.fround(this.sceneAlpha));
      }
      if (this.currentTime >= this.transition.time) {
        this.nextScene.setAlpha(1);
        this.finish();
      } else super.act(delta);
    }
    transition_(prev, next, l) {
      super.transition_(prev, next, l);
      this.currentTime = 0; this.sceneAlpha = 0;
      next.setAlpha(0);
      this.addSceneElement(prev);
      this.addSceneElement(next);
      prev.setZ(0);
      next.setZ(100);
    }
  }
  class ScaleTransitionGO extends TransitionGO {
    setElement(e) {
      super.setElement(e);
      this.growing = !!e.grow;
      this.tscale = this.growing ? 0 : 1;
    }
    transition_(prev, next, l) {
      super.transition_(prev, next, l);
      const t = this.transition;
      this.addActor(next);
      next.setZ(t.targetNext ? 100 : 50);
      prev.setZ(t.targetNext ? 50 : 100);
      const scaling = t.targetNext ? next : prev;
      this.oldX = scaling.getRelativeX(); this.oldY = scaling.getRelativeY();
      this.oldDispX = scaling.getDispX(); this.oldDispY = scaling.getDispY();
      const cx = scaling.getCenterX(), cy = scaling.getCenterY();
      scaling.setDispX(0.5); scaling.setDispY(0.5);
      scaling.setX(cx); scaling.setY(cy);
    }
    act(delta) {
      if (this.nextScene) {
        const t = this.transition;
        const step = Math.fround(delta / t.time);
        this.tscale = Math.fround(this.tscale + (this.growing ? 1 : -1) * step);
        if (t.targetNext) this.nextScene.setScale(this.tscale); else this.previousScene.setScale(this.tscale);
        if ((this.growing && this.tscale >= 1) || (!this.growing && this.tscale <= 0)) {
          this.previousScene.setScale(1);
          this.nextScene.setScale(1);
          const scaling = t.targetNext ? this.nextScene : this.previousScene;
          scaling.setDispX(this.oldDispX); scaling.setDispY(this.oldDispY);
          scaling.setX(this.oldX); scaling.setY(this.oldY);
          this.finish();
        }
        super.act(delta);
      }
    }
  }

  // ---------------------------------------------------------- video scene
  class VideoSceneGO extends SceneGO {
    setElement(e) {
      super.setElement(e);
      this.videoScene = e;
      this.video = getAsset(e.definition, this.currentBundle, 'video');
      this.started = false;
      this.done = false;
    }
    act(delta) {
      super.act(delta);
      if (this.done) return;
      if (!this.started) {
        this.started = true;
        this.engine.video.play(this.video, () => this.videoEnded());
      }
    }
    videoEnded() {
      if (this.done) return;
      this.done = true;
      const fe = this.videoScene.finalEffects || [];
      if (fe.length === 0) this.gs.addEffect(M.effect('ChangeSceneEf', { nextScene: null, transition: null }));
      else for (const e of fe) this.gs.addEffect(e);
    }
    free() { this.engine.video.stop(); super.free(); }
  }

  // ----------------------------------------------------- element factory
  const GO_CLASSES = {
    SceneElement: SceneElementGO, GhostElement: GhostElementGO, GroupElement: GroupElementGO,
    BasicScene: SceneGO, BottomHud: SceneGO, LoadingScreen: SceneGO, VideoScene: VideoSceneGO,
    MouseHud: MouseHudGO, EmptyTransition: EmptyTransitionGO, FadeInTransition: FadeInTransitionGO,
    ScaleTransition: ScaleTransitionGO,
  };
  class SceneElementGOFactory {
    constructor(engine) { this.engine = engine; this.cache = new Map(); }
    get(element) {
      if (!element) return null;
      const k = elKey(element);
      let go = this.cache.get(k);
      if (go) return go;
      const C = GO_CLASSES[element.$c];
      if (!C) { console.warn('No game object for', element.$c); return null; }
      go = new C(this.engine);
      go.setElement(element);
      this.cache.set(k, go);
      return go;
    }
    getById(id) {
      for (const go of this.cache.values()) if (go.element && go.element.id === id) return go;
      return null;
    }
    removeElement(element) { return this.cache.delete(elKey(element)); }
    removeGO(go) {
      const k = elKey(go.element);
      if (this.cache.get(k) === go) { this.cache.delete(k); go.release(); }
    }
    clean() {
      for (const go of Array.from(this.cache.values())) go.free();
      this.cache.clear();
    }
  }

  // --------------------------------------------------------------- GUI
  class GUI {
    constructor(engine) {
      this.engine = engine;
      this.gs = engine.gameState;
      this.previousSceneStack = [];
      this.scene = null;
    }
    initialize() { this.reset(); }
    makeLoadingScreen() {
      const s = M.scene(M.rect(800, 600, M.WHITE), '#engine.LoadingScreen', 'LoadingScreen');
      const bar = M.sceneElement(M.image('@drawable/loadingbar.png'));
      M.setPosition(bar, 0, 195, 1, 0);
      const op = { $c: 'MathOp', expression: '[0] * (800 / 100 )', operationsList: [M.field(null, SYS.LOADING)] };
      bar.events.push({ $c: 'WatchFieldEv', fields: [M.field(null, SYS.LOADING)],
        effects: new EMap([[jenum('WatchFieldEvType', 'WATCH'), [M.effect('ChangeFieldEf', { fields: [M.field(bar, V.X)], operation: op })]]]) });
      s.sceneElements.push(bar);
      s.sceneElements.push(M.sceneElement(M.image('@drawable/loading.png')));
      return s;
    }
    addHierarchy() {
      const sef = this.engine.sef;
      this.root = sef.get(M.group(null, '#engine.root'));
      this.root.setScale(1);
      this.hudRoot = sef.get(M.group(null, '#engine.huds'));
      this.sceneRoot = sef.get(M.group(null, '#engine.sceneContainer'));
      this.root.addSceneElement(this.sceneRoot);
      this.root.addSceneElement(this.hudRoot);
      // BottomHud
      const bottom = M.scene(null, '#engine.hud.bottomhud', 'BottomHud');
      const dis = M.ghost(true, '#engine_disable_clicks');
      M.setVar(dis, V.Z, 100);
      M.setVar(dis, V.VISIBLE, false);
      bottom.sceneElements.push(dis);
      this.hudRoot.addSceneElement(sef.get(bottom));
      this.hudRoot.addSceneElement(sef.get(M.sceneElement(null, '#engine.huds.effects')));
      this.hudRoot.addSceneElement(sef.get(M.sceneElement(null, '#engine.huds.debugger')));
      // MouseHud
      const mh = M.scene(null, '#predefined.hud.mouse', 'MouseHud');
      mh.background = null;
      const cursor = M.sceneElement(M.image('@drawable/default_cursor.png'), '#engine.cursor');
      M.setAppearance(cursor, 'default', M.image('@drawable/default_cursor.png'));
      M.setAppearance(cursor, 'take', M.image('@drawable/take_cursor.png'));
      M.setAppearance(cursor, 'examine', M.image('@drawable/examine_cursor.png'));
      M.setAppearance(cursor, 'talk', M.image('@drawable/talk_cursor.png'));
      M.setAppearance(cursor, 'exit', M.image('@drawable/exit.png'));
      M.setVar(cursor, V.ENABLE, false);
      M.setVar(cursor, V.Z, 10000);
      mh.sceneElements.push(cursor);
      this.hudRoot.addSceneElement(sef.get(mh));
    }
    getPreviousScene() { return this.previousSceneStack.length ? this.previousSceneStack.pop() : null; }
    addHud(h) { this.hudRoot.addSceneElement(h); }
    removeHUD(h) { h.remove(); }
    getHUD(id) { return this.hudRoot.findActor(id); }
    getScene() {
      if (!this.scene) {
        if (!this.loadingScreen) this.loadingScreen = this.makeLoadingScreen();
        this.scene = this.engine.sef.get(this.loadingScreen);
        this.previousSceneStack.push(this.loadingScreen);
      }
      return this.scene;
    }
    setScene(newScene) {
      const gs = this.gs;
      gs.clearEffects(false);
      const s = this.scene;
      if (s && s.element && s.getReturnable() &&
        (this.previousSceneStack.length === 0 || this.previousSceneStack[this.previousSceneStack.length - 1] !== s.element)) {
        this.previousSceneStack.push(s.element);
      }
      this.scene = newScene;
      gs.setValue(null, SYS.CURRENT_SCENE, newScene.element ? newScene.element.id : null);
      this.sceneRoot.children.length = 0; // getChildren().clear()
      this.sceneRoot.addSceneElement(newScene);
    }
    getSceneElement(e) { return this.engine.sef.get(e); }
    getGameObjectUnderPointer() {
      const a = this.root.hit(num(this.gs.getValue(null, SYS.MOUSE_X)), num(this.gs.getValue(null, SYS.MOUSE_Y)), true);
      return a instanceof SceneElementGO ? a : null;
    }
    reset() {
      this.previousSceneStack = [];
      this.scene = null;
      this.engine.sef.clean();
      this.addHierarchy();
    }
  }

  // --------------------------------------------------------------- stage
  // Port of the parts of scene2d's Stage used by the engine (desktop mode).
  class Stage {
    constructor(engine) {
      this.engine = engine;
      this.root = new Group();
      this.root.w = 0; this.root.h = 0;
      this.mouseX = 0; this.mouseY = 0;
      this.pointerTouched = false; this.pointerX = 0; this.pointerY = 0;
      this.pointerOver = null; this.mouseOver = null;
      this.touchFocuses = [];
    }
    hit(x, y, touchable) {
      const p = this.root.parentToLocal(x, y);
      return this.root.hit(p[0], p[1], touchable);
    }
    fire(target, event) {
      event.target = target;
      const ancestors = [];
      for (let p = target.parent; p; p = p.parent) ancestors.push(p);
      // capture phase: the engine registers no capture listeners
      this.notify(target, event);
      if (event.stopped) return event.cancelled;
      for (const a of ancestors) {
        this.notify(a, event);
        if (event.stopped) return event.cancelled;
      }
      return event.cancelled;
    }
    notify(actor, event) {
      if (!(actor instanceof SceneElementGO)) return event.cancelled;
      if (actor.handle(event)) {
        event.handled = true;
        if (event.type === 'touchDown') this.touchFocuses.push({ actor, target: event.target, button: event.button });
      }
      return event.cancelled;
    }
    touchDown(x, y, button) {
      this.pointerTouched = true; this.pointerX = x; this.pointerY = y;
      const ev = new InputEvent('touchDown', x, y, button);
      const target = this.hit(x, y, true) || this.root;
      this.fire(target, ev);
    }
    touchDragged(x, y) { this.pointerX = x; this.pointerY = y; }
    touchUp(x, y, button) {
      this.pointerTouched = false; this.pointerX = x; this.pointerY = y;
      const focuses = this.touchFocuses.filter((f) => f.button === button);
      this.touchFocuses = this.touchFocuses.filter((f) => f.button !== button);
      for (const f of focuses) {
        const ev = new InputEvent('touchUp', x, y, button);
        ev.target = f.target;
        if (f.actor.handle(ev)) ev.handled = true;
      }
    }
    mouseMoved(x, y) {
      this.mouseX = x; this.mouseY = y;
      const ev = new InputEvent('mouseMoved', x, y, 0);
      const target = this.hit(x, y, true) || this.root;
      this.fire(target, ev);
    }
    fireEnterAndExit(overLast, x, y) {
      const over = this.hit(x, y, true);
      if (over === overLast) return overLast;
      const ev = new InputEvent('exit', x, y, 0);
      if (overLast) { ev.type = 'exit'; ev.relatedActor = over; this.fire(overLast, ev); }
      if (over) {
        ev.type = 'enter'; ev.relatedActor = overLast;
        // the pooled event keeps its flags between both fires, as in libGDX
        this.fire(over, ev);
      }
      return over;
    }
    act(delta) {
      if (!this.pointerTouched) {
        if (this.pointerOver) {
          const last = this.pointerOver;
          this.pointerOver = null;
          const ev = new InputEvent('exit', this.pointerX, this.pointerY, 0);
          ev.relatedActor = last;
          this.fire(last, ev);
        }
      } else {
        this.pointerOver = this.fireEnterAndExit(this.pointerOver, this.pointerX, this.pointerY);
      }
      this.mouseOver = this.fireEnterAndExit(this.mouseOver, this.mouseX, this.mouseY);
      this.root.act(delta);
    }
    draw(r) {
      if (!this.root.visible) return;
      this.root.draw(r, 1);
    }
  }

  // ------------------------------------------------------------ events GO
  class AbstractEventGO {
    constructor(engine) { this.engine = engine; this.gs = engine.gameState; this.parent = null; }
    setElement(e) { this.element = e; }
    setParent(p) { this.parent = p; }
    initialize() {}
    runEffects(effects) { if (effects) for (const e of effects) this.gs.addEffect(e, null, this.parent); }
    act() {}
    release() {}
  }
  const INIT = V.INIT;
  const IN_TRANSITION_FIELD = { el: null, def: V.IN_TRANSITION };
  class SceneElementEvGO extends AbstractEventGO {
    setElement(ev) {
      super.setElement(ev);
      this.checks = 2;
      this.hasAlways = effectsForEvent(ev, 'ALWAYS') !== null;
      this.inTransition = true;
    }
    act() {
      if (this.inTransition) {
        this.inTransition = !!this.gs.getValue(IN_TRANSITION_FIELD.el, IN_TRANSITION_FIELD.def);
        if (this.inTransition) return;
      }
      if (this.checks >= 0) this.checks--;
      if (this.checks === 0) {
        const init = this.gs.getValue(this.element, INIT);
        if (!init) {
          this.runEffects(effectsForEvent(this.element, 'INIT'));
          this.gs.setValue(this.element, INIT, true);
        }
        this.runEffects(effectsForEvent(this.element, 'ADDED'));
      }
      if (this.hasAlways) this.runEffects(effectsForEvent(this.element, 'ALWAYS'));
    }
    release() { this.runEffects(effectsForEvent(this.element, 'REMOVED')); }
  }
  class ConditionEvGO extends AbstractEventGO {
    setElement(ev) { super.setElement(ev); this.triggered = false; this.firstCheck = true; }
    act() {
      if (this.gs.evaluate(this.element.condition)) {
        if (!this.triggered) this.runEffects(effectsForEvent(this.element, 'CONDITIONS_MET'));
        this.triggered = true;
      } else if (this.triggered || (this.firstCheck && this.element.runNotMetConditions)) {
        this.triggered = false;
        this.runEffects(effectsForEvent(this.element, 'CONDITIONS_UNMET'));
      }
      this.firstCheck = false;
    }
  }
  class TimedEvGO extends AbstractEventGO {
    initialize() { this.elapsedTime = 0; this.repeats = this.element.repeats; }
    act() {
      if (this.repeats !== 0) {
        if (this.elapsedTime === 0) this.runEffects(effectsForEvent(this.element, 'START_TIME'));
        this.elapsedTime += this.engine.skippedMilliseconds();
        if (this.elapsedTime > this.element.time) {
          this.runEffects(effectsForEvent(this.element, 'END_TIME'));
          this.elapsedTime = 0;
          this.repeats--;
        }
      }
    }
  }
  class WatchFieldEvGO extends AbstractEventGO {
    setElement(ev) {
      super.setElement(ev);
      this.updated = true;
      for (const f of ev.fields || []) this.gs.addFieldWatcher(this, f);
    }
    act() {
      if (this.updated) {
        this.updated = false;
        const l = effectsForEvent(this.element, 'WATCH');
        if (l) for (const e of l) this.gs.addEffect(e);
      }
    }
    fieldUpdated() { this.updated = true; }
    release() { this.gs.removeFieldWatcher(this); }
  }
  class BubbleNameGO extends AbstractEventGO {
    setElement(element) {
      super.setElement(element);
      const sef = this.engine.sef, assets = this.engine.assets;
      this.scaleV = 0; this.growing = false; this.current = null;
      this.currentDescription = M.field(element, V.BUBBLE_NAME);
      const e = M.sceneElement(null, '#engine.huds.namesbubble');
      M.setVar(e, V.Z, 500);
      const hud = sef.get(e);
      this.engine.gui.addHud(hud);
      const c = {
        $c: 'Caption', label: { $c: 'EAdString', stringId: '#txt#[0]' }, font: element.font, textPaint: element.textPaint,
        hasBubble: false, bubblePaint: null, preferredWidth: -1, preferredHeight: -1, padding: element.bubble.left,
        operations: [this.currentDescription], alignment: jenum('Alignment', 'CENTER'),
      };
      const drawable = { $c: 'ComposedDrawable', assetList: [element.bubble, c],
        positions: [{ x: 0, y: 0, dispX: 0, dispY: 0 }, { x: 0, y: 0, dispX: 0, dispY: 0 }] };
      const b = M.sceneElement(drawable);
      M.setPosition(b, 0, 0, 0.5, 1);
      M.setVar(b, V.ENABLE, false);
      M.setVar(b, V.VISIBLE, false);
      M.setVar(b, V.SCALE, F(0));
      this.caption = assets.get(c);
      this.ninePatch = assets.get(element.bubble);
      this.bubble = sef.get(b);
      hud.addSceneElement(this.bubble);
    }
    act(delta) {
      const gs = this.gs, gui = this.engine.gui;
      const s = gui.getGameObjectUnderPointer();
      if (s !== this.current) {
        this.current = s;
        if (this.current) {
          const name = gs.getValue(this.current.element, V.BUBBLE_NAME);
          gs.setValue(this.currentDescription.element, this.currentDescription.varDef, name);
          if (name !== null && name !== undefined) {
            this.bubble.act(delta);
            this.bubble.setVisible(true);
            let centerX = this.current.getCenterX();
            let top = this.current.getTop();
            if (centerX - this.bubble.getWidth() / 2 < 0) centerX += this.bubble.getWidth() / 2 - centerX;
            if (top < this.bubble.getHeight()) top = this.bubble.getHeight();
            this.bubble.setX(centerX);
            this.bubble.setY(top);
            this.scaleV = 0;
            this.growing = true;
          } else {
            this.bubble.setVisible(false);
            this.scaleV = 0;
          }
        } else {
          this.bubble.setVisible(false);
          this.scaleV = 0;
        }
      }
      if (this.growing) {
        this.scaleV = Math.fround(this.scaleV + delta / 100);
        if (this.scaleV >= 1) { this.scaleV = 1; this.growing = false; }
      }
      this.bubble.setScale(this.scaleV);
      this.ninePatch.width = this.caption.getWidth();
      this.ninePatch.height = this.caption.getHeight();
    }
  }
  const EVENT_CLASSES = {
    SceneElementEv: SceneElementEvGO, ConditionedEv: ConditionEvGO, TimedEv: TimedEvGO,
    WatchFieldEv: WatchFieldEvGO, BubbleNameEv: BubbleNameGO,
  };
  function createEventGO(engine, ev) {
    const C = EVENT_CLASSES[ev.$c];
    if (!C) { console.warn('No event GO for', ev.$c); return null; }
    const go = new C(engine);
    go.setElement(ev);
    return go;
  }

  Object.assign(EAD, {
    M, GEV, getAsset, getEffects, effectsForEvent, InputEvent, Group, SceneElementGO, GroupElementGO, SceneGO,
    GhostElementGO, MouseHudGO, TransitionGO, VideoSceneGO, SceneElementGOFactory, GUI, Stage, createEventGO,
  });
})();
