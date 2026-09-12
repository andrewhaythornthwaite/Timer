/* Renders every clip in every tone. Checks levels and — critically — that each
   ends at silence. A non-zero final sample is an audible click on every beep.
   node test/tones.js */
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "interval-timer.html"), "utf8");
const js  = html.split("<script>")[1].split("</" + "script>")[0];
const src = js.slice(js.indexOf("const SR = 22050"), js.indexOf("  /* Scheduler state"));
global.btoa = s => Buffer.from(s, "binary").toString("base64");
const {renderWav, clipsFor, TONES} = new Function(
  src + "; return {renderWav, clipsFor, TONES};")();

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
console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
process.exit(fails ? 1 : 0);
