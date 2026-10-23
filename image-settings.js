/* Local image import and one-time contour tracing. No network or app privileges. */
(function (scope) {
  "use strict";
  function vectorize(rgba, width, height) {
    const count = width * height,
      gray = new Float32Array(count),
      mag = new Float32Array(count),
      angle = new Uint8Array(count),
      edge = new Uint8Array(count);
    for (let i = 0; i < count; i++)
      gray[i] =
        ((rgba[i * 4] * 0.299 +
          rgba[i * 4 + 1] * 0.587 +
          rgba[i * 4 + 2] * 0.114) *
          rgba[i * 4 + 3]) /
        255;
    for (let y = 1; y < height - 1; y++)
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        const gx =
          -gray[i - width - 1] +
          gray[i - width + 1] -
          2 * gray[i - 1] +
          2 * gray[i + 1] -
          gray[i + width - 1] +
          gray[i + width + 1];
        const gy =
          -gray[i - width - 1] -
          2 * gray[i - width] -
          gray[i - width + 1] +
          gray[i + width - 1] +
          2 * gray[i + width] +
          gray[i + width + 1];
        mag[i] = Math.hypot(gx, gy);
        const a = ((Math.atan2(gy, gx) * 180) / Math.PI + 180) % 180;
        angle[i] =
          a < 22.5 || a >= 157.5 ? 0 : a < 67.5 ? 1 : a < 112.5 ? 2 : 3;
      }
    const pairs = [
      [1, -1],
      [width + 1, -width - 1],
      [width, -width],
      [width - 1, -width + 1],
    ];
    for (let y = 2; y < height - 2; y++)
      for (let x = 2; x < width - 2; x++) {
        const i = y * width + x,
          [a, b] = pairs[angle[i]];
        if (mag[i] > 32 && mag[i] >= mag[i + a] && mag[i] > mag[i + b])
          edge[i] = 1;
      }
    const neighbors = [
      -width - 1,
      -width,
      -width + 1,
      -1,
      1,
      width - 1,
      width,
      width + 1,
    ];
    const visited = new Uint8Array(count),
      paths = [];
    function walk(start) {
      let current = start,
        previous = -1;
      const points = [];
      while (current >= 0 && !visited[current]) {
        visited[current] = 1;
        points.push([current % width, Math.floor(current / width)]);
        let next = -1,
          best = -Infinity;
        for (const d of neighbors) {
          const n = current + d;
          if (n < 0 || n >= count || !edge[n] || visited[n]) continue;
          const dx = (n % width) - (current % width),
            dy = Math.floor(n / width) - Math.floor(current / width);
          const score =
            previous < 0
              ? mag[n]
              : dx * ((current % width) - (previous % width)) +
                dy *
                  (Math.floor(current / width) - Math.floor(previous / width));
          if (score > best) {
            best = score;
            next = n;
          }
        }
        previous = current;
        current = next;
      }
      if (points.length >= 8)
        paths.push(
          points
            .filter((_, i) => i % 2 === 0 || i === points.length - 1)
            .map(([x, y]) => [x / width, y / height]),
        );
    }
    // Start at endpoints first, then trace the remaining closed loops.
    for (let i = 0; i < count; i++)
      if (
        edge[i] &&
        !visited[i] &&
        neighbors.reduce((n, d) => n + (edge[i + d] || 0), 0) <= 1
      )
        walk(i);
    for (let i = 0; i < count; i++) if (edge[i] && !visited[i]) walk(i);
    return paths
      .sort((a, b) => b.length - a.length)
      .slice(0, 500)
      .map((p) => (p[0][1] > p[p.length - 1][1] ? p.reverse() : p))
      .sort(
        (a, b) =>
          Math.min(...a.map((p) => p[1])) - Math.min(...b.map((p) => p[1])),
      );
  }
  const defaults = {
    duration: 9,
    particles: 340,
    glow: 0.6,
    fps: 60,
    motion: "full",
    initialText: "INITIALIZING CODEX",
    welcomeText: "WELCOME BACK",
    onlineText: "CODEX SYSTEM ONLINE",
  };
  function normalize(value = {}) {
    const s = { ...defaults, ...value };
    for (const [k, min, max] of [
      ["duration", 5, 15],
      ["particles", 80, 600],
      ["glow", 0, 1],
    ])
      s[k] = Math.max(
        min,
        Math.min(max, Number.isFinite(+s[k]) ? +s[k] : defaults[k]),
      );
    s.fps = +s.fps === 30 ? 30 : 60;
    s.motion = ["auto", "full", "reduce"].includes(s.motion)
      ? s.motion
      : "auto";
    for (const key of ["initialText", "welcomeText", "onlineText"])
      s[key] = String(s[key]).slice(0, 64);
    for (const key of ["character", "background"])
      if (s[key] && !/^data:image\/(png|jpeg|webp);base64,/.test(s[key]))
        delete s[key];
    return s;
  }
  if (typeof module !== "undefined") {
    module.exports = { vectorize, normalize, defaults };
    return;
  }
  function database(value) {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open("codex-quiet-startup", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("settings");
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const db = r.result,
          tx = db.transaction(
            "settings",
            value === undefined ? "readonly" : "readwrite",
          ),
          store = tx.objectStore("settings"),
          req =
            value === undefined
              ? store.get("config")
              : store.put(value, "config");
        tx.oncomplete = () => {
          db.close();
          resolve(value === undefined ? normalize(req.result) : value);
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          reject(tx.error || Error("存储不可用"));
        };
      };
    });
  }
  async function importImage(file) {
    if (file.size > 20 * 1024 * 1024) throw Error("请选择小于 20 MB 的图片");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
      throw Error("仅支持 PNG / JPEG / WebP");
    const url = URL.createObjectURL(file),
      img = new Image();
    try {
      img.src = url;
      await img.decode();
      if (img.width * img.height > 40000000) throw Error("图片像素过大");
      const c = document.createElement("canvas"),
        scale = Math.min(1, 1536 / Math.max(img.width, img.height));
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL("image/png");
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  scope.imageSettings = {
    defaults,
    normalize,
    vectorize,
    load: () => database(),
    save: (s) => database(normalize(s)),
    importImage,
  };
})(typeof window === "undefined" ? {} : window);
