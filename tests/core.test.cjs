const { test } = require("node:test");
const assert = require("node:assert/strict");
const { vectorize, normalize } = require("../image-settings.js");
test("参数校验约束时长、粒子、动态效果与图片 URL", () => {
  const s = normalize({
    duration: 99,
    particles: -5,
    glow: "bad",
    fps: 10,
    motion: "bad",
    character: "https://example.com/x.png",
  });
  assert.equal(s.duration, 15);
  assert.equal(s.particles, 80);
  assert.equal(s.glow, 0.6);
  assert.equal(s.fps, 60);
  assert.equal(s.motion, "auto");
  assert.equal(s.character, undefined);
});
test("透明空图不产生伪轮廓", () => {
  assert.deepEqual(vectorize(new Uint8ClampedArray(64 * 64 * 4), 64, 64), []);
});
test("实际边缘提取归一化坐标且有连接路径", () => {
  const w = 80,
    h = 100,
    a = new Uint8ClampedArray(w * h * 4);
  for (let y = 15; y < 85; y++)
    for (let x = 20; x < 60; x++) {
      const i = (y * w + x) * 4;
      a[i] = a[i + 1] = a[i + 2] = a[i + 3] = 255;
    }
  const paths = vectorize(a, w, h);
  assert.ok(paths.length > 0);
  for (const path of paths)
    for (const [x, y] of path) {
      assert.ok(x >= 0 && x <= 1 && y >= 0 && y <= 1);
    }
  assert.ok(paths.some((p) => p.length > 10));
});
