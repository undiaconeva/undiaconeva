/*
 * eAdventure 2 runtime for the web — core: Java-like values, model loading,
 * game state (value map), operators, conditions and strings.
 *
 * Reimplementation of the 2013 eAdventure 2.0 engine (e-UCM, LGPL) used by
 * "Un día con Eva". Behaviour follows the original Java sources closely.
 */
(function () {
  'use strict';
  const EAD = (window.EAD = window.EAD || {});

  // ---------------------------------------------------------------- values
  class JFloat {
    constructor(v) { this.v = Math.fround(v); }
    toString() { return javaFloatString(this.v); }
  }
  class JDouble {
    constructor(v) { this.v = v; }
    toString() { return javaFloatString(this.v, true); }
  }
  class JLong {
    constructor(v) { this.v = Math.trunc(v); }
    toString() { return String(this.v); }
  }
  class JEnum {
    constructor(cls, name) { this.cls = cls; this.name = name; }
    toString() { return this.name; }
  }
  const enumCache = new Map();
  function jenum(cls, name) {
    const k = cls + '.' + name;
    let e = enumCache.get(k);
    if (!e) { e = new JEnum(cls, name); enumCache.set(k, e); }
    return e;
  }
  function jfloat(v) { return new JFloat(v); }
  function num(v) {
    if (typeof v === 'number') return v;
    if (v instanceof JFloat || v instanceof JDouble || v instanceof JLong) return v.v;
    return NaN;
  }
  function isNum(v) {
    return typeof v === 'number' || v instanceof JFloat || v instanceof JDouble || v instanceof JLong;
  }
  function enumName(v) { return v instanceof JEnum ? v.name : v; }

  function javaFloatString(f, dbl) {
    if (Number.isNaN(f)) return 'NaN';
    if (!isFinite(f)) return f > 0 ? 'Infinity' : '-Infinity';
    if (f === 0) return Object.is(f, -0) ? '-0.0' : '0.0';
    let s = null;
    for (let p = 1; p <= 17; p++) {
      const c = f.toPrecision(p);
      const back = parseFloat(c);
      if (dbl ? back === f : Math.fround(back) === f) { s = c; break; }
    }
    const x = parseFloat(s);
    const a = Math.abs(x);
    if (a >= 1e-3 && a < 1e7) {
      let str = String(x);
      if (str.indexOf('e') >= 0) str = x.toFixed(12).replace(/0+$/, '');
      if (str.indexOf('.') < 0) str += '.0';
      return str;
    }
    let [m, e] = x.toExponential().split('e');
    if (m.indexOf('.') < 0) m += '.0';
    return m + 'E' + parseInt(e, 10);
  }

  function jstr(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return String(Math.trunc(v));
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (v.toString !== Object.prototype.toString) return v.toString();
    if (v.$c === 'EAdString') return v.stringId;
    if (v.id !== undefined) return String(v.id);
    return '[' + (v.$c || 'object') + ']';
  }

  // ------------------------------------------------------------- java maps
  function javaEquals(a, b) {
    if (a === b) return true;
    if (a === null || b === null || a === undefined || b === undefined) return false;
    if (typeof a !== 'object' || typeof b !== 'object') return a === b;
    if (a instanceof JFloat || a instanceof JDouble || a instanceof JLong) {
      return a.constructor === b.constructor && a.v === b.v;
    }
    if (a instanceof JEnum) return false; // interned
    if (a.$c === 'VarDef' && b.$c === 'VarDef') return a.name === b.name;
    if (a.$c === 'EAdString' && b.$c === 'EAdString') return a.stringId === b.stringId;
    if (a.$c === 'MouseGEv' && b.$c === 'MouseGEv') {
      return enumName(a.type) === enumName(b.type) && enumName(a.button) === enumName(b.button);
    }
    if (typeof a.id === 'string' && typeof b.id === 'string') return a.id === b.id;
    return false;
  }

  class EMap {
    constructor(entries) { this.entries = entries || []; }
    get(k) {
      for (const e of this.entries) if (javaEquals(e[0], k)) return e[1];
      return undefined;
    }
    has(k) { return this.entries.some((e) => javaEquals(e[0], k)); }
    set(k, v) {
      for (const e of this.entries) if (javaEquals(e[0], k)) { e[1] = v; return; }
      this.entries.push([k, v]);
    }
    keys() { return this.entries.map((e) => e[0]); }
    values() { return this.entries.map((e) => e[1]); }
    get size() { return this.entries.length; }
  }

  // ---------------------------------------------------------- model loader
  function loadModel(json) {
    const byId = new Map();
    function conv(o) {
      if (o === null || typeof o !== 'object') return o;
      if (Array.isArray(o)) {
        for (let i = 0; i < o.length; i++) o[i] = conv(o[i]);
        return o;
      }
      if ('$F' in o) return new JFloat(o.$F);
      if ('$D' in o) return new JDouble(o.$D);
      if ('$L' in o) return new JLong(o.$L);
      if ('$E' in o) return jenum(o.$E, o.v);
      if ('$ref' in o) return o;
      if ('$map' in o) return new EMap(o.$map.map((p) => [conv(p[0]), conv(p[1])]));
      if ('$id' in o) byId.set(o.$id, o);
      for (const k in o) if (k !== '$c' && k !== '$id') o[k] = conv(o[k]);
      return o;
    }
    const root = conv(json);
    const visited = new Set();
    function fix(v) {
      if (v && typeof v === 'object' && '$ref' in v && Object.keys(v).length === 1) return byId.get(v.$ref);
      return v;
    }
    function res(o) {
      if (o === null || typeof o !== 'object' || visited.has(o)) return;
      if (o instanceof JFloat || o instanceof JDouble || o instanceof JLong || o instanceof JEnum) return;
      visited.add(o);
      if (o instanceof EMap) {
        for (const e of o.entries) { e[0] = fix(e[0]); e[1] = fix(e[1]); res(e[0]); res(e[1]); }
        return;
      }
      if (Array.isArray(o)) {
        for (let i = 0; i < o.length; i++) { o[i] = fix(o[i]); res(o[i]); }
        return;
      }
      for (const k in o) {
        if (k === '$c' || k === '$id') continue;
        o[k] = fix(o[k]);
        res(o[k]);
      }
    }
    res(root);
    return root;
  }

  // ------------------------------------------------------------ type checks
  const NUMERIC = { 'java.lang.Integer': 1, 'java.lang.Short': 1, 'java.lang.Byte': 1 };
  function isAssignable(type, v) {
    if (v === null || v === undefined) return true;
    if (!type) return true;
    switch (type) {
      case 'java.lang.Object': return true;
      case 'java.lang.Number': return isNum(v);
      case 'java.lang.Float': return v instanceof JFloat;
      case 'java.lang.Double': return v instanceof JDouble;
      case 'java.lang.Long': return v instanceof JLong;
      case 'java.lang.Boolean': return typeof v === 'boolean';
      case 'java.lang.String': return typeof v === 'string';
      case 'java.lang.Integer': case 'java.lang.Short': case 'java.lang.Byte': return typeof v === 'number';
    }
    if (NUMERIC[type]) return typeof v === 'number';
    if (typeof v !== 'object') return false;
    if (v instanceof JFloat || v instanceof JDouble || v instanceof JLong) return false;
    const simple = type.substring(type.lastIndexOf('.') + 1);
    if (v instanceof JEnum) return v.cls === simple;
    if (v.$c) {
      if (v.$c === simple) return true;
      if (simple === 'EAdString') return v.$c === 'EAdString';
      if (simple === 'Rectangle') return v.$c === 'Rectangle';
      if (simple === 'Side') return v.$c === 'Side';
      return true; // interfaces of the model (EAdSceneElement, EAdScene, ...)
    }
    if (v.__javaClass) return v.__javaClass === simple;
    return true;
  }

  // -------------------------------------------------------------- strings
  class StringHandler {
    constructor(data) {
      this.def = data[''] || {};
      this.langs = data;
      this.lang = '';
    }
    setLanguage(l) { this.lang = l; }
    getString(s) {
      if (!s) return '';
      const id = typeof s === 'string' ? s : s.stringId;
      if (id && id.indexOf('#txt#') === 0) return id.substring(5);
      const L = this.langs[this.lang];
      let v = L ? L[id] : undefined;
      if (v === undefined) v = this.def[id];
      return v === undefined ? String(id) : v;
    }
  }

  // --------------------------------------------------------- math parser
  const OPS = [
    ['+', 2, 0], ['-', 2, 0], ['*', 2, 10], ['/', 2, 10], ['^', 2, 10], ['%', 2, 10], ['&', 2, 0], ['|', 2, 0],
    ['cos', 1, 20], ['sin', 1, 20], ['tan', 1, 20], ['acos', 1, 20], ['asin', 1, 20], ['atan', 1, 20],
    ['sqrt', 1, 20], ['sqr', 1, 20], ['log', 1, 20], ['min', 2, 0], ['max', 2, 0], ['exp', 1, 20],
    ['floor', 1, 20], ['ceil', 1, 20], ['abs', 1, 20], ['neg', 1, 20], ['rnd', 1, 20], ['deg', 1, 20],
  ].map(([op, type, priority]) => ({ op, type, priority }));
  const f32 = Math.fround;

  function evalOp(op, a, b) {
    switch (op) {
      case '+': return f32(a + b);
      case '-': return f32(a - b);
      case '*': return f32(a * b);
      case '/': return f32(a / b);
      case '^': return f32(Math.pow(a, b));
      case '%': return f32(a % b);
      case '&': case '|': return f32(a + b);
      case 'cos': return f32(Math.cos(a));
      case 'sin': return f32(Math.sin(a));
      case 'tan': return f32(Math.tan(a));
      case 'acos': return f32(Math.acos(a));
      case 'asin': return f32(Math.asin(a));
      case 'atan': return f32(Math.atan(a));
      case 'sqr': return f32(a * a);
      case 'sqrt': return f32(Math.sqrt(a));
      case 'log': return f32(Math.log(a));
      case 'min': return Math.min(a, b);
      case 'max': return Math.max(a, b);
      case 'exp': return f32(Math.exp(a));
      case 'floor': return f32(Math.floor(a));
      case 'ceil': return f32(Math.ceil(a));
      case 'abs': return Math.abs(a);
      case 'neg': return -a;
      case 'rnd': return f32(Math.random() * a);
      case 'deg': return f32(a * 180 / Math.PI);
    }
    return 0;
  }

  function nextWord(s) {
    for (let i = 1; i < s.length; i++) {
      const c = s.charCodeAt(i);
      const lower = c >= 97 && c <= 122;
      const digit = c >= 48 && c <= 57;
      if (!lower && !digit) return s.substring(0, i);
    }
    return s;
  }
  function getOperator(s, start) {
    const w = nextWord(s.substring(start));
    for (const o of OPS) if (w.startsWith(o.op)) return o;
    return null;
  }
  function checkBrackets(s) {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '(' && n >= 0) n++;
      else if (s[i] === ')') n--;
    }
    return n;
  }
  function removeBrackets(s) {
    let r = s;
    if (s.length > 2 && r.startsWith('(') && r.endsWith(')') && checkBrackets(s.substring(1, s.length - 1)) === 0) {
      r = r.substring(1, r.length - 1);
    }
    return r !== s ? removeBrackets(r) : r;
  }
  function addZero(s) {
    if (s.startsWith('+') || s.startsWith('-')) {
      for (let i = 0; i < s.length; i++) if (getOperator(s, i)) return '0' + s;
    }
    return s;
  }

  function mathEvaluate(expr, ops, resolveVar) {
    function getFloat(s) {
      if (s === null) return 0;
      if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?[fFdD]?$/.test(s)) return f32(parseFloat(s));
      try {
        const id = s.replace(/\[/g, '').replace(/\]/g, '');
        if (!/^[+-]?\d+$/.test(id)) return 0;
        return resolveVar(ops[parseInt(id, 10)]);
      } catch (e) { return 0; }
    }
    function node(s) {
      s = s.replace(/ /g, '');
      s = removeBrackets(s);
      s = addZero(s);
      if (checkBrackets(s) !== 0) throw new Error('brackets');
      const n = { s, op: null, left: null, right: null, value: getFloat(s) };
      let inB = 0, start = 0;
      for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '(') inB++;
        else if (c === ')') inB--;
        else if (inB === 0) {
          const o = getOperator(s, i);
          if (o && (n.op === null || n.op.priority >= o.priority)) {
            n.op = o; start = i; i += o.op.length - 1;
          }
        }
      }
      if (n.op) {
        if (start === 0 && n.op.type === 1) {
          if (checkBrackets(s.substring(n.op.op.length)) === 0) {
            n.left = node(s.substring(n.op.op.length));
          } else throw new Error('brackets');
        } else if (start > 0 && n.op.type === 2) {
          n.left = node(s.substring(0, start));
          n.right = node(s.substring(start + n.op.op.length));
        }
      }
      return n;
    }
    function ev(n) {
      if (n.op && (n.left || n.right)) {
        if (n.op.type === 1) n.value = evalOp(n.op.op, ev(n.left), 0);
        else if (n.op.type === 2) n.value = evalOp(n.op.op, ev(n.left), ev(n.right));
      }
      return n.value;
    }
    if (expr === null || expr === undefined) return 0;
    try { return ev(node(String(expr))); } catch (e) { return 0; }
  }

  // ------------------------------------------------------------ value map
  let objKeyCounter = 0;
  function elKey(el) {
    if (el === null || el === undefined) return '\u0000null';
    if (typeof el === 'string') return 's:' + el;
    if (typeof el === 'object') {
      if (typeof el.id === 'string') return 'id:' + el.id;
      if (!el.__k) Object.defineProperty(el, '__k', { value: 'o:' + (++objKeyCounter), enumerable: false });
      return el.__k;
    }
    return 'v:' + String(el);
  }

  class ValueMap {
    constructor(strings) {
      this.strings = strings;
      this.values = new Map();
      this.updateList = new Set();
      this.updateEnable = true;
    }
    decode(el) {
      if (el && typeof el === 'object' && el.$c === 'BasicField') {
        return this.decode(this.getValue(el.element, el.varDef));
      }
      return el;
    }
    mapFor(el) {
      const k = elKey(el);
      let m = this.values.get(k);
      if (!m) {
        m = new Map();
        this.values.set(k, m);
        if (el && typeof el === 'object' && el.vars instanceof EMap) {
          for (const [def, val] of el.vars.entries) m.set(def.name, val);
        }
      }
      return m;
    }
    setValue(el, varDef, value) {
      if (value !== null && value !== undefined && !isAssignable(varDef.type, value)) {
        if (EAD.debug) console.warn('setValue rejected', varDef.name, varDef.type, value);
        return;
      }
      el = this.decode(el);
      const m = this.mapFor(el);
      m.set(varDef.name, value === undefined ? null : value);
      if (this.updateEnable) this.updateList.add(elKey(el));
      this.notify(el, varDef);
    }
    notify() {}
    getValue(el, varDef) {
      el = this.decode(el);
      const m = this.mapFor(el);
      const v = m.get(varDef.name);
      if (v === null || v === undefined) return varDef.initialValue === undefined ? null : varDef.initialValue;
      return v;
    }
    getField(field) { return this.getValue(field.element, field.varDef); }
    setField(field, value) { this.setValue(field.element, field.varDef, value); }
    contains(el) { return this.values.has(elKey(el)); }
    checkForUpdates(el) {
      const k = elKey(el);
      if (this.updateList.has(k)) { this.updateList.delete(k); return true; }
      return false;
    }
    setUpdateListEnable(b) { this.updateEnable = b; }
    remove(el) { this.values.delete(elKey(this.decode(el))); }
  }

  // ------------------------------------------------------------- vardefs
  function VarDef(name, type, initialValue) {
    return { $c: 'VarDef', name, type, initialValue: initialValue === undefined ? null : initialValue };
  }
  const T = {
    F: 'java.lang.Float', I: 'java.lang.Integer', B: 'java.lang.Boolean', S: 'java.lang.String',
    L: 'java.lang.Long', O: 'java.lang.Object',
  };
  const V = {
    ORIENTATION: VarDef('orientation', 'ead.common.interfaces.features.enums.Orientation', jenum('Orientation', 'S')),
    STATE: VarDef('state', T.S, 'default'),
    BUNDLE_ID: VarDef('bundleId', T.S, 'initialBundle'),
    SCALE: VarDef('scale', T.F, jfloat(1)),
    SCALE_X: VarDef('scale_x', T.F, jfloat(1)),
    SCALE_Y: VarDef('scale_y', T.F, jfloat(1)),
    ALPHA: VarDef('alpha', T.F, jfloat(1)),
    ROTATION: VarDef('rotation', T.F, jfloat(0)),
    VISIBLE: VarDef('visible', T.B, true),
    ENABLE: VarDef('enable', T.B, true),
    X: VarDef('x', T.F, jfloat(0)),
    Y: VarDef('y', T.F, jfloat(0)),
    LEFT: VarDef('left', T.F, jfloat(0)),
    TOP: VarDef('top', T.F, jfloat(0)),
    RIGHT: VarDef('right', T.F, jfloat(0)),
    BOTTOM: VarDef('bottom', T.F, jfloat(0)),
    CENTER_X: VarDef('center_x', T.F, jfloat(0)),
    CENTER_Y: VarDef('center_y', T.F, jfloat(0)),
    Z: VarDef('z', T.I, 0),
    DISP_X: VarDef('disp_x', T.F, jfloat(0)),
    DISP_Y: VarDef('disp_y', T.F, jfloat(0)),
    WIDTH: VarDef('width', T.I, 0),
    HEIGHT: VarDef('height', T.I, 0),
    TIME_DISPLAYED: VarDef('timeDisplayed', T.I, 0),
    MOUSE_OVER: VarDef('mouse_over', T.B, false),
    SCENE_ELEMENT: VarDef('scene_element', 'ead.common.model.elements.scenes.EAdSceneElement', null),
    // scenes / trajectories
    TRAJECTORY_DEFINITION: VarDef('trajectory_generator', 'ead.common.model.elements.trajectories.EAdTrajectory', null),
    BARRIER_ON: VarDef('barrierOn', T.B, false),
    INFLUENCE_AREA: VarDef('influence_area', 'ead.common.model.params.util.Rectangle', null),
    CURRENT_SIDE: VarDef('currentSide', 'ead.common.model.elements.trajectories.Side', null),
    ELEMENT_MOVING: VarDef('element_moving', 'MoveSceneElementGO', null),
    BUBBLE_NAME: VarDef('hud_bubble_name', 'ead.common.model.params.text.EAdString', null),
    INIT: VarDef('init', T.B, false),
    IN_TRANSITION: VarDef('in_transition', T.B, false),
  };
  const SYS = {
    MOUSE_X: VarDef('mouse_x', T.F, jfloat(0)),
    MOUSE_Y: VarDef('mouse_y', T.F, jfloat(0)),
    MOUSE_SCENE_X: VarDef('mouse_scene_x', T.F, jfloat(0)),
    MOUSE_SCENE_Y: VarDef('mouse_scene_y', T.F, jfloat(0)),
    GAME_WIDTH: VarDef('width', T.I, 800),
    GAME_HEIGHT: VarDef('height', T.I, 600),
    LOADING: VarDef('loading', T.I, 0),
    ELAPSED_TIME_PER_UPDATE: VarDef('elapsed_time_per_update', T.I, 0),
    GAME_TIME: VarDef('game_time', T.L, new JLong(0)),
    LANGUAGE: VarDef('language', T.S, ''),
    CURRENT_SCENE: VarDef('current_scene', T.S, null),
    SOUND_ON: VarDef('sound_on', T.B, true),
    SECONDS_PLAYING: VarDef('seconds_playing', T.I, 0),
  };

  // ---------------------------------------------------------- game state
  class GameState extends ValueMap {
    constructor(strings) {
      super(strings);
      this.effects = [];
      this.paused = false;
      this.watchers = new Map();
      this.tweens = null; // set by engine
      this.engine = null;
    }
    notify(el, varDef) {
      const m = this.watchers.get(elKey(el));
      if (!m) return;
      const list = m.get(varDef.name);
      if (list) for (const w of list.slice()) w.fieldUpdated();
    }
    addFieldWatcher(w, field) {
      const k = elKey(field.element);
      let m = this.watchers.get(k);
      if (!m) { m = new Map(); this.watchers.set(k, m); }
      let l = m.get(field.varDef.name);
      if (!l) { l = []; m.set(field.varDef.name, l); }
      l.push(w);
    }
    removeFieldWatcher(w) {
      for (const m of this.watchers.values()) for (const l of m.values()) {
        const i = l.indexOf(w);
        if (i >= 0) l.splice(i, 1);
      }
    }
    // --- operations
    evaluate(cond) {
      if (!cond) return true;
      return evaluateCondition(this, cond);
    }
    operate(type, op) { return operate(this, type, op); }
    setValueOp(el, varDef, op) {
      this.setValue(el, varDef, operate(this, varDef.type, op));
    }
    // --- effects
    addEffect(e, action, parent) {
      if (!e) return null;
      if (this.evaluate(e.condition)) {
        const go = this.engine.createEffectGO(e);
        if (!go) { if (EAD.debug) console.warn('No GO for effect', e.$c); return null; }
        go.action = action || null;
        go.parent = parent || null;
        go.initialize();
        if (go.isQueueable() && !go.isFinished()) {
          this.effects.push(go);
        } else {
          go.finish();
          if (go.release) go.release();
        }
        return go;
      } else if (e.nextEffectsAlways) {
        for (const ne of e.nextEffects || []) this.addEffect(ne);
      }
      return null;
    }
    clearEffects(clearPersistents) {
      for (const go of this.effects) {
        if (!go.effect.persistent || clearPersistents) go.stop();
      }
    }
    update(delta) {
      if (this.paused) return;
      this.tweens.update(delta);
      const finished = [];
      let block = false;
      let i = 0;
      while (i < this.effects.length) {
        const go = this.effects[i];
        i++;
        if (block) continue;
        if (go.isStopped() || go.isFinished()) {
          finished.push(go);
          if (go.isFinished()) go.finish();
        } else {
          if (go.isBlocking()) block = true;
          go.act(delta);
        }
      }
      for (const go of finished) {
        const k = this.effects.indexOf(go);
        if (k >= 0) this.effects.splice(k, 1);
        if (go.release) go.release();
      }
    }
    // --- text
    processTextVars(text, ops) {
      text = this.processConditional(text, ops);
      return this.processVars(text, ops);
    }
    processVars(text, ops) {
      for (;;) {
        const i = text.indexOf('[');
        if (i === -1) break;
        const j = text.indexOf(']', i + 1);
        if (j === -1) break; // original loops forever here; we stop
        const name = text.substring(i + 1, j);
        const idx = parseInt(name, 10);
        let o = ops && !isNaN(idx) ? this.operate(T.O, ops[idx]) : null;
        if (o === null || o === undefined) o = '';
        const value = o && o.$c === 'EAdString' ? this.strings.getString(o) : jstr(o);
        text = text.substring(0, i) + value + text.substring(j + 1);
      }
      return text;
    }
    processConditional(text, ops) {
      if (text === null || text === undefined) return '';
      let out = '';
      let i = 0;
      while (i < text.length) {
        const b = text.indexOf('(', i);
        const e = b === -1 ? -1 : text.indexOf(')', b);
        if (b !== -1 && e !== -1 && e > b) {
          out += text.substring(i, b) + this.evalExpression(text.substring(b + 1, e), ops);
          i = e + 1;
        } else {
          out += text.substring(i);
          break;
        }
      }
      return out;
    }
    evalExpression(expr, ops) {
      if (expr.indexOf('?') >= 0 && expr.indexOf(':') >= 0) {
        const q = expr.indexOf('?');
        const p = expr.indexOf(':');
        const cond = expr.substring(0, q);
        const t = expr.substring(q + 1, p);
        const f = expr.substring(p + 1);
        const bv = cond.indexOf('[');
        const ev = cond.indexOf(']');
        if (bv !== -1 && ev !== -1 && ev > bv) {
          const name = expr.substring(bv + 1, ev);
          const idx = parseInt(name, 10);
          if (isNaN(idx)) return '(' + expr + ')';
          const o = this.operate(T.O, ops[idx]);
          if (typeof o === 'boolean') return o ? t : f;
          if (isNum(o)) return num(o) !== 0 ? t : f;
          return f;
        }
      }
      return '(' + expr + ')';
    }
    reset() {
      this.effects = [];
      if (this.tweens) this.tweens.killAll();
      this.paused = false;
      this.watchers.clear();
      this.values.clear();
      this.updateList.clear();
    }
  }

  // ------------------------------------------------------------ operators
  function operate(gs, type, op) {
    if (op === null || op === undefined) return null;
    switch (op.$c) {
      case 'BasicField':
        return gs.getValue(op.element, op.varDef);
      case 'ValueOp': {
        const v = op.value;
        if (v === null || v === undefined) return null;
        return isAssignable(type, v) ? v : null;
      }
      case 'MathOp': {
        const r = mathEvaluate(op.expression, op.operationsList || [], (o) => {
          const v = operate(gs, 'java.lang.Number', o);
          return isNum(v) ? Math.fround(num(v)) : 0;
        });
        if (type === T.I || op.resultAsInteger) return Math.trunc(r) | 0;
        return new JFloat(r);
      }
      case 'StringOp': {
        const v = gs.decode(op.string);
        if (v && v.$c === 'EAdString') return gs.strings.getString(v);
        return '' + jstr(v);
      }
      case 'ConditionedOp':
        return gs.evaluate(op.condition) ? operate(gs, type, op.opTrue) : operate(gs, type, op.opFalse);
      case 'ConcatenateStringsOp': {
        const list = op.operations || op.operationsList || [];
        if (!list.length) return null;
        let s = '';
        for (const o of list) s += (op.prefix || '') + jstr(operate(gs, T.O, o)) + (op.sufix || '');
        return s;
      }
      default:
        if (isCondition(op)) return evaluateCondition(gs, op);
        if (EAD.debug) console.warn('Unknown operation', op.$c);
        return null;
    }
  }
  function isCondition(c) {
    return c && (c.$c === 'EmptyCond' || c.$c === 'OperationCond' || c.$c === 'ANDCond' || c.$c === 'ORCond' ||
      c.$c === 'NOTCond' || c.$c === 'ListedCond');
  }
  function compareValues(a, b) {
    if (typeof a === 'boolean') return (a === b) ? 0 : (a ? 1 : -1);
    if (typeof a === 'string') return a < b ? -1 : (a > b ? 1 : 0);
    return 0;
  }
  function evaluateCondition(gs, c) {
    if (!c) return true;
    switch (c.$c) {
      case 'EmptyCond': return !!c.value;
      case 'NOTCond': return !evaluateCondition(gs, c.condition);
      case 'ANDCond': case 'ORCond': case 'ListedCond': {
        const and = enumName(c.operator) !== 'OR' && c.$c !== 'ORCond';
        let temp = and;
        for (const sub of c.conditions || []) {
          const r = evaluateCondition(gs, sub);
          temp = and ? temp && r : temp || r;
        }
        return temp;
      }
      case 'OperationCond': {
        let a = operate(gs, T.O, c.op1);
        let b = operate(gs, T.O, c.op2);
        if (a === null || a === undefined || b === null || b === undefined) return false;
        if (isNum(a)) a = new JFloat(num(a));
        if (isNum(b)) b = new JFloat(num(b));
        const cmp = enumName(c.operator);
        const sameNum = a instanceof JFloat && b instanceof JFloat;
        const comparable = sameNum || (typeof a === 'string' && typeof b === 'string') ||
          (typeof a === 'boolean' && typeof b === 'boolean') || (a instanceof JEnum && b instanceof JEnum && a.cls === b.cls);
        if (comparable) {
          let r;
          if (sameNum) r = a.v < b.v ? -1 : (a.v > b.v ? 1 : 0);
          else if (a instanceof JEnum) r = a === b ? 0 : 1;
          else r = compareValues(a, b);
          switch (cmp) {
            case 'EQUAL': return r === 0;
            case 'GREATER': return r > 0;
            case 'GREATER_EQUAL': return r >= 0;
            case 'LESS_EQUAL': return r <= 0;
            case 'LESS': return r < 0;
            case 'DIFFERENT': return r !== 0;
          }
          return false;
        }
        const eq = javaEquals(a, b);
        switch (cmp) {
          case 'EQUAL': case 'GREATER_EQUAL': case 'LESS_EQUAL': return eq;
          case 'DIFFERENT': return !eq;
        }
        return false;
      }
    }
    if (EAD.debug) console.warn('Unknown condition', c.$c);
    return false;
  }

  Object.assign(EAD, {
    JFloat, JDouble, JLong, JEnum, jenum, jfloat, num, isNum, enumName, jstr, javaFloatString,
    EMap, javaEquals, loadModel, isAssignable, StringHandler, mathEvaluate, elKey, ValueMap,
    GameState, VarDef, V, SYS, T, operate, evaluateCondition,
  });
})();
