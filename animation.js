/* Quiet Intelligence. Same normalized image coordinates for raster, paths and tracers. */
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s),
    api = window.imageSettings,
    canvas = $("#stage"),
    ctx = canvas.getContext("2d"),
    box = $(".window"),
    scene = $(".scene"),
    dialog = $("#settings-dialog");
  const embedded = !!window.AEMEATH_EXTERNAL,
    native = !!window.webkit?.messageHandlers?.launcher;
  if (embedded) document.body.classList.add("embedded");
  const send = (action, details = {}) => {
    if (native) window.webkit.messageHandlers.launcher.postMessage(action);
    if (embedded)
      window.AEMEATH_SEND({ type: "aemeath-boot", action, ...details });
  };
  let config = api.normalize(),
    pending,
    character = null,
    background = null,
    paths = [],
    points = [],
    stars = [],
    particles = [],
    w = 0,
    h = 0,
    elapsed = 0,
    playing = false,
    done = false,
    raf = 0,
    last = 0,
    drawLast = 0,
    launch = false,
    assetGeneration = 0,
    initialized = false,
    skipPending = false;
  const media = window.matchMedia("(prefers-reduced-motion: reduce)"),
    reduced = () =>
      config.motion === "reduce" || (config.motion === "auto" && media.matches);
  const clamp = (x) => Math.max(0, Math.min(1, x)),
    smooth = (x) => {
      x = clamp(x);
      return x * x * (3 - 2 * x);
    },
    lerp = (a, b, t) => a + (b - a) * t;
  function rng(seed) {
    return () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  }
  function seeds() {
    const r = rng(71);
    stars = Array.from({ length: 90 }, () => ({
      x: r(),
      y: r(),
      a: r(),
      s: r() * 1.3 + 0.3,
    }));
    particles = Array.from({ length: config.particles }, (_, i) => ({
      x: r(),
      y: r(),
      delay: r() * 0.25,
      point: Math.floor(r() * Math.max(1, points.length)),
      speed: r(),
      side: r(),
    }));
  }
  function resize() {
    const rect = canvas.getBoundingClientRect();
    w = rect.width;
    h = rect.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }
  const ro = new window.ResizeObserver(resize);
  ro.observe(canvas);
  function image(src) {
    return new Promise((resolve, reject) => {
      const img = new Image(),
        timer = window.setTimeout(() => reject(Error("图片加载超时")), 7000);
      img.onload = () => {
        window.clearTimeout(timer);
        resolve(img);
      };
      img.onerror = () => {
        window.clearTimeout(timer);
        reject(Error("图片无法读取"));
      };
      img.src = src;
    });
  }
  async function assets(s) {
    const generation = ++assetGeneration;
    let ch = null,
      bg = null;
    const warnings = [];
    try {
      ch = await image(
        s.character ||
          window.AEMEATH_ASSETS?.character ||
          "assets/character.png",
      );
    } catch {
      warnings.push("人物素材加载失败，使用星环回退动画。");
    }
    if (s.background)
      try {
        bg = await image(s.background);
      } catch {
        warnings.push("背景加载失败，使用默认星空。");
      }
    if (generation !== assetGeneration) return;
    character = ch;
    background = bg;
    paths = [];
    points = [];
    if (ch) {
      const c = document.createElement("canvas"),
        scale = 640 / Math.max(ch.width, ch.height);
      c.width = Math.round(ch.width * scale);
      c.height = Math.round(ch.height * scale);
      const cx = c.getContext("2d", { willReadFrequently: true });
      cx.drawImage(ch, 0, 0, c.width, c.height);
      try {
        paths = api.vectorize(
          cx.getImageData(0, 0, c.width, c.height).data,
          c.width,
          c.height,
        );
      } catch {
        warnings.push("无法提取轮廓，将使用淡入动画。");
      }
      points = paths.flat();
    }
    $("#notice").textContent = warnings.join(" ");
    $("#notice").hidden = !warnings.length;
    seeds();
    canvas.dataset.paths = paths.length;
    canvas.dataset.imageWidth = ch?.width || 0;
  }
  function rect() {
    const ratio = character ? character.width / character.height : 2 / 3;
    const height = h * 0.95,
      width = height * ratio;
    return { x: w * 0.68 - width / 2, y: h * 0.035, width, height };
  }
  function mapped(p, r) {
    return [r.x + p[0] * r.width, r.y + p[1] * r.height];
  }
  function dot(x, y, size, alpha, color = "#90ddf1") {
    ctx.globalAlpha = clamp(alpha);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
  function render() {
    if (!w || !h) return;
    const t = (elapsed / config.duration) * 9,
      reduce = reduced(),
      r = rect();
    // Native launch holds an opaque frame until the host replaces its window.
    const fade = native && launch ? 1 : 1 - smooth((t - 7.5) / 1.5);
    scene.style.opacity = String(fade);
    scene.style.pointerEvents = t >= 9 ? "none" : "";
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    const bg = ctx.createRadialGradient(
      w * 0.65,
      h * 0.45,
      0,
      w * 0.6,
      h * 0.4,
      w * 0.7,
    );
    bg.addColorStop(0, "#18223b");
    bg.addColorStop(0.6, "#0b1222");
    bg.addColorStop(1, "#060a12");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    if (background) {
      ctx.globalAlpha = 0.22;
      const scale = Math.max(w / background.width, h / background.height);
      ctx.drawImage(
        background,
        (w - background.width * scale) / 2,
        (h - background.height * scale) / 2,
        background.width * scale,
        background.height * scale,
      );
      ctx.globalAlpha = 1;
    }
    // Deterministic, low-contrast chemistry field; no per-frame allocations.
    ctx.save();
    ctx.font = `${Math.max(9, h / 70)}px monospace`;
    ctx.fillStyle = "#b7d7e7";
    const formulas = ["H₂O", "C₆H₁₂O₆", "NH₂–CH₂–COOH", "ATP → ADP + Pi", "CO₂", "CH₃COOH", "NAD⁺ ⇌ NADH", "ΔG = ΔH − TΔS", "C₈H₁₀N₄O₂", "H⁺ + OH⁻ ⇌ H₂O"];
    for (let i = 0; i < 126; i++) {
      const x = ((i * 0.6180339 % 1) * (w + 160) + (reduce ? 0 : t * (5 + (i % 5) * 1.6))) % (w + 160) - 80;
      const y = ((i * 0.4142135 % 1) * (h + 50) - (reduce ? 0 : t * (3.2 + (i % 3) * 1.6)) + h + 50) % (h + 50) - 20;
      ctx.globalAlpha = (0.038 + (i % 4) * 0.015) * smooth(t / 1.2);
      ctx.fillText(formulas[i % formulas.length], x, y);
    }
    ctx.restore();
    for (const s of stars)
      dot(
        s.x * w,
        (s.y * h + (reduce ? 0 : t * s.s * 1.5)) % h,
        s.s,
        (0.12 + s.a * 0.35) * smooth(t / 0.8),
      );
    const cx = w * 0.68,
      cy = h * 0.47,
      radius = Math.min(w * 0.25, h * 0.37),
      wake = smooth(t / 1.2);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(reduce ? 0 : t * 0.045);
    ctx.strokeStyle = "#74cfe4";
    ctx.lineWidth = 0.6;
    ctx.globalAlpha = 0.22 * wake;
    for (const n of [1, 0.93, 1.09]) {
      ctx.setLineDash(n === 0.93 ? [2, 9] : []);
      ctx.beginPath();
      ctx.arc(0, 0, radius * n, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.45 * wake;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, 0.55);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, radius, Math.PI, Math.PI + 0.55);
    ctx.stroke();
    ctx.restore();
    if (t < 1.4) dot(cx, cy, 2 + smooth(t) * 3, 1 - smooth((t - 1) / 0.4));
    const reveal = reduce ? smooth(t / 0.9) : smooth((t - 3.1) / 2.5);
    if (character && reveal > 0) {
      ctx.save();
      ctx.globalAlpha = reveal;
      ctx.drawImage(character, r.x, r.y, r.width, r.height);
      canvas.dataset.motionEngine = "static";
      ctx.restore();
    }
    if (!reduce) {
      // Trace entire connected paths in head-to-clothing order; each moving tip is on its path.
      const progress = clamp((t - 3) / 2.5),
        active = progress * (paths.length + 12);
      ctx.save();
      ctx.lineWidth = Math.max(0.65, h / 900);
      ctx.strokeStyle = "#a2e5f5";
      ctx.shadowColor = "#5c9fed";
      ctx.shadowBlur = 8 * config.glow;
      ctx.globalAlpha = (1 - smooth((t - 5.5) / 0.5)) * 0.8;
      for (let i = 0; i < (t < 6.0 ? Math.min(paths.length, Math.ceil(active)) : 0); i++) {
        const path = paths[i],
          fraction = clamp((active - i) / 12),
          count = Math.max(1, Math.floor((path.length - 1) * fraction));
        ctx.beginPath();
        const [x, y] = mapped(path[0], r);
        ctx.moveTo(x, y);
        for (let j = 1; j <= count; j++) {
          const p = mapped(path[j], r);
          ctx.lineTo(...p);
        }
        ctx.stroke();
      }
      ctx.restore();
      if (t >= 1.2 && t < 3.15 && points.length) {
        for (const p of particles) {
          const target = mapped(points[p.point], r),
            q = smooth((t - 1.2 - p.delay) / 1.55);
          const sx = p.side < 0.5 ? (p.side < 0.25 ? -15 : w + 15) : p.x * w,
            sy = p.side >= 0.5 ? (p.side < 0.75 ? -15 : h + 15) : p.y * h;
          dot(
            lerp(sx, target[0], q),
            lerp(sy, target[1], q),
            p.speed + 0.6,
            Math.min(1, (t - 1.2) * 3) * (1 - smooth((t - 3) / 0.15)) * 0.75,
            p.side > 0.5 ? "#b0a2f5" : "#8fe5f2",
          );
        }
      }
      if (t >= 3 && t < 5.5 && paths.length) {
        for (let j = 0; j < 12; j++) {
          const index = Math.floor(active) - j;
          if (index < 0 || index >= paths.length) continue;
          const path = paths[index],
            pos = clamp((active - index) / 12) * (path.length - 1),
            a = Math.floor(pos),
            b = Math.min(path.length - 1, a + 1);
          const pt = [
            lerp(path[a][0], path[b][0], pos - a),
            lerp(path[a][1], path[b][1], pos - a),
          ];
          dot(...mapped(pt, r), 1.7, (1 - j / 12) * 0.95);
        }
      }
      if (t >= 5.5 && t < 7.8) {
        const pulse = smooth((t - 5.5) / 2);
        ctx.globalAlpha = (1 - pulse) * 0.25;
        ctx.strokeStyle = "#8cbbeb";
        ctx.beginPath();
        ctx.ellipse(
          cx,
          cy,
          radius * (1 + pulse * 0.3),
          radius * (1 + pulse * 0.3),
          0,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
        for (const p of particles.slice(0, 60)) {
          if (!points.length) break;
          const pt = mapped(points[p.point], r);
          dot(
            pt[0] + Math.sin(t + p.x * 9) * 5,
            pt[1] - (t - 5.5) * p.speed * 12,
            1,
            0.28 * (1 - pulse),
          );
        }
      }
    }
    ctx.globalAlpha = 1;
    $("#eyebrow").textContent =
      t >= 5.5 ? config.welcomeText : config.initialText;
    $("#headline").textContent =
      t >= 5.5 ? "There you are." : "Quiet intelligence.";
    $("#greeting").hidden = t < 5.5;
    $("#subline").textContent =
      t >= 5.5 ? config.onlineText : "AI SYSTEM / AWAKENING";
    $("#phase").textContent =
      t < 1.2
        ? "SYSTEM WAKE"
        : t < 3
          ? "PARTICLE ASSEMBLY"
          : t < 5.5
            ? "CONTOUR RECONSTRUCTION"
            : t < 7.5
              ? "SYSTEM ONLINE"
              : "HANDOFF";
    $("#status").textContent =
      t < 5.5 ? "ESTABLISHING CONNECTION" : "IDENTITY SYNCHRONIZED";
    $("#percent").textContent =
      String(Math.round((elapsed / config.duration) * 100)).padStart(3, "0") +
      "%";
    $("#timeline").value = elapsed;
    $("#elapsed").textContent =
      elapsed.toFixed(1) + " / " + config.duration.toFixed(1) + " s";
    box.dataset.elapsed = elapsed.toFixed(3);
    box.dataset.playing = String(playing);
    box.dataset.completed = String(done);
    canvas.dataset.traceProgress = String(clamp((t - 3) / 2.5));
  }
  function stop() {
    playing = false;
    box.dataset.playing = "false";
    window.cancelAnimationFrame(raf);
    raf = 0;
    $("#pause").textContent = "继续";
  }
  function complete() {
    if (!initialized) skipPending = true;
    if (done) return;
    stop();
    done = true;
    elapsed = config.duration;
    render();
    send("complete");
  }
  function tick(now) {
    if (!playing) return;
    elapsed = Math.min(
      config.duration,
      elapsed + (last ? now - last : 0) / 1000,
    );
    last = now;
    if (now - drawLast >= 1000 / config.fps - 1) {
      render();
      drawLast = now;
    }
    if (elapsed >= config.duration) {
      complete();
      return;
    }
    raf = window.requestAnimationFrame(tick);
  }
  function play(reset = false) {
    stop();
    if (reset || done) {
      elapsed = 0;
      done = false;
    }
    playing = true;
    last = 0;
    drawLast = 0;
    $("#pause").textContent = "暂停";
    render();
    raf = window.requestAnimationFrame(tick);
  }
  function openSettings() {
    stop();
    pending = { ...config };
    for (const k of Object.keys(api.defaults)) $("#" + k).value = config[k];
    $("#settings-status").textContent = "本地设置 · 不上传图片";
    dialog.showModal();
    send("settings-open");
  }
  window.launcherUI = {
    openSettings,
    beginLaunch() {
      launch = true;
      document.body.classList.add("launch-mode");
      play(true);
      if (skipPending) complete();
    },
    waiting() {
      stop();
      $("#notice").hidden = false;
      $("#notice").textContent = "正在等待 Codex 启动…";
    },
    error(message) {
      launch = false;
      document.body.classList.remove("launch-mode");
      stop();
      $("#notice").hidden = false;
      $("#notice").textContent = message;
      scene.style.opacity = 1;
    },
  };
  $("#settings").onclick = openSettings;
  $("#skip").onclick = complete;
  $("#replay").onclick = $("#replay-end").onclick = () => play(true);
  $("#pause").onclick = () => (playing ? stop() : play());
  $("#timeline").oninput = (e) => {
    stop();
    elapsed = +e.target.value;
    done = false;
    render();
  };
  $("#launch").hidden = !native;
  $("#launch").onclick = () => send("launch");
  for (const kind of ["character", "background"])
    $("#" + kind + "-file").onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      $("#save").disabled = true;
      try {
        pending[kind] = await api.importImage(file);
        $("#settings-status").textContent = "已导入 " + file.name;
      } catch (error) {
        $("#settings-status").textContent = error.message;
      } finally {
        $("#save").disabled = false;
        e.target.value = "";
      }
    };
  $("#reset").onclick = () => {
    pending = api.normalize();
    for (const k of Object.keys(api.defaults)) $("#" + k).value = pending[k];
    $("#settings-status").textContent = "默认设置已填入，点击保存应用。";
  };
  $("#save").onclick = async () => {
    const button = $("#save");
    button.disabled = true;
    try {
      for (const k of Object.keys(api.defaults)) pending[k] = $("#" + k).value;
      const next = api.normalize(pending);
      await api.save(next);
      config = next;
      await assets(config);
      $("#timeline").max = config.duration;
      dialog.close("saved");
      play(true);
    } catch (error) {
      $("#settings-status").textContent = "保存失败：" + error.message;
    } finally {
      button.disabled = false;
    }
  };
  $("#restore").hidden = !embedded;
  $("#restore").onclick = () => send("restore");
  dialog.addEventListener("close", () => {
    send("settings-close");
    if (
      embedded &&
      window.AEMEATH_OPEN_SETTINGS &&
      dialog.returnValue !== "saved"
    )
      complete();
    else if (dialog.returnValue !== "saved" && !done && !playing) play();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !dialog.open) {
      e.preventDefault();
      complete();
    }
    if ((e.metaKey || e.ctrlKey) && e.altKey && e.code === "KeyB") {
      e.preventDefault();
      if (!dialog.open) openSettings();
    }
  });
  window.addEventListener("pagehide", () => {
    stop();
    ro.disconnect();
  });
  document.addEventListener("visibilitychange", () => {
    last = 0;
  });
  media.addEventListener("change", () => render());
  (async () => {
    try {
      config = await api.load();
      if (window.AEMEATH_FULL_MOTION) {
        config.motion = "full";
        await api.save(config);
      }
    } catch {
      $("#notice").hidden = false;
      $("#notice").textContent = "本地存储不可用，本次使用默认设置。";
    }
    await assets(config);
    initialized = true;
    $("#timeline").max = config.duration;
    resize();
    send("ready");
    if (window.AEMEATH_OPEN_SETTINGS) openSettings();
    else if (!launch && !done) play(true);
  })();
})();
