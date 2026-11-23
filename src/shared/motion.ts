// Motion graphics scenes. Claude writes each scene as markup and CSS animations; this file
// turns that into a page that plays in the app and can be stepped through frame by frame to
// make a clip. Used by the interface (to play it) and the desktop app (to render it).

/** The size every animation is drawn at: a vertical 9:16 frame. */
export const STAGE = { width: 1080, height: 1920 } as const;
/** How many frames a second a rendered clip has. */
export const CLIP_FPS = 30;

/** One scene's animation: markup and CSS written by Claude. */
export type Animation = {
  id: string;
  /** What goes inside the stage. No scripts. */
  html: string;
  /** Its own styles and keyframes, on top of the video's shared design. */
  css: string;
  madeAt: string;
};

/**
 * Removes anything from Claude's markup or CSS that could run code or reach the network.
 * The page that plays it is also sandboxed and forbidden from loading anything, so this is a second lock.
 */
export function cleanMarkup(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<\/?(script|iframe|object|embed|link|meta|base|form)\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src|xlink:href)\s*=\s*("\s*(?:https?:|\/\/|javascript:)[^"]*"|'\s*(?:https?:|\/\/|javascript:)[^']*')/gi, "");
}
export function cleanCss(css: string): string {
  return css
    .replace(/<\/?style[^>]*>/gi, "")
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\(\s*(['"]?)\s*(?!data:)[^)]*\)/gi, "none")
    .replace(/expression\s*\(/gi, "(");
}

/**
 * The page for one animation, with the stage at its full size in the top left corner.
 * "play" has no script at all: the CSS animations simply run once from the moment the page loads, and
 * whoever shows it scales it and loads it again to loop. "render" pauses every animation and waits to be
 * stepped through `window.__seek(seconds)`, so a clip can be made one exact frame at a time.
 */
export function animationPage(design: string, animation: Pick<Animation, "html" | "css">, seconds: number, mode: "play" | "render"): string {
  const stepper =
    mode === "render"
      ? `<script>
(function () {
  var length = ${Math.max(seconds, 0.1)} * 1000;
  window.__seek = function (s) {
    var ms = Math.min(Math.max(s * 1000, 0), length);
    var all = document.getAnimations();
    for (var i = 0; i < all.length; i++) { all[i].pause(); all[i].currentTime = ms; }
  };
  window.__seek(0);
})();
</script>`
      : "";
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; ${mode === "render" ? "script-src 'unsafe-inline'; " : ""}img-src data:; font-src data:">
<style>
html, body { margin: 0; width: ${STAGE.width}px; height: ${STAGE.height}px; overflow: hidden; background: #000; }
#stage { position: absolute; left: 0; top: 0; width: ${STAGE.width}px; height: ${STAGE.height}px; overflow: hidden; font-family: system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
#stage * { box-sizing: border-box; }
</style>
<style>${cleanCss(design)}</style>
<style>${cleanCss(animation.css)}</style>
</head>
<body>
<div id="stage">${cleanMarkup(animation.html)}</div>
${stepper}
</body>
</html>`;
}
