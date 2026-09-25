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

  console.log("saving over a preset");
  W.confirm = () => true;
  const addBtn = () => d.querySelector(".chip-add");
  click(d.querySelectorAll(".chip-load")[0]);            // load 20/40
  ok("offers a plain save while nothing has changed",
     addBtn().textContent === "+ Save current", addBtn().textContent);
  set("f-work", 25);
  ok("offers to save over the loaded preset",
     addBtn().textContent === "↻ Save over 20/40", addBtn().textContent);
  W.prompt = (msg, def) => def;                          // accept the offered name
  const was = names().length;
  click(addBtn());
  ok("saving over adds no chip", names().length === was, names().join(","));
  ok("the preset holds the new numbers",
     (W.localStorage.getItem("circuit-timer:presets")||"").includes('"work":25'));
  ok("and it is the one highlighted", !!d.querySelector(".chip.on"));

  console.log("per-mode lists");
  const modeBtn = m => d.querySelector('#modes .testbtn[data-mode="'+m+'"]');
  click(modeBtn("hold"));
  ok("hold mode shows only its own preset", names().join(",") === "Iso curls", names().join(","));
  W.prompt = () => "Wall sit";
  click(d.querySelector(".chip-add"));
  ok("hold preset saved", names().includes("Wall sit"), names().join(","));
  ok("hold chip reads in sets and holds",
     [...d.querySelectorAll(".chip-load span")].some(s => /s \u00b7 \d+s rest/.test(s.textContent)),
     [...d.querySelectorAll(".chip-load span")].map(s=>s.textContent).join(" | "));
  ok("preset tagged with its mode",
     (W.localStorage.getItem("circuit-timer:presets")||"").includes('"mode":"hold"'));
  click(modeBtn("circuit"));
  ok("circuit list untouched by the hold save",
     !names().includes("Wall sit") && names().includes("20/40"), names().join(","));

  ok("no runtime errors", errs.length === 0, errs.join(" | ").slice(0,300));
  dom.window.close();
  migration();
}, 600);

/* Andrew has presets and settings saved from before Hold mode existed. A fresh
   boot must read them as circuit ones, not drop them. */
function migration(){
  const old = [{name:"Old one", cfg:{work:30,rest:30,reps:4,ex:2,brk:45,prep:5}, tone:"soft"}];
  const flat = {work:45,rest:15,reps:6,ex:2,brk:30,prep:5,sound:true,tone:"soft"};
  const d2dom = new JSDOM(html, {
    runScripts: "dangerously", pretendToBeVisual: true, url: "https://test.local/",
    beforeParse(w){
      w.HTMLMediaElement.prototype.play  = () => Promise.resolve();
      w.HTMLMediaElement.prototype.pause = () => {};
      w.HTMLMediaElement.prototype.load  = () => {};
      w.localStorage.setItem("circuit-timer:presets", JSON.stringify(old));
      w.localStorage.setItem("circuit-timer:settings", JSON.stringify(flat));
      w.onerror = (m,s,l,c,e) => errs.push((e && e.stack) || m);
    }
  });
  setTimeout(()=>{
    const q = d2dom.window.document;
    const nm = [...q.querySelectorAll(".chip-load b")].map(b => b.textContent);
    console.log("\nold data migrated");
    ok("pre-Hold preset survives", nm.includes("Old one"), nm.join(","));
    ok("flat settings read as circuit",
       q.getElementById("f-work").value === "45" && q.getElementById("f-brk").value === "30",
       q.getElementById("f-work").value + "/" + q.getElementById("f-brk").value);
    ok("saved tone kept",
       q.querySelector('.tones .testbtn[data-tone="soft"]').getAttribute("aria-pressed") === "true");
    ok("still in circuit mode",
       q.querySelector('#modes .testbtn[data-mode="circuit"]').getAttribute("aria-pressed") === "true");
    ok("old preset now tagged circuit",
       (d2dom.window.localStorage.getItem("circuit-timer:presets")||"").includes('"mode":"circuit"'));
    ok("no runtime errors in migration", errs.length === 0, errs.join(" | ").slice(0,300));
    console.log(fails ? "\n"+fails+" FAILED" : "\nall passed");
    d2dom.window.close(); process.exit(fails ? 1 : 0);
  }, 600);
}
