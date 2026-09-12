/* Boots the page in a headless DOM and drives every control.
   Catches runtime errors that reading the code will not.  node test/app.js */
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
    w.onerror = (m,s,l,c,e) => errs.push((e && e.stack) || m);
  }
});
const d = dom.window.document;
const click = id => d.getElementById(id).dispatchEvent(new dom.window.Event("click"));
let fails = 0;
const ok = (label, cond, got) => {
  if(!cond) fails++;
  console.log((cond ? "  ok   " : "  FAIL ") + label + (got !== undefined ? "  -> " + got : ""));
};

setTimeout(() => {
  console.log("boot");
  ok("no runtime errors on load", errs.length === 0, errs.join(" | ").slice(0,300));
  ok("total time computed", /m|s/.test(d.getElementById("total").textContent),
     d.getElementById("total").textContent);
  ok("three preview buttons", d.querySelectorAll(".previews .testbtn").length === 3);
  ok("four tone buttons", d.querySelectorAll(".tones .testbtn").length === 4);
  ok("no external requests", (html.match(/https:\/\//g) || []).length === 0);

  console.log("session");
  click("start");
  setTimeout(() => {
    ok("run screen engaged", /\bon\b/.test(d.getElementById("run").className),
       d.getElementById("run").className);
    click("pause");
    ok("pause label flips", d.getElementById("pause").textContent === "Resume",
       d.getElementById("pause").textContent);
    ok("paused class set", /paused/.test(d.getElementById("run").className));
    click("pause");
    ok("resume clears paused", !/paused/.test(d.getElementById("run").className));
    click("skip");
    ok("skip advances phase", d.getElementById("phase").textContent === "Work",
       d.getElementById("phase").textContent);
    click("end");
    ok("end returns to setup", d.getElementById("run").className === "");

    console.log("sound controls");
    ["hear-start","hear-stop","hear-switch"].forEach(click);
    d.querySelectorAll(".tones .testbtn")
      .forEach(b => b.dispatchEvent(new dom.window.Event("click")));

    setTimeout(() => {
      ok("no errors after full drive", errs.length === 0, errs.join(" | ").slice(0,300));
      console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
      dom.window.close();
      process.exit(fails ? 1 : 0);
    }, 250);
  }, 250);
}, 600);
