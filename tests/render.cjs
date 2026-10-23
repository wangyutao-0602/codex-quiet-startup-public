const fs = require("fs");
fs.mkdirSync(".build/render-check", { recursive: true });
const vm = require("vm"),
  assert = require("assert/strict");
const { createCanvas, Image } = require("@napi-rs/canvas");
const nodes = new Map(),
  events = {},
  frames = new Map();
let id = 0;
function node(key) {
  if (nodes.has(key)) return nodes.get(key);
  const e = {
    dataset: {},
    style: {},
    value: 0,
    textContent: "",
    hidden: false,
    open: false,
    classList: { add() {}, remove() {} },
    addEventListener(type, fn) {
      this[type] = fn;
    },
    getBoundingClientRect() {
      return { width: 1150, height: 718.75 };
    },
    showModal() {
      this.open = true;
    },
    close(v) {
      this.open = false;
      this.returnValue = v;
      this.closeEvent?.();
    },
    disabled: false,
  };
  nodes.set(key, e);
  return e;
}
const canvas = createCanvas(2300, 1438);
Object.assign(canvas, node("#stage"));
nodes.set("#stage", canvas);
canvas.getBoundingClientRect = () => ({ width: 1150, height: 718.75 });
const characterDraws = [];
const renderContext = canvas.getContext("2d");
const originalDrawImage = renderContext.drawImage.bind(renderContext);
renderContext.drawImage = (...args) => {
  if (args[0] instanceof Image) characterDraws.push(args);
  originalDrawImage(...args);
};
const document = {
  querySelector: node,
  body: node("body"),
  createElement(tag) {
    if (tag === "canvas") return createCanvas(1, 1);
    return node(tag);
  },
  addEventListener(type, fn) {
    events[type] = fn;
  },
};
const window = {
  document,
  Image,
  devicePixelRatio: 2,
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  ResizeObserver: class {
    observe() {}
    disconnect() {}
  },
  setTimeout,
  clearTimeout,
  requestAnimationFrame(fn) {
    frames.set(++id, fn);
    return id;
  },
  cancelAnimationFrame(i) {
    frames.delete(i);
  },
  addEventListener(type, fn) {
    events[type] = fn;
  },
  webkit: {
    messageHandlers: {
      launcher: {
        postMessage(a) {
          events.messages.push(a);
        },
      },
    },
  },
};
events.messages = [];
const context = {
  window,
  document,
  Image,
  URL,
  console,
  Uint8Array,
  Uint8ClampedArray,
  Float32Array,
  setTimeout,
  clearTimeout,
};
vm.runInNewContext(fs.readFileSync("image-settings.js", "utf8"), context);
vm.runInNewContext(fs.readFileSync("animation.js", "utf8"), context);
function advance(time) {
  const list = [...frames.values()];
  frames.clear();
  for (const f of list) f(time);
}
(async () => {
  for (let n = 0; n < 400 && !events.messages.includes("ready"); n++)
    await new Promise((r) => setTimeout(r, 20));
  assert.ok(events.messages.includes("ready"), "ready received");
  assert.ok(+canvas.dataset.paths > 0, "real asset paths");
  console.log("PATHS", canvas.dataset.paths);
  for (const t of [0.6, 2.2, 4.2, 6.18, 6.5, 7.3, 7.6, 7.85, 8.5]) {
    node("#timeline").oninput({ target: { value: t } });
    fs.writeFileSync(
      `.build/render-check/frame-${t}.png`,
      canvas.toBuffer("image/png"),
    );
    assert.equal(node(".window").dataset.elapsed, t.toFixed(3));
  }
  let staticDraw;
  for (const time of [6.18, 7.3, 7.6, 7.85, 8.5]) {
    characterDraws.length = 0;
    node("#timeline").oninput({target:{value:time}});
    assert.equal(canvas.dataset.motionEngine, "static");
    assert.equal(canvas.dataset.elbowAngle, undefined);
    assert.equal(canvas.dataset.wristAngle, undefined);
    assert.equal(characterDraws.length, 1);
    if (staticDraw) assert.deepEqual(characterDraws[0], staticDraw, "character image and placement remain identical");
    staticDraw = characterDraws[0];
  }
  window.launcherUI.beginLaunch();
  advance(100);
  for (let t = 200; t <= 8600; t += 100) advance(t);
  assert.equal(node(".scene").style.opacity, "1", "native splash stays opaque before handoff");
  assert.ok(!events.messages.includes("reveal"), "no early Codex reveal");
  assert.ok(!events.messages.includes("complete"), "handoff waits for completion");
  for (let t = 8700; t < 9400; t += 100) advance(t);
  assert.equal(node(".window").dataset.completed, "true");
  assert.equal(frames.size, 0);
  assert.ok(
    !events.messages.includes("reveal") && events.messages.includes("complete"),
  );
  console.log(
    "PASS real PNG decode, extraction, five-phase Canvas rendering, native bridge, completion and stopped rAF",
  );
  console.log("MESSAGES", events.messages.join(","));
})();
