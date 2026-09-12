/* Presets: save, load, highlight, delete, persist.  node test/presets.js */
const {JSDOM} = require("jsdom");
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "interval-timer.html"), "utf8");
const errs = [];
const dom = new JSDOM(html, {
  runScripts: "dangerously", pretendToBeVisual: true, url: "https://test.local/",
  beforeParse(w){
    w.HTMLMediaElement.prototype.play  = () => Promise.resolve();
    w.HTMLMediaElement.prototype.pause = () => {};
    w.HTMLMediaElement.prototype.load  = () => {};
    w.prompt = () => "Kettlebells";
    w.onerror = (m,s,l,c,e) => errs.push((e && e.stack) || m);
  }
});
const d = dom.window.document, W = dom.window;
const click = el => el.dispatchEvent(new W.Event("click", {bubbles:true}));
const names = () => [...d.querySelectorAll(".chip-load b")].map(b => b.textContent);
let fails = 0;
const ok = (l,c,g) => { if(!c) fails++; console.log((c?"  ok   ":"  FAIL ")+l+(g!==undefined?"  -> "+g:"")); };

setTimeout(() => {
  ok("starter preset seeded", names().length === 1, names().join(","));

  const set = (id,v) => { const e=d.getElementById(id); e.value=v; e.dispatchEvent(new W.Event("change")); };
  set("f-work",120); set("f-rest",10);
  click(d.querySelector(".chip-add"));
  ok("preset saved with prompted name", names().includes("Kettlebells"), names().join(","));
  ok("summary shows config",
     [...d.querySelectorAll(".chip-load span")].some(s => s.textContent.includes("120/10")));
  ok("persisted to localStorage",
     (W.localStorage.getItem("circuit-timer:presets")||"").includes("Kettlebells"));

  click(d.querySelectorAll(".chip-load")[0]);
  ok("loading a preset restores numbers",
     d.getElementById("f-work").value === "20" && d.getElementById("f-rest").value === "40",
     d.getElementById("f-work").value + "/" + d.getElementById("f-rest").value);
  ok("matching preset highlighted", !!d.querySelector(".chip.on"));

  const before = names().length;
  click(d.querySelectorAll(".chip-x")[before-1]);
  ok("delete removes one", names().length === before-1, names().join(","));

  ok("no runtime errors", errs.length === 0, errs.join(" | ").slice(0,300));
  console.log(fails ? "\n"+fails+" FAILED" : "\nall passed");
  dom.window.close(); process.exit(fails ? 1 : 0);
}, 600);
