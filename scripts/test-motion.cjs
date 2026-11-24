/* global __dirname */
// Exercise production motion and preference code with deterministic native boundaries.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
function load(file, modules) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { exports, require(name) { assert.ok(name in modules, name); return modules[name]; } });
  return exports;
}
function preference() {
  let store, nativeListener, reads = 0, removals = 0, subscriptions = 0;
  const queries = [];
  const mod = load('src/lib/motionPreference.ts', {
    react: { useSyncExternalStore(subscribe, snapshot, serverSnapshot) { store = { subscribe, snapshot, serverSnapshot }; return snapshot(); } },
    'react-native': { AccessibilityInfo: {
      addEventListener(name, fn) { assert.equal(name, 'reduceMotionChanged'); nativeListener = fn; subscriptions++; return { remove() { removals++; } }; },
      isReduceMotionEnabled() { reads++; return new Promise((resolve, reject) => queries.push({ resolve, reject })); },
    } },
  });
  mod.useMotionAllowed();
  return { store, queries, emit: value => nativeListener(value), stats: () => ({ reads, removals, subscriptions }) };
}
const flush = () => new Promise(setImmediate);
test('motion is opt-in after preference read; many components share one native listener', async () => {
  const h = preference();
  assert.equal(h.store.snapshot(), false); assert.equal(h.store.serverSnapshot(), false);
  let changes = 0;
  const a = h.store.subscribe(() => changes++), b = h.store.subscribe(() => changes++);
  assert.equal(h.stats().subscriptions, 1); assert.equal(h.stats().reads, 1);
  h.queries[0].resolve(false); await flush();
  assert.equal(h.store.snapshot(), true); assert.equal(changes, 2);
  h.emit(true); assert.equal(h.store.snapshot(), false);
  a(); assert.equal(h.stats().removals, 0); b(); assert.equal(h.stats().removals, 1);
  assert.equal(h.store.snapshot(), false);
});
test('live reduced-motion changes win over a stale asynchronous initial read', async () => {
  const h = preference(), close = h.store.subscribe(() => {});
  h.emit(true); h.queries[0].resolve(false); await flush();
  assert.equal(h.store.snapshot(), false);
  h.emit(false); assert.equal(h.store.snapshot(), true); close();
});
test('failed reads and old subscriptions cannot enable motion after unmount', async () => {
  const h = preference(), a = h.store.subscribe(() => {}); a();
  const b = h.store.subscribe(() => {});
  h.queries[0].resolve(false); h.queries[1].reject(Error('unavailable')); await flush();
  assert.equal(h.store.snapshot(), false); b();
});
function nativeHarness(name, initialProps = {}, allowed = true) {
  const slots = [], effects = [], animations = [], values = [];
  let cursor = 0, props = initialProps, tree;
  const equal = (a, b) => a?.length === b?.length && a.every((v, i) => Object.is(v, b[i]));
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, ...(children.length ? { children } : {}) } }),
    forwardRef: render => props => render(props, 'forwarded-ref'),
    useRef(value) { return slots[cursor++] ??= { current: value }; },
    useState(initial) { const i = cursor++; slots[i] ??= { value: initial }; return [slots[i].value, value => { slots[i].value = value; }]; },
    useEffect(fn, deps) { const i = cursor++; slots[i] ??= {}; const slot = slots[i];
      if (!equal(slot.deps, deps)) effects.push(() => { slot.cleanup?.(); slot.deps = deps; slot.cleanup = fn(); }); },
  };
  class Value {
    constructor(initial) { this.value = initial; this.stops = 0; values.push(this); }
    stopAnimation() { this.stops++; }
    setValue(value) { this.value = value; }
    interpolate(config) { return { value: this, config }; }
  }
  function flatten(style) { return Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style || {}; }
  const mod = load('src/components/motion.tsx', {
    react: React, '@/lib/motionPreference': { useMotionAllowed: () => allowed },
    'react-native': { Pressable: 'Pressable', View: 'View', Easing: { cubic: 'cubic', out: value => value }, StyleSheet: { flatten },
      Animated: { Value, View: 'AnimatedView', Text: 'AnimatedText', createAnimatedComponent: type => type,
        timing(value, config) { return { start() { animations.push(config); value.setValue(config.toValue); } }; },
      },
    },
  });
  function render() { cursor = 0; tree = mod[name](props); while (effects.length) effects.shift()(); return tree; }
  render();
  return { render, tree: () => tree, animations, values, flatten,
    update(next) { props = { ...props, ...next }; return render(); },
    reduce(value) { allowed = !value; return render(); },
    close() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
test('press feedback preserves handlers, ref, accessibility and existing transforms without delaying actions', () => {
  let presses = 0, starts = 0, ends = 0;
  const h = nativeHarness('MotionPressable', { accessibilityLabel: 'Save', accessibilityState: { busy: true },
    style: ({ pressed, hovered }) => ({ opacity: pressed ? 0.7 : 1, backgroundColor: hovered ? 'red' : 'white', transform: [{ translateX: 5 }] }),
    onPress: () => presses++, onPressIn: () => starts++, onPressOut: () => ends++, children: 'Save',
  });
  const original = h.tree();
  assert.equal(original.props.ref, 'forwarded-ref'); assert.equal(original.props.accessibilityLabel, 'Save');
  assert.equal(original.props.accessibilityState.busy, true);
  original.props.onPressIn({}); h.render(); h.tree().props.onPress({});
  assert.equal(presses, 1); assert.equal(starts, 1); assert.equal(h.values[0].value, 0.98);
  assert.equal(h.flatten(h.tree().props.style).opacity, 0.7);
  assert.equal(h.flatten(h.tree().props.style).transform[0].translateX, 5);
  h.tree().props.onPressOut({}); h.render(); assert.equal(ends, 1); assert.equal(h.values[0].value, 1);
  h.tree().props.onHoverIn({}); h.render(); assert.equal(h.flatten(h.tree().props.style).backgroundColor, 'red');
  h.tree().props.onHoverOut({}); h.render(); assert.equal(h.flatten(h.tree().props.style).backgroundColor, 'white');
  assert.ok(h.animations.every(a => a.useNativeDriver && !a.isInteraction && a.duration <= 160));
  h.close();
});
test('rapid press/release cancels previous motion; disabled and reduced motion stay at rest', () => {
  const h = nativeHarness('MotionPressable');
  for (let i = 0; i < 8; i++) { h.tree().props.onPressIn({}); h.tree().props.onPressOut({}); }
  assert.equal(h.values[0].value, 1); assert.ok(h.values[0].stops >= 16);
  h.tree().props.onPressIn({}); h.reduce(true); assert.equal(h.values[0].value, 1);
  const before = h.animations.length;
  h.tree().props.onPressIn({}); h.tree().props.onPressOut({}); assert.equal(h.values[0].value, 1);
  assert.equal(h.animations.length, before);
  h.reduce(false); h.tree().props.onPressIn({}); h.update({ disabled: true });
  assert.equal(h.values[0].value, 1); const disabledCount = h.animations.length;
  h.tree().props.onPressIn({}); assert.equal(h.animations.length, disabledCount);
  assert.equal(h.tree().props.disabled, true); h.close();
});
test('reveal fades once, never replays after preference changes and preserves layout props', () => {
  const h = nativeHarness('MotionReveal', { pointerEvents: 'none', children: '4', style: { position: 'absolute' } });
  assert.equal(h.values[0].value, 1); assert.equal(h.animations.length, 1);
  assert.equal(h.tree().props.pointerEvents, 'none'); assert.equal(h.flatten(h.tree().props.style).position, 'absolute');
  h.reduce(true); h.reduce(false); assert.equal(h.animations.length, 1); h.close();
  const staticView = nativeHarness('MotionReveal', {}, false);
  assert.equal(staticView.values[0].value, 1); assert.equal(staticView.animations.length, 0);
  staticView.reduce(false); assert.equal(staticView.animations.length, 0); staticView.close();
});
test('selection and chevron reach the current state immediately with reduced motion', () => {
  for (const [name, key] of [['MotionSelection', 'active'], ['MotionChevron', 'expanded']]) {
    const h = nativeHarness(name, { [key]: false }); h.update({ [key]: true });
    assert.equal(h.values[0].value, 1); h.reduce(true);
    const before = h.animations.length; h.update({ [key]: false });
    assert.equal(h.values[0].value, 0); assert.equal(h.animations.length, before);
    if (name === 'MotionChevron') assert.equal(h.tree().props.accessible, false);
    h.close();
  }
});
