/*
 * eAdventure 2 runtime for the web — effects, tweens and trajectories.
 */
(function () {
  'use strict';
  const EAD = window.EAD;
  const { V, SYS, T, num, jfloat, jenum, enumName, M, getAsset, effectsForEvent } = EAD;
  const F = (v) => jfloat(v);
  const f32 = Math.fround;

  // ------------------------------------------------- Universal Tween Engine
  // Port of aurelienribon's BaseTween/Tween (6.x) for single-value tweens.
  const CB = { BEGIN: 1, START: 2, END: 4, COMPLETE: 8, BACK_BEGIN: 16, BACK_START: 32, BACK_END: 64, BACK_COMPLETE: 128 };
  const EQ = {
    LINEAR: (t) => t,
    CUBIC_OUT: (t) => { t -= 1; return t * t * t + 1; },
    BOUNCE_OUT: (t) => {
      if (t < (1 / 2.75)) return 7.5625 * t * t;
      if (t < (2 / 2.75)) { t -= (1.5 / 2.75); return 7.5625 * t * t + 0.75; }
      if (t < (2.5 / 2.75)) { t -= (2.25 / 2.75); return 7.5625 * t * t + 0.9375; }
      t -= (2.625 / 2.75); return 7.5625 * t * t + 0.984375;
    },
  };
  class Tween {
    constructor(gs, field, duration) {
      this.gs = gs; this.target = field; this.duration = duration;
      this.delay = 0; this.repeatCnt = 0; this.repeatDelay = 0; this.isYoyo = false;
      this.isStarted = false; this.isInitialized = false; this.isFinished = false; this.isKilled = false;
      this.step = 0; this.isIterationStep = false; this.currentTime = 0; this.deltaTime = 0;
      this.callback = null; this.callbackTriggers = CB.COMPLETE;
      this.equation = EQ.LINEAR; this.isRelative = false;
      this.startValue = 0; this.targetValue = 0;
    }
    getValue() { const v = this.gs.getValue(this.target.element, this.target.varDef); return EAD.isNum(v) ? f32(num(v)) : null; }
    setValue(v) {
      const t = this.target.varDef.type;
      if (t === T.F) this.gs.setValue(this.target.element, this.target.varDef, F(v));
      else if (t === T.I) this.gs.setValue(this.target.element, this.target.varDef, Math.trunc(v));
    }
    callCallback(type) { if (this.callback && (this.callbackTriggers & type) > 0) this.callback(type, this); }
    isReverse(step) { return this.isYoyo && Math.abs(step % 4) === 2; }
    isValid(step) { return (step >= 0 && step <= this.repeatCnt * 2) || this.repeatCnt < 0; }
    forceStartValues() { this.setValue(this.startValue); }
    forceEndValues() { this.setValue(this.targetValue); }
    initializeOverride() {
      const v = this.getValue();
      this.startValue = v === null ? 0 : v;
      if (this.isRelative) this.targetValue = f32(this.targetValue + this.startValue);
    }
    updateOverride(step, lastStep, isIterationStep, delta) {
      if (!isIterationStep && step > lastStep) { this.setValue(this.isReverse(lastStep) ? this.startValue : this.targetValue); return; }
      if (!isIterationStep && step < lastStep) { this.setValue(this.isReverse(lastStep) ? this.targetValue : this.startValue); return; }
      if (this.duration < 1e-11 && delta > -1e-11) { this.setValue(this.isReverse(step) ? this.targetValue : this.startValue); return; }
      if (this.duration < 1e-11 && delta < 1e-11) { this.setValue(this.isReverse(step) ? this.startValue : this.targetValue); return; }
      const time = this.isReverse(step) ? this.duration - this.currentTime : this.currentTime;
      const t = f32(this.equation(f32(time / this.duration)));
      this.setValue(f32(this.startValue + t * (this.targetValue - this.startValue)));
    }
    update(delta) {
      if (!this.isStarted || this.isKilled) return;
      this.deltaTime = delta;
      if (!this.isInitialized) this.initialize_();
      if (this.isInitialized) {
        this.testRelaunch();
        this.updateStep();
        this.testCompletion();
      }
      this.currentTime += this.deltaTime;
      this.deltaTime = 0;
    }
    initialize_() {
      if (this.currentTime + this.deltaTime >= this.delay) {
        this.initializeOverride();
        this.isInitialized = true;
        this.isIterationStep = true;
        this.step = 0;
        this.deltaTime -= this.delay - this.currentTime;
        this.currentTime = 0;
        this.callCallback(CB.BEGIN);
        this.callCallback(CB.START);
      }
    }
    testRelaunch() {
      if (!this.isIterationStep && this.repeatCnt >= 0 && this.step < 0 && this.currentTime + this.deltaTime >= 0) {
        this.isIterationStep = true; this.step = 0;
        const d = 0 - this.currentTime;
        this.deltaTime -= d; this.currentTime = 0;
        this.callCallback(CB.BEGIN); this.callCallback(CB.START);
        this.updateOverride(this.step, this.step - 1, this.isIterationStep, d);
      } else if (!this.isIterationStep && this.repeatCnt >= 0 && this.step > this.repeatCnt * 2 && this.currentTime + this.deltaTime < 0) {
        this.isIterationStep = true; this.step = this.repeatCnt * 2;
        const d = 0 - this.currentTime;
        this.deltaTime -= d; this.currentTime = this.duration;
        this.callCallback(CB.BACK_BEGIN); this.callCallback(CB.BACK_START);
        this.updateOverride(this.step, this.step + 1, this.isIterationStep, d);
      }
    }
    updateStep() {
      while (this.isValid(this.step)) {
        if (!this.isIterationStep && this.currentTime + this.deltaTime <= 0) {
          this.isIterationStep = true; this.step -= 1;
          const d = 0 - this.currentTime;
          this.deltaTime -= d; this.currentTime = this.duration;
          if (this.isReverse(this.step)) this.forceStartValues(); else this.forceEndValues();
          this.callCallback(CB.BACK_START);
          this.updateOverride(this.step, this.step + 1, this.isIterationStep, d);
        } else if (!this.isIterationStep && this.currentTime + this.deltaTime >= this.repeatDelay) {
          this.isIterationStep = true; this.step += 1;
          const d = this.repeatDelay - this.currentTime;
          this.deltaTime -= d; this.currentTime = 0;
          if (this.isReverse(this.step)) this.forceEndValues(); else this.forceStartValues();
          this.callCallback(CB.START);
          this.updateOverride(this.step, this.step - 1, this.isIterationStep, d);
        } else if (this.isIterationStep && this.currentTime + this.deltaTime < 0) {
          this.isIterationStep = false; this.step -= 1;
          const d = 0 - this.currentTime;
          this.deltaTime -= d; this.currentTime = 0;
          this.updateOverride(this.step, this.step + 1, this.isIterationStep, d);
          this.callCallback(CB.BACK_END);
          if (this.step < 0 && this.repeatCnt >= 0) this.callCallback(CB.BACK_COMPLETE);
          else this.currentTime = this.repeatDelay;
        } else if (this.isIterationStep && this.currentTime + this.deltaTime > this.duration) {
          this.isIterationStep = false; this.step += 1;
          const d = this.duration - this.currentTime;
          this.deltaTime -= d; this.currentTime = this.duration;
          this.updateOverride(this.step, this.step - 1, this.isIterationStep, d);
          this.callCallback(CB.END);
          if (this.step > this.repeatCnt * 2 && this.repeatCnt >= 0) this.callCallback(CB.COMPLETE);
          this.currentTime = 0;
        } else if (this.isIterationStep) {
          const d = this.deltaTime;
          this.deltaTime -= d; this.currentTime += d;
          this.updateOverride(this.step, this.step, this.isIterationStep, d);
          break;
        } else {
          const d = this.deltaTime;
          this.deltaTime -= d; this.currentTime += d;
          break;
        }
      }
    }
    testCompletion() {
      this.isFinished = this.repeatCnt >= 0 && (this.step > this.repeatCnt * 2 || this.step < 0);
    }
  }
  class TweenManager {
    constructor() { this.objects = []; }
    add(t) { if (this.objects.indexOf(t) < 0) this.objects.push(t); t.isStarted = true; }
    update(delta) {
      for (let i = this.objects.length - 1; i >= 0; i--) {
        if (this.objects[i].isFinished || this.objects[i].isKilled) this.objects.splice(i, 1);
      }
      const n = this.objects.length;
      for (let i = 0; i < n; i++) this.objects[i].update(delta);
    }
    killAll() { for (const t of this.objects) t.isKilled = true; this.objects = []; }
  }

  // ------------------------------------------------------------- effects
  class AbstractEffectGO {
    constructor(engine) { this.engine = engine; this.gs = engine.gameState; this.stopped = false; this.action = null; this.parent = null; }
    setElement(e) { this.effect = e; }
    initialize() {
      this.stopped = false;
      for (const e of this.effect.simultaneousEffects || []) this.gs.addEffect(e, this.action, this.parent);
    }
    act() {}
    isQueueable() { return false; }
    isBlocking() { return false; }
    isStopped() { return this.stopped; }
    stop() { this.stopped = true; }
    finish() {
      this.stopped = true;
      for (const e of this.effect.nextEffects || []) this.gs.addEffect(e, this.action, this.parent);
    }
    isFinished() { return !this.isQueueable(); }
    release() {}
  }

  class ChangeFieldGO extends AbstractEffectGO {
    initialize() {
      const gs = this.gs, ef = this.effect;
      for (const f of ef.fields || []) gs.setValueOp(f.element, f.varDef, ef.operation);
      if (ef.varDef && this.parent) gs.setValueOp(this.parent, ef.varDef, ef.operation);
    }
  }

  const IN_TRANSITION = { element: null, varDef: V.IN_TRANSITION };
  let defaultTransition = null;
  function emptyTransition() {
    if (!defaultTransition) {
      defaultTransition = M.scene(M.rect(800, 600, M.BLACK), '#engine.EmptyTransition', 'EmptyTransition');
      defaultTransition.time = 0; defaultTransition.returnable = false;
    }
    return defaultTransition;
  }
  class ChangeSceneGO extends AbstractEffectGO {
    initialize() {
      super.initialize();
      const gs = this.gs, gui = this.engine.gui, sef = this.engine.sef;
      gs.setValue(IN_TRANSITION.element, IN_TRANSITION.varDef, true);
      this.finished = false;
      let nextScene = gs.decode(this.effect.nextScene);
      if (!nextScene) nextScene = gui.getPreviousScene();
      if (!nextScene) { this.finished = true; return; }
      if (nextScene !== gui.getScene().element) {
        this.previousScene = gui.getScene();
        this.transition = sef.get(this.effect.transition || emptyTransition());
        const sceneGO = sef.get(nextScene);
        this.transition.transition_(this.previousScene, sceneGO, this);
        this.nextScene = sceneGO;
        gui.setScene(this.transition);
      } else this.finished = true;
    }
    isQueueable() { return true; }
    isBlocking() { return true; }
    isFinished() { return this.finished; }
    transitionEnded() {
      const gs = this.gs, gui = this.engine.gui;
      gs.setValue(IN_TRANSITION.element, IN_TRANSITION.varDef, false);
      gui.setScene(this.nextScene);
      this.nextScene.setPositionXY(0, 0);
      this.nextScene.setAlpha(1);
      this.nextScene.setZ(0);
      this.finished = true;
      this.transition.removeActor(this.nextScene);
      this.transition.removeActor(this.previousScene);
      this.previousScene.free();
      this.transition.free();
      this.engine.onSceneChanged(this.nextScene);
    }
  }

  class TriggerMacroGO extends AbstractEffectGO {
    initialize() {
      super.initialize();
      const ef = this.effect;
      let macro = null;
      for (let i = 0; i < ef.macros.length && macro === null; i++) {
        if (this.gs.evaluate(ef.conditions[i])) { macro = ef.macros[i]; break; }
      }
      if (macro) {
        const list = Array.isArray(macro) ? macro : (macro.effects || []);
        for (const e of list) this.gs.addEffect(e, this.action, this.parent);
      }
    }
  }

  class WaitGO extends AbstractEffectGO {
    initialize() {
      super.initialize();
      const ef = this.effect;
      this.eGO = null;
      if (ef.waitUntilClick || ef.blockInput) {
        this.time = ef.waitUntilClick ? 1 : ef.time;
        const g = M.ghost(true);
        const hud = this.engine.gui.getHUD('#engine.huds.effects');
        this.eGO = hud.addSceneElementModel(g);
        this.eGO.setInputProcessor(this, false);
      } else this.time = ef.time;
    }
    act() {
      if (!this.effect.waitUntilClick) this.time -= this.gs.getValue(null, SYS.ELAPSED_TIME_PER_UPDATE);
    }
    isFinished() { return this.time <= 0; }
    finish() { if (this.eGO) this.eGO.remove(); super.finish(); }
    isQueueable() { return true; }
    handle(event) {
      event.cancel();
      if (event.type === 'touchDown' && this.effect.waitUntilClick) { this.time = 0; return true; }
      return false;
    }
  }

  class PlaySoundGO extends AbstractEffectGO {
    initialize() {
      super.initialize();
      const ef = this.effect, sm = this.engine.sound;
      if (ef.background) sm.playBackgroundMusic(ef.sound, ef.volume);
      else sm.playSound(ef.sound, ef.overlay, ef.volume);
    }
  }

  class RemoveGO extends AbstractEffectGO {
    initialize() {
      super.initialize();
      const go = this.engine.gui.getSceneElement(this.effect.element);
      if (go) { go.remove(); go.free(); }
    }
  }

  class AddChildGO extends AbstractEffectGO {
    initialize() {
      super.initialize();
      const go = this.engine.sef.getById(this.effect.parentId);
      if (go) go.addSceneElementModel(this.effect.elementToAdd);
    }
  }

  class QuitGameGO extends AbstractEffectGO {
    initialize() {
      super.initialize();
      if (this.effect.restart) this.engine.restart(false); else this.engine.quit();
    }
  }
  class ToggleSoundGO extends AbstractEffectGO {
    initialize() { super.initialize(); this.engine.sound.toggleSound(); }
  }
  class TogglePauseGO extends AbstractEffectGO {
    initialize() {
      super.initialize();
      this.gs.paused = !this.gs.paused; // SoundManagerImpl.setPause() does nothing
    }
  }
  class EmptyEffectGO extends AbstractEffectGO {}

  class InterpolationGO extends AbstractEffectGO {
    initialize() {
      super.initialize();
      const ef = this.effect, gs = this.gs;
      this.finishedCount = 0;
      const type = enumName(ef.interpolationType);
      const eq = type === 'BOUNCE_END' ? EQ.BOUNCE_OUT : type === 'DESACCELERATE' ? EQ.CUBIC_OUT : EQ.LINEAR;
      (ef.fields || []).forEach((f, i) => {
        const n1 = gs.operate('java.lang.Number', ef.initialValues[i]);
        const n2 = gs.operate('java.lang.Number', ef.endValues[i]);
        if (n1 !== null && n1 !== undefined && n2 !== null && n2 !== undefined) {
          const startValue = f32(num(n1)), endValue = f32(num(n2));
          const t = new Tween(gs, f, ef.interpolationTime);
          t.equation = eq;
          t.delay += ef.delay;
          const lt = enumName(ef.loopType);
          if (lt === 'RESTART') { t.repeatCnt = ef.loops; t.repeatDelay = ef.delay; }
          else if (lt === 'REVERSE') { t.repeatCnt = ef.loops; t.repeatDelay = ef.delay; t.isYoyo = true; }
          if (ef.relative) { t.isRelative = true; t.targetValue = f32(endValue - startValue); }
          else t.targetValue = endValue; // Tween.set(f).target(start) is never started in the original
          t.callback = (type) => { if (type === CB.END) this.stop(); else if (type === CB.COMPLETE) this.finishedCount--; };
          gs.tweens.add(t);
          this.finishedCount++;
        }
      });
    }
    isFinished() { return this.finishedCount <= 0; }
    isQueueable() { return true; }
  }

  // ----------------------------------------------------- balloon shape
  // BalloonShape + RoundedRectangleStroke (the only stroke used by the game)
  const ORIENTATIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  function originLocation(left, top, right, bottom, xo, yo) {
    if (xo < left) return yo < top ? 'NW' : yo > bottom ? 'SW' : 'W';
    if (xo > right) return yo < top ? 'NE' : yo > bottom ? 'SE' : 'E';
    if (yo < top) return 'N';
    if (yo > bottom) return 'S';
    return null;
  }
  function balloonShape(left, top, right, bottom, type, hasOrigin, xo, yo, paint) {
    const pts = [];
    const R = 10;
    const moveTo = (x, y) => { pts.push(x, y); };
    const lineTo = (x, y) => { if (!pts.length) pts.push(0, 0); pts.push(1, x | 0, y | 0); };
    const quadTo = (x1, y1, x2, y2) => { if (!pts.length) pts.push(0, 0); pts.push(2, x1 | 0, y1 | 0, x2 | 0, y2 | 0); };
    const rounded = enumName(type) !== 'RECTANGLE';
    const corner = (x1, x2, y1, y2) => {
      if ((x1 < x2 && y1 < y2) || (x1 > x2 && y1 > y2)) return [x2, y1];
      if ((x1 > x2 && y1 < y2) || (x1 < x2 && y1 > y2)) return [x1, y2];
      return [0, 0];
    };
    const stroke = {
      addHorizontal(x1, x2, y, o) {
        if (o) {
          lineTo(xo, y); lineTo(xo, yo);
          let diff = x2 - xo;
          diff = Math.abs(diff) > 20 ? 20 * Math.sign(x2 - xo) : diff;
          lineTo(xo + diff, y); lineTo(x2, y);
        } else lineTo(x2, y);
      },
      addVertical(x, y1, y2, o) {
        if (o) {
          lineTo(x, yo); lineTo(xo, yo);
          const diff = y2 - yo;
          lineTo(x, yo + diff); lineTo(x, y2);
        } else lineTo(x, y2);
      },
      addDiagonal(x1, x2, y1, y2, o) {
        if (o) { lineTo(xo, yo); lineTo(x2, y2); return; }
        const c = corner(x1, x2, y1, y2);
        if (rounded) quadTo(c[0], c[1], x2, y2); else { lineTo(c[0], c[1]); lineTo(x2, y2); }
      },
    };
    let originSide = hasOrigin ? originLocation(left, top, right, bottom, xo, yo) : null;
    hasOrigin = hasOrigin && originSide !== null;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (const side of ORIENTATIONS) {
      switch (side) {
        case 'N': y1 = top; y2 = top; x1 = left + R; x2 = right - R; moveTo(x1, y1); break;
        case 'S': y1 = bottom; y2 = bottom; x1 = right - R; x2 = left + R; break;
        case 'E': y1 = top + R; y2 = bottom - R; x1 = right; x2 = right; break;
        case 'W': y1 = bottom - R; y2 = top + R; x1 = left; x2 = left; break;
        case 'NE': x1 = right - R; y1 = top; x2 = right; y2 = top + R; break;
        case 'SE': x1 = right; y1 = bottom - R; x2 = right - R; y2 = bottom; break;
        case 'SW': x1 = left + R; y1 = bottom; x2 = left; y2 = bottom - R; break;
        case 'NW': x1 = left; y1 = top + R; x2 = left + R; y2 = top; break;
      }
      const o = hasOrigin && originSide === side;
      if (side === 'N' || side === 'S') stroke.addHorizontal(x1, x2, y1, o);
      else if (side === 'E' || side === 'W') stroke.addVertical(x1, y1, y2, o);
      else stroke.addDiagonal(x1, x2, y1, y2, o);
    }
    return { $c: 'BalloonShape', points: pts, closed: true, paint };
  }

  // --------------------------------------------------------------- speak
  class SpeakGO extends AbstractEffectGO {
    initialize() {
      super.initialize();
      const gs = this.gs, ef = this.effect, gui = this.engine.gui;
      if (ef.stateField) {
        const element = ef.stateField.element;
        const moving = gs.getValue(element, V.ELEMENT_MOVING);
        if (moving) moving.stop();
        this.previousState = gs.getValue(ef.stateField.element, ef.stateField.varDef);
        gs.setValue(ef.stateField.element, ef.stateField.varDef, 'talking');
      }
      this.finished = false;
      this.alphaV = 0;
      this.gone = false;
      this.effectsHud = gui.getHUD('#engine.huds.effects');
      this.bubbleDialog = this.engine.sef.get(this.getVisualRepresentation());
      this.bubbleDialog.setInputProcessor(this, true);
      this.effectsHud.addSceneElement(this.bubbleDialog);
      this.hasTime = ef.time > 0;
      if (this.hasTime) {
        this.timePerPart = Math.trunc(ef.time / this.caption.totalParts);
        this.currentTime = this.timePerPart;
      }
    }
    getVisualRepresentation() {
      const gs = this.gs, ef = this.effect;
      const width = gs.getValue(null, SYS.GAME_WIDTH), height = gs.getValue(null, SYS.GAME_HEIGHT);
      const hm = Math.trunc(width / 35), vm = Math.trunc(height / 35);
      const left = hm, right = width - hm;
      let top = vm, bottom = Math.trunc(height / 4) + top;
      let rectangle;
      if (ef.x && ef.y) {
        let xo = Math.trunc(num(gs.operate(T.F, ef.x)));
        let yo = Math.trunc(num(gs.operate(T.F, ef.y)));
        xo += Math.trunc(this.effectsHud.getX());
        yo += Math.trunc(this.effectsHud.getY());
        if (yo < height / 2) {
          bottom = height - vm;
          top = bottom - Math.trunc(height / 4);
          yo = top - 30 * 2;
        } else {
          yo = bottom + 30 * 2;
        }
        rectangle = balloonShape(left, top, right, bottom, ef.ballonType, true, xo, yo, ef.bubbleColor);
      } else {
        const offsetY = Math.trunc(height / 2) - Math.trunc((bottom - top) / 2);
        top += offsetY; bottom += offsetY;
        rectangle = balloonShape(left, top, right, bottom, ef.ballonType, false, -1, -1, ef.bubbleColor);
      }
      const text = ef.caption;
      text.padding = 30;
      text.preferredWidth = right - left;
      text.preferredHeight = bottom - top;
      const textSE = M.sceneElement(text);
      M.setPosition(textSE, left, top, 0, 0);
      const complex = M.group(rectangle);
      complex.sceneElements.push(M.ghost(true));
      complex.sceneElements.push(textSE);
      this.caption = this.engine.assets.get(text);
      this.caption.load();
      this.caption.reset();
      const f = { $c: 'FramesAnimation', frames: [
        { $c: 'Frame', drawable: M.image('@drawable/dots.png'), time: 1000 },
        { $c: 'Frame', drawable: M.rect(1, 1, M.TRANSPARENT), time: 1000 }] };
      this.dots = M.sceneElement(f);
      M.setAppearance(this.dots, 'done', M.image('@drawable/dot.png'));
      M.setPosition(this.dots, right - 20, bottom - 15, 0.5, 0.5);
      complex.sceneElements.push(this.dots);
      return complex;
    }
    isFinished() { return this.finished && this.gone; }
    act(delta) {
      const skipped = this.engine.skippedMilliseconds();
      if (this.hasTime) {
        this.currentTime -= delta;
        if (this.currentTime <= 0) {
          this.currentTime = this.timePerPart + this.currentTime;
          this.caption.goForward(1);
        }
      }
      if (this.finished) {
        this.alphaV = f32(this.alphaV - f32(0.003 * skipped));
        if (this.alphaV <= 0) { this.alphaV = 0; this.gone = true; }
      } else if (this.alphaV >= 1) {
        this.finished = this.finished || this.caption.timesRead > 0;
      } else {
        this.alphaV = f32(this.alphaV + f32(0.003 * skipped));
        if (this.alphaV > 1) this.alphaV = 1;
      }
      this.bubbleDialog.setAlpha(this.alphaV);
      if (this.caption.currentPart === this.caption.totalParts - 1) {
        this.gs.setValue(this.dots, V.BUNDLE_ID, 'done');
      }
    }
    finish() { this.end(); super.finish(); }
    stop() { this.end(); super.stop(); }
    end() {
      if (this.effect.stateField) this.gs.setValue(this.effect.stateField.element, this.effect.stateField.varDef, this.previousState);
      this.bubbleDialog.remove();
    }
    isQueueable() { return true; }
    handle(event) {
      event.cancel();
      if (!this.hasTime && !this.finished && this.alphaV > 0.9 && event.type === 'touchDown') {
        const c = this.caption;
        if (c.timesRead >= 1 || c.currentPart === c.totalParts - 1) this.finished = true;
        else c.goForward(1);
      }
      return true;
    }
    release() { this.bubbleDialog.free(); }
  }

  // ------------------------------------------------------------ question
  class QuestionGO extends AbstractEffectGO {
    initialize() {
      super.initialize();
      this.y = 0;
      const q = this.setUpNewInstance();
      this.engine.gui.getHUD('#engine.huds.effects').addSceneElement(this.engine.sef.get(q));
    }
    setUpNewInstance() {
      const ef = this.effect;
      const question = M.group(null);
      Object.defineProperty(question, '__question', { value: true, enumerable: false });
      question.sceneElements.push(M.ghost(true));
      this.y = 10;
      const inEffect = M.effect('ChangeFieldEf', { fields: [], varDef: V.ALPHA, operation: M.value(F(0.5)) });
      const outEffect = M.effect('ChangeFieldEf', { fields: [], varDef: V.ALPHA, operation: M.value(F(1)) });
      this.setUpQuestion(question);
      const selectEffect = M.effect('RemoveEf', { element: question });
      const toAdd = ef.answers.keys();
      let ordered = [];
      if (ef.randomAnswers) {
        while (toAdd.length) ordered.push(toAdd.splice(Math.floor(Math.random() * toAdd.length), 1)[0]);
      } else ordered = toAdd;
      ordered.forEach((s, i) => this.setUpAnswer(question, i, s, ef.answers.get(s), selectEffect, inEffect, outEffect));
      return question;
    }
    setUpQuestion(root) {
      const ef = this.effect;
      if (ef.question) {
        const fontSize = 20, padding = 8;
        const caption = {
          $c: 'Caption', label: ef.question, font: { $c: 'BasicFont', name: 'Arial', size: F(fontSize), style: jenum('FontStyle', 'PLAIN'), uri: null },
          textPaint: M.paint(M.BLACK, M.WHITE, 1), hasBubble: true, bubblePaint: M.BLACK_ON_WHITE,
          preferredWidth: 750, preferredHeight: -1, padding, operations: [], alignment: jenum('Alignment', 'CENTER'),
        };
        const qe = M.sceneElement(caption);
        M.setPosition(qe, 10, this.y);
        M.setVar(qe, V.ALPHA, F(0));
        root.sceneElements.push(qe);
        qe.events.push({ $c: 'SceneElementEv', effects: new EAD.EMap([[jenum('SceneElementEvType', 'INIT'), [
          interpolation(qe, V.ALPHA, 0, 1, 500, 0)]]]) });
        this.y += fontSize * 2 + padding * 2;
      }
    }
    setUpAnswer(question, pos, key, value, selectEffect, inEffect, outEffect) {
      const ef = this.effect;
      const delay = ef.question ? 500 : 0;
      const fontSize = 18, padding = 5;
      const caption = {
        $c: 'Caption', label: key, font: { $c: 'BasicFont', name: 'Arial', size: F(fontSize), style: jenum('FontStyle', 'PLAIN'), uri: null },
        textPaint: M.paint(M.BLACK, M.WHITE, 1), hasBubble: true, bubblePaint: M.BLACK_ON_WHITE,
        preferredWidth: 700, preferredHeight: -1, padding, operations: [], alignment: jenum('Alignment', 'LEFT'),
      };
      const ae = M.sceneElement(caption);
      M.setPosition(ae, -800, this.y);
      M.addBehavior(ae, EAD.GEV.LEFT_PRESSED, selectEffect);
      M.addBehavior(ae, EAD.GEV.LEFT_PRESSED, value || []);
      M.addBehavior(ae, EAD.GEV.ENTERED, inEffect);
      M.addBehavior(ae, EAD.GEV.EXITED, outEffect);
      this.y = Math.trunc(this.y + fontSize * 2.5 + padding * 2.5);
      ae.events.push({ $c: 'SceneElementEv', effects: new EAD.EMap([[jenum('SceneElementEvType', 'INIT'), [
        interpolation(ae, V.X, 0, 820, 400, delay + pos * 100)]]]) });
      question.sceneElements.push(ae);
    }
  }
  function interpolation(el, def, start, end, time, delay) {
    const mop = (v) => ({ $c: 'MathOp', expression: String(v), operationsList: [] });
    return M.effect('InterpolationEf', {
      fields: [M.field(el, def)], initialValues: [mop(start)], endValues: [mop(end)], interpolationTime: time,
      delay: delay || 0, loopType: jenum('InterpolationLoopType', 'NO_LOOP'), loops: 1,
      interpolationType: jenum('InterpolationType', 'LINEAR'), relative: true,
    });
  }

  // ---------------------------------------------------------- html report
  class HtmlReportGO extends AbstractEffectGO {
    initialize() {
      const gs = this.gs, ef = this.effect, strings = this.engine.strings;
      const rows = [];
      (ef.operations || []).forEach((op, i) => {
        const value = EAD.jstr(gs.operate(T.O, op));
        const label = strings.getString(ef.labels[i]);
        rows.push([label, value]);
      });
      this.engine.showReport(rows);
    }
  }

  // ------------------------------------------------------- move element
  class MoveSceneElementGO extends AbstractEffectGO {
    constructor(engine) { super(engine); this.__javaClass = 'MoveSceneElementGO'; }
    initialize() {
      super.initialize();
      const gs = this.gs, ef = this.effect, sef = this.engine.sef;
      // SceneElementEffectGO
      const se = gs.decode(ef.sceneElement);
      if (se && se.$c && se.$c !== 'SceneElementDef') this.sceneElement = se;
      else if (se) this.sceneElement = gs.getValue(se, V.SCENE_ELEMENT);
      else this.sceneElement = this.parent;
      let endX = 0, endY = 0;
      this.cancelMovement = false;
      const moving = sef.get(this.sceneElement);
      if (ef.xtarget && ef.ytarget) {
        endX = num(gs.operate(T.F, ef.xtarget));
        endY = num(gs.operate(T.F, ef.ytarget));
      } else if (ef.targetSceneElement) {
        endX = num(gs.getValue(ef.targetSceneElement, V.X));
        endY = num(gs.getValue(ef.targetSceneElement, V.Y));
        const w = moving.getWidth(), h = moving.getHeight();
        const cx = f32(moving.getDispX() * w - w / 2), cy = f32(moving.getDispY() * h - h / 2);
        endX -= cx; endY -= cy;
      } else this.cancelMovement = true;
      if (!this.cancelMovement) {
        let d = DEFAULT_TRAJECTORY;
        if (ef.useTrajectory) {
          const st = gs.getValue(this.engine.gui.getScene().element, V.TRAJECTORY_DEFINITION);
          if (st) d = st;
        }
        this.trajectory = d.$c === 'NodeTrajectory' ? new NodeTrajectoryGO(this.engine) : new SimpleTrajectoryGO(this.engine);
        this.trajectory.trajectory = d;
        this.trajectory.set(moving, endX, endY, sef.get(ef.targetSceneElement));
      }
      const go = gs.getValue(this.sceneElement, V.ELEMENT_MOVING);
      if (go) go.stop();
      if (!this.cancelMovement) gs.setValue(this.sceneElement, V.ELEMENT_MOVING, this);
    }
    isFinished() { return this.cancelMovement || this.trajectory.isDone(); }
    act(delta) { this.trajectory.act(delta); }
    finish() {
      if ((!this.cancelMovement && this.trajectory.isReachedTarget()) || !this.effect.useTrajectory) super.finish();
      this.gs.setValue(this.sceneElement, V.ELEMENT_MOVING, null);
    }
    stop() {
      super.stop();
      this.gs.setValue(this.sceneElement, V.STATE, 'default');
      this.gs.setValue(this.sceneElement, V.ELEMENT_MOVING, null);
    }
    isQueueable() { return true; }
  }

  const DEFAULT_TRAJECTORY = { $c: 'SimpleTrajectory', onlyHorizontal: false, freeWalk: true, top: -1073741824, left: -1073741824,
    bottom: 1073741823, right: 1073741823, distanceToTarget: 300 };

  class SimpleTrajectoryGO {
    constructor(engine) { this.engine = engine; this.gs = engine.gameState; }
    set(moving, dx, dy, target) {
      const t = this.trajectory;
      this.movingElement = moving; this.sceneElement = moving.element;
      this.destinyX = dx; this.destinyY = dy; this.target = target;
      this.startX = moving.getRelativeX(); this.startY = moving.getRelativeY();
      if (t.onlyHorizontal) this.destinyY = this.startY;
      if (!t.freeWalk) {
        this.destinyX = Math.min(t.right, Math.max(t.left, this.destinyX));
        if (!t.onlyHorizontal) this.destinyY = Math.max(t.top, Math.min(t.bottom, this.destinyY));
      }
      this.diffX = f32(this.destinyX - this.startX); this.diffY = f32(this.destinyY - this.startY);
      const distance = f32(Math.sqrt(this.diffX * this.diffX + this.diffY * this.diffY));
      this.totalTime = f32(distance * 10);
      this.currentTime = 0;
      if (Math.abs(this.diffX) > 0.1 || Math.abs(this.diffY) > 0.1) {
        moving.setState('walking');
        if (Math.abs(this.diffX) > Math.abs(this.diffY)) moving.setOrientation(jenum('Orientation', this.diffX > 0 ? 'E' : 'W'));
        else moving.setOrientation(jenum('Orientation', this.diffY > 0 ? 'S' : 'N'));
      }
    }
    act(delta) {
      this.movingElement = this.engine.sef.get(this.sceneElement);
      this.currentTime += delta;
      const x = f32((this.currentTime / this.totalTime) * this.diffX);
      const y = f32((this.currentTime / this.totalTime) * this.diffY);
      this.movingElement.setX(this.startX + x);
      this.movingElement.setY(this.startY + y);
      if (this.currentTime >= this.totalTime) this.movingElement.setState('default');
    }
    isDone() { return this.currentTime >= this.totalTime; }
    isReachedTarget() {
      if (!this.target) return true;
      const dx = this.target.getCenterX() - this.movingElement.getCenterX();
      const dy = this.target.getCenterY() - this.movingElement.getCenterY();
      return Math.sqrt(dx * dx + dy * dy) <= this.trajectory.distanceToTarget;
    }
  }

  // ------------------------------------------------- node trajectories
  class DNode {
    constructor(x, y, linePosition) {
      this.x = x; this.y = y; this.sides = []; this.goalDistance = 0; this.breakNode = false; this.getsTo = false;
      this.linePosition = linePosition || 0; this.scale = 0;
    }
    calculateGoalDistance(tx, ty) { this.goalDistance = Math.trunc(Math.sqrt(Math.pow(tx - this.x, 2) + Math.pow(ty - this.y, 2))); }
  }
  class PathSide {
    constructor(s, e, length, realLength, side) {
      this.length = f32(length); this.realLength = f32(realLength); this.start = s; this.end = e; this.side = side;
      this.endPosition = null; this.endScale = 0;
    }
    getOtherNode(n) { return n === this.start ? this.end : this.start; }
  }
  class DijkstraGenerator {
    constructor(engine) { this.engine = engine; this.vm = engine.gameState; }
    getTrajectory(def, moving, x, y, target) { return this.pathToNearestPoint(def, moving, x, y, target); }
    pathToNearestPoint(def, moving, toX, toY, target) {
      const nodeMap = new Map();
      for (const node of def.nodes) {
        const d = new DNode(node.x, node.y);
        d.scale = num(node.scale);
        d.calculateGoalDistance(toX, toY);
        nodeMap.set(node.id, d);
        d.getsTo = this.isGetsTo(d, target);
      }
      const current = this.generateSides(def, nodeMap, moving, toX, toY, target);
      if (!current) return { sides: [], getsTo: false };
      const map = this.getMap(current);
      return this.decodePath(current, map);
    }
    getMap(current) {
      const map = new Map();
      map.set(current, { length: 0, path: null });
      const visit = [current], visited = [current];
      while (visit.length) {
        const node = visit.shift();
        if (node.breakNode) continue;
        for (const side of node.sides) {
          const other = side.getOtherNode(node);
          if (!map.get(other)) map.set(other, { length: f32(2147483647), path: null });
          if (f32(map.get(node).length + side.length) < map.get(other).length) {
            map.get(other).length = f32(map.get(node).length + side.length);
            map.get(other).path = side;
            if (visited.indexOf(other) < 0) { visit.push(other); visited.push(other); }
          }
        }
      }
      return map;
    }
    decodePath(current, map) {
      let best = current;
      for (const node of map.keys()) {
        if (node.getsTo && !best.getsTo) best = node;
        else if (!node.getsTo && best.getsTo) continue;
        else if (node.goalDistance < best.goalDistance) best = node;
      }
      const path = { sides: [], getsTo: best.getsTo };
      const last = best;
      while (best !== current) {
        const side = map.get(best).path;
        if (best === last) {
          let x1 = best.x, y1 = best.y;
          const other = side.getOtherNode(best);
          const x21 = other.x - x1, y21 = other.y - y1;
          if (x21 !== 0) x1 += x21 / Math.abs(x21);
          if (y21 !== 0) y1 += y21 / Math.abs(y21);
          side.endPosition = [x1, y1];
        } else side.endPosition = [best.x, best.y];
        side.endScale = best.scale;
        best = side.getOtherNode(best);
        path.sides.unshift(side);
      }
      return path;
    }
    generateSides(def, nodeMap, moving, toX, toY, target) {
      const currentSide = this.getCurrentSide(def, moving);
      let current = null;
      for (const side of def.sides) {
        const start = nodeMap.get(side.idStart.id), end = nodeMap.get(side.idEnd.id);
        const px = num(this.vm.getValue(moving, V.X)), py = num(this.vm.getValue(moving, V.Y));
        const inter = [start];
        if (side === currentSide) {
          if (px === start.x && py === start.y) current = start;
          else if (px === end.x && py === end.y) current = end;
          else {
            current = new DNode(px, py);
            current.scale = num(this.vm.getValue(moving, V.SCALE));
            inter.push(current);
          }
        }
        inter.push(end);
        this.addClosestPoint(inter, toX, toY);
        this.addBarrierIntersections(def, inter);
        if (target) this.addInfluenceAreaIntersections(target, inter);
        for (const n of inter) { n.calculateGoalDistance(toX, toY); n.getsTo = this.isGetsTo(n, target); }
        for (let i = 0; i < inter.length - 1; i++) {
          const s = inter[i], e = inter[i + 1];
          const length = Math.sqrt(Math.pow(s.x - e.x, 2) + Math.pow(s.y - e.y, 2));
          const ps = new PathSide(s, e, num(side.length) * length / num(side.realLength), length, side);
          s.sides.push(ps); e.sides.push(ps);
        }
      }
      return current;
    }
    addClosestPoint(inter, toX, toY) {
      for (let i = 0; i < inter.length - 1; i++) {
        const n = this.getClosestPosition(inter[i], inter[i + 1], toX, toY);
        if (n) { inter.splice(i + 1, 0, n); break; }
      }
    }
    getClosestPosition(A, B, toX, toY) {
      const APx = f32(toX - A.x), APy = f32(toY - A.y), ABx = f32(B.x - A.x), ABy = f32(B.y - A.y);
      const ab2 = f32(ABx * ABx + ABy * ABy);
      const apab = f32(APx * ABx + APy * ABy);
      const t = f32(apab / ab2);
      if (ab2 === 0 || t <= 0.01 || t >= 0.99) return null;
      const x = f32(A.x + ABx * t), y = f32(A.y + ABy * t);
      const n = new DNode(Math.trunc(x), Math.trunc(y));
      n.scale = f32(A.scale + t * (B.scale - A.scale));
      return n;
    }
    influenceArea(target) { return this.vm.getValue(target.element, V.INFLUENCE_AREA); }
    addInfluenceAreaIntersections(target, inter) {
      const r = this.influenceArea(target);
      if (!r) return;
      let i = 0;
      while (i < inter.length - 1) {
        const ni = this.getIntersections(inter[i], inter[i + 1], r.width, r.height, r.x, r.y, 0, 0);
        for (const n of ni) n.getsTo = true;
        inter.splice(i + 1, 0, ...ni);
        i += ni.length + 1;
      }
    }
    isGetsTo(p, target) {
      if (!target) return false;
      const r = this.influenceArea(target);
      if (!r) return false;
      return r.x < p.x && r.y <= p.y && r.x + r.width >= p.x && r.y + r.height >= p.y;
    }
    addBarrierIntersections(def, inter) {
      for (const barrier of def.barriers || []) {
        const go = this.engine.sef.get(barrier);
        if (this.vm.getValue(barrier, V.BARRIER_ON)) {
          let i = 0;
          while (i < inter.length - 1) {
            const ni = this.getIntersections(inter[i], inter[i + 1], Math.trunc(go.getWidth() * go.getScale()),
              Math.trunc(go.getHeight() * go.getScale()), go.getX(), go.getY(), go.getDispX(), go.getDispY());
            for (const n of ni) n.breakNode = true;
            inter.splice(i + 1, 0, ...ni);
            i += ni.length + 1;
          }
        }
      }
    }
    getIntersections(start, end, width, height, px, py, dispX, dispY) {
      const res = [];
      const x = Math.trunc(px - dispX * width), y = Math.trunc(py - dispY * height);
      const add = (n) => { if (n) res.push(n); };
      add(this.getIntersection(start, end, x, y, x + width, y));
      add(this.getIntersection(start, end, x + width, y, x + width, y + height));
      add(this.getIntersection(start, end, x, y + height, x + width, y + height));
      add(this.getIntersection(start, end, x, y, x, y + height));
      res.sort((a, b) => (a.linePosition < b.linePosition ? -1 : 1));
      return res;
    }
    getIntersection(s, e, x3, y3, x4, y4) {
      const x1 = s.x, y1 = s.y, x2 = e.x, y2 = e.y;
      const den = f32((y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1));
      if (den === 0) return null;
      const x13 = x1 - x3, y13 = y1 - y3;
      const uA = f32(f32((x4 - x3) * y13 - (y4 - y3) * x13) / den);
      const uB = f32(f32((x2 - x1) * y13 - (y2 - y1) * x13) / den);
      if (uA < 0 || uB < 0 || uA > 1 || uB > 1) return null;
      const n = new DNode(Math.trunc(x1 + uA * (x2 - x1)), Math.trunc(y1 + uA * (y2 - y1)), uA);
      n.scale = f32(s.scale + uA * (e.scale - s.scale));
      return n;
    }
    getCurrentSide(def, moving) {
      let side = this.vm.getValue(moving, V.CURRENT_SIDE);
      if (def.sides.indexOf(side) < 0) side = null;
      if (!side) {
        let distance = 2147483647;
        const mx = num(this.vm.getValue(moving, V.X)), my = num(this.vm.getValue(moving, V.Y));
        for (const node of def.nodes) {
          const d = Math.trunc(Math.sqrt(Math.pow(node.x - mx, 2) + Math.pow(node.y - my, 2)));
          if (d < distance) {
            for (const s2 of def.sides) {
              if (s2.idEnd.id === node.id || s2.idStart.id === node.id) { side = s2; distance = d; }
            }
          }
        }
      }
      return side;
    }
  }

  class NodeTrajectoryGO {
    constructor(engine) { this.engine = engine; this.gs = engine.gameState; this.generator = new DijkstraGenerator(engine); }
    set(moving, dx, dy, target) {
      this.movingElement = moving; this.sceneElement = moving.element;
      this.target = target;
      this.currentTime = 0;
      this.path = this.generator.getTrajectory(this.trajectory, moving.element, dx, dy, target);
      this.currentSide = 0;
      this.targetX = dx; this.targetY = dy;
      this.finished = false; this.finishedSide = false; this.firstUpdate = true;
      this.initScale = 1; this.initX = moving.getRelativeX(); this.initY = moving.getRelativeY();
      this.targetScale = 1; this.totalTime = 0;
      this.updateTarget();
    }
    act() {
      const gs = this.gs, el = this.sceneElement;
      this.movingElement = this.engine.sef.get(el);
      this.currentTime += gs.getValue(null, SYS.ELAPSED_TIME_PER_UPDATE);
      if (!this.finished) {
        if (this.firstUpdate) { this.firstUpdate = false; gs.setValue(el, V.STATE, 'walking'); }
        if (this.finishedSide) this.updateTarget();
        if (this.currentTime <= this.totalTime) {
          const p = f32(this.currentTime / this.totalTime);
          gs.setValue(el, V.X, F(this.initX + p * (this.targetX - this.initX)));
          gs.setValue(el, V.Y, F(this.initY + p * (this.targetY - this.initY)));
          gs.setValue(el, V.SCALE, F(this.initScale + p * (this.targetScale - this.initScale)));
        } else {
          gs.setValue(el, V.X, F(this.targetX));
          gs.setValue(el, V.Y, F(this.targetY));
          this.finishedSide = true;
        }
      }
      if (this.finished) this.movingElement.setState('default');
    }
    updateTarget() {
      const gs = this.gs;
      if (this.currentSide < this.path.sides.length) {
        const side = this.path.sides[this.currentSide];
        const el = this.movingElement.element;
        this.initX = num(gs.getValue(el, V.X));
        this.initY = num(gs.getValue(el, V.Y));
        this.initScale = num(gs.getValue(el, V.SCALE));
        this.targetX = side.endPosition[0];
        this.targetY = side.endPosition[1];
        this.targetScale = side.endScale;
        this.currentTime = Math.trunc(this.currentTime - this.totalTime);
        this.totalTime = f32((side.length / 100) * 1000);
        gs.setValue(el, V.CURRENT_SIDE, side.side);
        this.updateDirection();
        this.currentSide++;
        this.finishedSide = false;
      } else this.finished = true;
    }
    updateDirection() {
      const xv = this.targetX - this.initX, yv = this.targetY - this.initY;
      const module = Math.sqrt(xv * xv + yv * yv);
      const c = f32(Math.min(1, Math.max(0, xv / module)));
      const angle = Math.acos(c) * Math.sign(-yv);
      let dir = 'W';
      if (-0.00001 < angle && angle < 0.00001) dir = this.initX > this.targetX ? 'W' : 'E';
      else if (angle < 3 * Math.PI / 4 && angle >= Math.PI / 4) dir = 'N';
      else if (angle < Math.PI / 4 && angle >= -Math.PI / 4) dir = 'E';
      else if (angle < -Math.PI / 4 && angle >= -3 * Math.PI / 4) dir = 'S';
      this.movingElement.setOrientation(jenum('Orientation', dir));
    }
    isDone() { return this.finished; }
    isReachedTarget() { return !this.target ? true : this.path.getsTo; }
  }

  // ------------------------------------------------------------ factory
  const EFFECT_CLASSES = {
    ChangeFieldEf: ChangeFieldGO, ChangeAppearanceEf: ChangeFieldGO, ChangeSceneEf: ChangeSceneGO,
    TriggerMacroEf: TriggerMacroGO, WaitEf: WaitGO, PlaySoundEf: PlaySoundGO, RemoveEf: RemoveGO,
    AddChildEf: AddChildGO, QuitGameEf: QuitGameGO, ToggleSoundEf: ToggleSoundGO, TogglePauseEf: TogglePauseGO,
    EmptyEffect: EmptyEffectGO, InterpolationEf: InterpolationGO, SpeakEf: SpeakGO, QuestionEf: QuestionGO,
    MoveSceneElementEf: MoveSceneElementGO, HtmlReportEf: HtmlReportGO,
  };
  function createEffectGO(engine, e) {
    const C = EFFECT_CLASSES[e.$c];
    if (!C) return null;
    const go = new C(engine);
    go.setElement(e);
    return go;
  }

  Object.assign(EAD, { Tween, TweenManager, createEffectGO, balloonShape, emptyTransition, EQ });
})();
