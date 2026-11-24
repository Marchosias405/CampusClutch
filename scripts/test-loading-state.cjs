/* global __dirname */
// Test real loading components at their native animation/navigation boundaries.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/components/LoadingState.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children);
function harness(component = 'LoadingSkeleton', props = { variant: 'courses', label: 'Loading courses' }, options = {}) {
  const slots = [], effects = [], loops = [], configs = [], values = [], listeners = new Map(), navListeners = new Map();
  let cursor = 0, dirty = true, tree, allowed = options.allowed ?? true, focused = options.focused ?? true;
  const same = (a, b) => a?.length === b?.length && a.every((v, i) => Object.is(v, b[i]));
  function listen(map, name, fn) { if (!map.has(name)) map.set(name, new Set()); map.get(name).add(fn); return () => map.get(name).delete(fn); }
  const navigation = options.outsideNavigator ? undefined : {
    isFocused: () => focused, addListener: (name, fn) => listen(navListeners, name, fn),
  };
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, ...(children.length ? { children } : {}) } }),
    useContext: () => navigation,
    useRef(value) { return slots[cursor++] ??= { current: value }; },
    useState(initial) { const i = cursor++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, value => { if (value !== slots[i].value) { slots[i].value = value; dirty = true; } }]; },
    useEffect(fn, deps) { const i = cursor++; slots[i] ??= {}; const slot = slots[i];
      if (!same(slot.deps, deps)) effects.push(() => { slot.cleanup?.(); slot.deps = deps; slot.cleanup = fn(); }); },
  };
  class Value {
    constructor(initial) { this.value = initial; this.stops = 0; values.push(this); }
    stopAnimation() { this.stops++; }
    setValue(value) { this.value = value; }
    interpolate(config) { return { value: this, config }; }
  }
  const appState = { currentState: 'appState' in options ? options.appState : 'active', addEventListener(name, fn) { return { remove: listen(listeners, name, fn) }; } };
  const modules = {
    react: React, '@expo/vector-icons': { Ionicons: 'Icon' }, '@react-navigation/native': { NavigationContext: 'NavigationContext' },
    '@/lib/motionPreference': { useMotionAllowed: () => allowed },
    'react-native': { AppState: appState, Platform: { OS: 'android' }, Easing: { linear: 'linear' }, StyleSheet: { create: value => value }, Text: 'Text', View: 'View',
      Animated: { Value, View: 'AnimatedView', timing(value, config) { configs.push(config); return { value, config }; },
        loop(animation) { const loop = { animation, started: false, stopped: false, start() { this.started = true; }, stop() { this.stopped = true; } }; loops.push(loop); return loop; },
      },
    },
  };
  const exports = {};
  vm.runInNewContext(source, { exports, require(name) { assert.ok(name in modules, name); return modules[name]; } });
  function expand(node) {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(expand);
    if (typeof node.type === 'function') return expand(node.type(node.props));
    return { ...node, props: { ...node.props, children: expand(node.props.children) } };
  }
  function render() {
    let rounds = 0;
    do { assert.ok(++rounds < 10, 'render settles'); dirty = false; cursor = 0; tree = expand(exports[component](props));
      while (effects.length) effects.shift()();
    } while (dirty);
    return tree;
  }
  render();
  return { tree: () => tree, nodes: () => nodes(tree), values, loops, configs,
    activeLoops: () => loops.filter(loop => loop.started && !loop.stopped).length,
    reduce(reduced) { allowed = !reduced; render(); },
    state(next) { appState.currentState = next; listeners.get('change')?.forEach(fn => fn(next)); render(); },
    nativeEvent(name) { listeners.get(name)?.forEach(fn => fn()); render(); },
    focus(next) { focused = next; navListeners.get(next ? 'focus' : 'blur')?.forEach(fn => fn()); render(); },
    update(next) { props = { ...props, ...next }; render(); },
    close() { slots.forEach(slot => slot?.cleanup?.()); },
    listeners: () => [...listeners.values(), ...navListeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
}
test('a skeleton group uses one native nonblocking loop, regardless of row count', () => {
  const h = harness('LoadingSkeleton', { variant: 'courses', label: 'Loading courses', rows: 5 });
  assert.equal(h.activeLoops(), 1); assert.equal(h.configs.length, 1);
  assert.equal(h.configs[0].useNativeDriver, true); assert.equal(h.configs[0].isInteraction, false);
  assert.equal(h.configs[0].duration, 1800);
  h.update({ rows: 2 }); assert.equal(h.activeLoops(), 1); assert.equal(h.loops.length, 1);
  h.close(); assert.equal(h.activeLoops(), 0); assert.equal(h.listeners(), 0);
});
test('Reduce Motion, hidden screens, background and Android notification shade pause loading loops', () => {
  const h = harness();
  h.reduce(true); assert.equal(h.activeLoops(), 0); assert.equal(h.values[0].value, 0.5);
  h.reduce(false); assert.equal(h.activeLoops(), 1);
  h.focus(false); assert.equal(h.activeLoops(), 0);
  h.state('background'); h.focus(true); assert.equal(h.activeLoops(), 0);
  h.state('active'); assert.equal(h.activeLoops(), 1);
  h.nativeEvent('blur'); assert.equal(h.activeLoops(), 0);
  h.nativeEvent('focus'); assert.equal(h.activeLoops(), 1);
  h.state('inactive'); assert.equal(h.activeLoops(), 0);
  h.close(); assert.equal(h.listeners(), 0);
});
test('unknown app state and reduced motion start static; startup buffers work outside a navigator', () => {
  const h = harness('LoadingState', { title: 'Opening CampusClutch', fullScreen: true }, { outsideNavigator: true, appState: null });
  assert.equal(h.activeLoops(), 0); assert.equal(h.values[0].value, 0.5);
  h.state('active'); assert.equal(h.activeLoops(), 1);
  h.reduce(true); assert.equal(h.activeLoops(), 0); assert.match(text(h.tree()), /Opening CampusClutch/); h.close();
  const staticLoader = harness('LoadingNotice', { label: 'Refreshing courses' }, { allowed: false });
  assert.equal(staticLoader.activeLoops(), 0); assert.equal(staticLoader.values[0].value, 0.5); staticLoader.close();
});
test('each variant exposes one honest loading status, no fake controls, data or percentage', () => {
  for (const variant of ['courses', 'requests', 'people', 'inbox', 'conversation', 'profile', 'reviews', 'points', 'interests', 'details']) {
    const h = harness('LoadingSkeleton', { variant, label: 'Loading fixture' });
    const statuses = h.nodes().filter(node => node.props.accessibilityRole === 'progressbar');
    assert.equal(statuses.length, 1, variant); assert.equal(statuses[0].props.accessibilityLabel, 'Loading fixture');
    assert.equal(statuses[0].props.accessibilityState.busy, true); assert.equal(statuses[0].props.accessibilityValue, undefined);
    assert.equal(statuses[0].props.pointerEvents, 'none'); assert.equal(text(h.tree()), 'Loading fixture');
    assert.ok(!h.nodes().some(node => node.props.onPress || node.props.onChangeText || node.type === 'TextInput'));
    assert.ok(h.nodes().some(node => node.props.importantForAccessibility === 'no-hide-descendants'));
    h.close();
  }
});
test('placeholder row count is bounded and loading does not create timers or defer children', () => {
  const one = harness('LoadingSkeleton', { variant: 'people', label: 'Loading', rows: 1 });
  const huge = harness('LoadingSkeleton', { variant: 'people', label: 'Loading', rows: 999 });
  const five = harness('LoadingSkeleton', { variant: 'people', label: 'Loading', rows: 5 });
  assert.equal(huge.nodes().length, five.nodes().length); assert.ok(one.nodes().length < five.nodes().length);
  for (const h of [one, huge, five]) h.close();
});
test('waiting text stays visible through motion changes and each component cleans up on repeated mounts', () => {
  for (const [component, props] of [['LoadingState', { title: 'Checking access', detail: 'This may take a moment.' }], ['LoadingNotice', { label: 'Saving changes' }]]) {
    for (let i = 0; i < 3; i++) {
      const h = harness(component, props), before = text(h.tree()); h.reduce(true);
      assert.equal(text(h.tree()), before); assert.equal(h.tree().props.accessibilityState.busy, true);
      assert.equal(h.tree().props.accessibilityValue, undefined); h.close(); assert.equal(h.activeLoops(), 0); assert.equal(h.listeners(), 0);
    }
  }
});
