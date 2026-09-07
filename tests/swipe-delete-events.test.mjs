import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../app/components/swipe-delete.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
} }).outputText;

// Exercise the real component callbacks without a browser, DOM or live data.
// This minimal hook host is not a substitute for browser/gesture integration QA.
function mountSwipe() {
  const slots = [];
  let cursor = 0, captures = false, deletions = 0;
  const state = (initial) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial;
    return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
  };
  const hooks = { useState: state, useRef: (initial) => state({ current: initial })[0], useId: () => "swipe-test", useEffect() {} };
  const jsx = (type, props) => ({ type, props });
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports,
    require: (name) => name === "react" ? hooks : name === "react/jsx-runtime" ? { jsx, jsxs: jsx } : {},
    document: { dispatchEvent() {} },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    performance: { now: () => 1000 },
  });
  function render() { cursor = 0; return module.exports.SwipeDelete({ children: "card", onDelete: () => deletions++ }); }
  const pointer = (x, y = 0, pointerType = "mouse") => ({
    pointerId: 1, pointerType, isPrimary: true, button: 0, clientX: x, clientY: y,
    target: { closest: () => null }, preventDefault() {},
    currentTarget: {
      setPointerCapture() { captures = true; }, hasPointerCapture: () => captures,
      releasePointerCapture() { captures = false; },
    },
  });
  const content = () => render().props.children[1].props;
  const offset = () => render().props.style["--swipe-offset"];
  function swipe(dx, pointerType = "mouse", cancelled = false) {
    content().onPointerDown(pointer(200, 80, pointerType));
    content().onPointerMove(pointer(200 + dx, 80, pointerType));
    const event = pointer(200 + dx, 80, pointerType);
    if (cancelled) content().onPointerCancel(event); else content().onPointerUp(event);
    content().onLostPointerCapture(event);
  }
  function click() {
    let prevented = false, stopped = false;
    content().onClickCapture({ detail: 1, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
    return { prevented, stopped };
  }
  return { render, pointer, content, offset, swipe, click, deletions: () => deletions };
}

test("completed mouse and touch swipes stay open after the generated click", () => {
  for (const type of ["mouse", "touch"]) {
    const row = mountSwipe();
    row.swipe(-120, type);
    assert.equal(row.offset(), "-88px");
    assert.deepEqual(row.click(), { prevented: true, stopped: true });
    assert.equal(row.offset(), "-88px", "the drag-end click must not hide the delete action");
    assert.match(row.render().props.className, /is-open/);
    assert.equal(row.deletions(), 0, "swiping never deletes");
  }
});

test("a fresh tap closes an open row, while a closed row still opens its details", () => {
  const row = mountSwipe();
  row.swipe(-120);
  // Also cover browsers which emit no click at the end of a drag.
  row.content().onPointerDown(row.pointer(100));
  row.content().onPointerUp(row.pointer(100));
  assert.equal(row.click().prevented, true);
  assert.equal(row.offset(), "0px");
  row.content().onPointerDown(row.pointer(100));
  row.content().onPointerUp(row.pointer(100));
  assert.deepEqual(row.click(), { prevented: false, stopped: false });
});

test("swiping right closes, and short or cancelled swipes do not open the action", () => {
  const row = mountSwipe();
  row.swipe(-120); row.click();
  row.swipe(120); row.click();
  assert.equal(row.offset(), "0px");
  row.swipe(-20); row.click();
  assert.equal(row.offset(), "0px");
  row.swipe(-120, "touch", true); row.click();
  assert.equal(row.offset(), "0px");
  assert.equal(row.deletions(), 0);
});

test("the exposed delete action stays clickable and triggers confirmation once", () => {
  const row = mountSwipe();
  row.swipe(-120); row.click();
  const action = row.render().props.children[0].props;
  assert.equal(action["aria-hidden"], false);
  assert.equal(action.tabIndex, 0);
  action.onClick();
  assert.equal(row.deletions(), 1);
  assert.equal(row.offset(), "0px");
});
