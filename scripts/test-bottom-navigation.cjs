/* global __dirname */
// Exercise production tab configuration and label layout feedback without a device.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/app/(tabs)/_layout.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const createElement = (type, props, ...children) => ({ type, props: { ...props, children } });
const routes = ['index', 'courses', 'requests', 'messages', 'profile'];
const names = ['Home', 'Courses', 'Requests', 'Messages', 'Profile'];

function harness() {
  const state = { width: 320, fontScale: 1, bottom: 0, left: 0, right: 0, unread: 0 };
  let measured;
  const modules = {
    '@/components/motion': require('./motion-test-mock.cjs'),
    react: { createElement, useState(initial) {
      measured ??= initial;
      return [measured, update => { measured = typeof update === 'function' ? update(measured) : update; }];
    } },
    '@expo/vector-icons': { Ionicons: 'Ionicons' },
    'expo-router': { Tabs: { Screen: 'Screen' } },
    'react-native': { Text: 'Text', useWindowDimensions: () => state },
    'react-native-safe-area-context': { useSafeAreaInsets: () => state },
    '../../context/UnreadMessagesContext': { useUnreadMessages: () => ({ unreadCount: state.unread }) },
  };
  const exports = {};
  vm.runInNewContext(source, { exports, require(name) {
    assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name];
  } });
  const render = () => exports.default();
  const labels = tree => tree.props.children.map(tab => tree.props.screenOptions.tabBarLabel({
    color: '#9B1C31', children: tab.props.options.title, focused: false, position: 'below-icon',
  }));
  return { state, render, labels };
}

test('all five destinations retain their full labels and native tab navigation', () => {
  const app = harness();
  for (const width of [320, 414, 800]) {
    for (const fontScale of [1, 1.5, 2]) {
      Object.assign(app.state, { width, fontScale });
      const tree = app.render(), options = tree.props.screenOptions;
      assert.deepEqual(tree.props.children.map(tab => tab.props.name), routes);
      assert.equal(tree.props.initialRouteName, 'index');
      assert.equal(options.tabBar, undefined, 'Keep the library tab navigator');
      assert.notEqual(options.tabBarAllowFontScaling, false);
      assert.equal(options.tabBarLabelPosition, 'below-icon');
      assert.deepEqual(app.labels(tree).map(label => label.props.children.join('')), names);
      for (const label of app.labels(tree)) {
        assert.notEqual(label.props.allowFontScaling, false);
        assert.equal(label.props.numberOfLines, undefined, 'Long names must not be ellipsized');
        assert.notEqual(label.props.adjustsFontSizeToFit, true, 'Large text must not be shrunk to fit');
        assert.equal(label.props.style.color, '#9B1C31');
      }
      for (const tab of tree.props.children) {
        assert.equal(tab.props.options.href, undefined);
        assert.equal(tab.props.options.tabBarButton, undefined, 'Keep press/long-press/focus behavior');
        assert.ok(tab.props.options.tabBarIcon({ color: 'fixture', size: 25 }));
      }
    }
  }
});

test('larger text and safe-area changes reserve space, and actual taller labels expand the bar', () => {
  const app = harness(), normal = app.render().props.screenOptions.tabBarStyle.height;
  app.state.fontScale = 2;
  const large = app.render(), largeHeight = large.props.screenOptions.tabBarStyle.height;
  assert.ok(largeHeight > normal, 'Wrapping large text needs more vertical room');
  const messageLabel = app.labels(large)[3];
  messageLabel.props.onLayout({ nativeEvent: { layout: { height: 100 } } });
  const measured = app.render().props.screenOptions.tabBarStyle.height;
  assert.ok(measured > largeHeight, 'Do not clip fonts taller than the initial estimate');
  app.state.bottom = 34;
  const inset = app.render().props.screenOptions.tabBarStyle;
  assert.ok(inset.paddingBottom >= 34);
  assert.ok(inset.height > measured, 'Safe area must add space instead of stealing label space');
  Object.assign(app.state, { width: 800, fontScale: 1, bottom: 0 });
  assert.ok(app.render().props.screenOptions.tabBarStyle.height < measured,
    'Stale measurements from another width/font scale must not leave an oversized bar');
});

test('unread changes retain exact accessibility counts and the 99+ visual cap at large text', () => {
  const app = harness(); app.state.fontScale = 2;
  for (const [unread, badge] of [[0, undefined], [1, 1], [99, 99], [100, '99+'], [347, '99+'], [0, undefined]]) {
    app.state.unread = unread;
    const tree = app.render(), options = tree.props.children[3].props.options;
    assert.equal(options.tabBarBadge, badge);
    assert.equal(options.tabBarAccessibilityLabel, unread ? `Messages, ${unread} unread messages` : 'Messages');
    assert.equal(tree.props.children.filter(tab => tab.props.options.tabBarBadge !== undefined).length, unread ? 1 : 0);
  }
  const largeBadge = app.render().props.screenOptions.tabBarBadgeStyle;
  app.state.fontScale = 1;
  const normalBadge = app.render().props.screenOptions.tabBarBadgeStyle;
  assert.ok(largeBadge.height > normalBadge.height, 'Badge background must grow with its native text');
  assert.ok(largeBadge.minWidth >= largeBadge.height);
});

test('the 99+ badge gets enough horizontal room without spilling into neighboring tabs', () => {
  const app = harness();
  for (const fontScale of [1, 1.5, 2]) {
    Object.assign(app.state, { fontScale, unread: 1 });
    const single = app.render().props.screenOptions.tabBarBadgeStyle;
    app.state.unread = 347;
    const options = app.render().props.screenOptions, badge = options.tabBarBadgeStyle;
    assert.ok(badge.width > single.width, 'The capped three-character count must be wider than one digit');
    assert.ok(options.tabBarIconStyle.width >= badge.width,
      'Native Badge layout is constrained by its icon wrapper');
    assert.ok(options.tabBarIconStyle.width <= app.state.width / routes.length,
      'Keep the full badge inside its own tab at 320dp');
    assert.ok(badge.end >= 0, 'Do not offset the enlarged badge into another tab');
  }
});
