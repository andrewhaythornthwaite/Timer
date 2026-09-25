/* Renders every clip in every tone. Checks levels and — critically — that each
   ends at silence. A non-zero final sample is an audible click on every beep.
   node test/tones.js */
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "interval-timer.html"), "utf8");
const js  = html.split("<script>")[1].split("</" + "script>")[0];
const src = js.slice(js.indexOf("const SR = 22050"), js.indexOf("  /* Scheduler state"));
global.btoa = s => Buffer.from(s, "binary").toString("base64");
const {renderWav, clipsFor, TONES, setLimits} = new Function(
  src + "; return {renderWav, clipsFor, TONES, setLimits: l => { clipLimits = l; }};")();
const seconds = clip =>
  ((Buffer.from(renderWav(clip).split(",")[1], "base64").length - 44) / 2) / 22050;

let fails = 0;
for(const tone of Object.keys(TONES)){
  console.log("\n" + tone);
  const C = clipsFor(tone);
  for(const k of Object.keys(C)){
    const buf = Buffer.from(renderWav(C[k]).split(",")[1], "base64");
    const n = (buf.length - 44) / 2;
    let peak = 0;
    for(let i=0;i<n;i++) peak = Math.max(peak, Math.abs(buf.readInt16LE(44+i*2)));
    const last = Math.abs(buf.readInt16LE(44 + (n-1)*2));
    const dur  = n / 22050;
    const clipping = peak >= 32700;
    const clicks   = last > 40;
    const tickLong = k === "tick" && dur > 0.95;
    // `done` plays at the end of a session with nothing after it, so its
    // length cannot collide with a following phase. Everything else can.
    const tooLong  = k !== "tick" && k !== "done" && dur > 5.05;
    const bad = clipping || clicks || tickLong || tooLong;
    if(bad) fails++;
    console.log("  " + (bad ? "FAIL " : "ok   ") + k.padEnd(5) +
      Math.round(C[k][0].f) + "Hz  " + dur.toFixed(2) + "s  peak " +
      (peak/32768*100|0) + "%  ends " + last +
      (clipping ? "  <- CLIPPING" : "") + (clicks ? "  <- CLICK ON TAIL" : "") +
      (tickLong ? "  <- tick over 0.95s, will smear" : "") +
      (tooLong ? "  <- over 5s, may run past a short break" : ""));
  }
}
/* A clip is booked to sound at the START of its phase, so it has to fit
   inside it. With a 1s reset the release tone used to ring straight over the
   next hold's start tone. Easy to undo while tuning envelopes — hence a test. */
console.log("\nfitted to a 1s reset / 90s set rest");
setLimits({rest: 1, brk: 90});
for(const tone of Object.keys(TONES)){
  const C = clipsFor(tone);
  const r = seconds(C.rest), b = seconds(C.brk), t = seconds(C.tick);
  const over  = r > 1.0;                 // would run into the next hold
  const crush = r < 0.3;                 // collapsed into a click
  const tick  = t > 0.95;                // unlimited clips must be untouched
  const bad = over || crush || tick;
  if(bad) fails++;
  console.log("  " + (bad ? "FAIL " : "ok   ") + tone.padEnd(5) +
    "rest " + r.toFixed(2) + "s  brk " + b.toFixed(2) + "s  tick " + t.toFixed(2) + "s" +
    (over ? "  <- rest runs past the 1s reset" : "") +
    (crush ? "  <- rest crushed to a click" : "") +
    (tick ? "  <- tick affected by a limit it has none of" : ""));
}
setLimits({});

/* Warm and Wood were retired. Settings and presets on Andrew's phone may still
   name them, so an unknown tone has to fall back to soft rather than break. */
const retired = JSON.stringify(clipsFor("wood")) === JSON.stringify(clipsFor("soft"));
if(!retired) fails++;
console.log("\nretired tone names\n  " + (retired ? "ok   " : "FAIL ") +
  "an unknown tone falls back to soft");

console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
process.exit(fails ? 1 : 0);
