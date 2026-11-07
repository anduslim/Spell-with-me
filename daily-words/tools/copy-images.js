// Copies the Twemoji SVGs used by Daily Words into img/.
// Usage:
//   npm pack @twemoji/svg@15.0.0 && tar xzf twemoji-svg-15.0.0.tgz
//   node tools/copy-images.js path/to/package
// Twemoji graphics: CC-BY 4.0, https://github.com/jdecked/twemoji
const fs = require("fs");
const path = require("path");

const src = process.argv[2];
if (!src) { console.error("usage: node tools/copy-images.js <twemoji svg dir>"); process.exit(1); }
const root = path.join(__dirname, "..");
const out = path.join(root, "img");
fs.mkdirSync(out, { recursive: true });

const RE = /\p{Regional_Indicator}{2}|\p{Extended_Pictographic}️?(?:‍\p{Extended_Pictographic}️?)*/gu;
const fileFor = e => {
  let cps = [...e].map(c => c.codePointAt(0).toString(16));
  if (!cps.includes("200d")) cps = cps.filter(c => c !== "fe0f");
  return cps.join("-") + ".svg";
};

const text = ["index.html", "app.js", "data.js"].map(f => fs.readFileSync(path.join(root, f), "utf8")).join("\n");
const emoji = [...new Set(text.match(RE))];
let missing = [];
for (const e of emoji) {
  const f = fileFor(e);
  const from = path.join(src, f);
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(out, f));
  else missing.push(`${e} (${f})`);
}
console.log(`copied ${emoji.length - missing.length} images`);
if (missing.length) console.log("no picture for (shown as text instead):", missing.join(", "));
