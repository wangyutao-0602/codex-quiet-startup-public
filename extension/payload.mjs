import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { installRenderer } from "./renderer.mjs";
export async function buildInjection(root) {
  const [html, css, skin, settings, animation, character] = await Promise.all(
    [
      "index.html",
      "style.css",
      "extension/wallpaper.css",
      "image-settings.js",
      "animation.js",
      "assets/character.png",
    ].map((name) => readFile(join(root, name))),
  );
  const payload = {
    html: html
      .toString()
      .replace(/<!doctype[^>]*>/gi, "")
      .replace(/<html[^>]*>|<\/html>/gi, "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<link\b[^>]*>/gi, "")
      .replace(/<meta\b[^>]*http-equiv[^>]*>/gi, ""),
    css: css.toString(),
    skin: skin.toString(),
    assets: {
      character: "data:image/png;base64," + character.toString("base64"),
    },
  };
  const mount = `function(window){const document=window.document,location=window.location,performance=window.performance,indexedDB=window.indexedDB,Image=window.Image,Path2D=window.Path2D,URL=window.URL,module=undefined;\n${settings}\n${animation}\n}`;
  return `(${installRenderer.toString()})(${JSON.stringify(payload)},${mount})`;
}
