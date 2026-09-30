/* Boots the page in a headless DOM and drives every control, in both modes.
   Catches runtime errors that reading the code will not.  node test/app.js */
const {JSDOM} = require("jsdom");
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "interval-timer.html"), "utf8");
const errs = [];
/* Every play() the page makes. Two things have to be filtered out before what
   is left is "sounds Andrew hears": unlockAudio() primes every clip muted, and
   the keep-awake video is an HTMLMediaElement too. What remains proves the
   hold-mode "one tone, as each hold starts" rule rather than assuming it. */
const plays = [];

const dom = new JSDOM(html, {
  runScripts: "dangerously", pretendToBeVisual: true, url: "https://test.local/",
  beforeParse(w){
    w.HTMLMediaElement.prototype.play  = function(){
      plays.push({src: this.src, muted: this.muted, tag: this.tagName});
      return Promise.resolve();
    };
    w.HTMLMediaElement.prototype.pause = () => {};
    w.HTMLMediaElement.prototype.load  = () => {};
    w.onerror = (m,s,l,c,e) => errs.push((e && e.stack) || m);
  }
});
const d = dom.window.document;
const click = id => d.getElementById(id).dispatchEvent(new dom.window.Event("click"));
const clickEl = el => el.dispatchEvent(new dom.window.Event("click"));
const modeBtn = m => d.querySelector('#modes .testbtn[data-mode="' + m + '"]');
const txt = id => d.getElementById(id).textContent;
const rowLabel = k => d.querySelector('.stepper[data-key="'+k+'"]')
                       .closest(".row").querySelector(".lab b").textContent;
const fields = () => ["work","rest","reps","ex","brk","prep"]
                       .map(k => d.getElementById("f-"+k).value).join("/");
const phaseType = () => (/p-([a-z]+)/.exec(d.getElementById("run").className) || [])[1];
const heard = () => plays.filter(p => p.tag === "AUDIO" && !p.muted).map(p => p.src);
const visiblePreviews = () => [...d.querySelectorAll(".previews .testbtn")]
                                .filter(b => b.style.display !== "none");
const setField = (id,v) => { const e = d.getElementById(id); e.value = v;
                             e.dispatchEvent(new dom.window.Event("change")); };
let fails = 0;
const ok = (label, cond, got) => {
  if(!cond) fails++;
  console.log((cond ? "  ok   " : "  FAIL ") + label + (got !== undefined ? "  -> " + got : ""));
};

setTimeout(() => {
  console.log("boot");
  ok("no runtime errors on load", errs.length === 0, errs.join(" | ").slice(0,300));
  ok("total time computed", /m|s/.test(txt("total")), txt("total"));
  ok("three preview buttons", visiblePreviews().length === 3);
  ok("two tone buttons", d.querySelectorAll(".tones .testbtn").length === 2,
     [...d.querySelectorAll(".tones .testbtn")].map(b => b.dataset.tone).join(","));
  ok("no external requests", (html.match(/https:\/\//g) || []).length === 0);

  console.log("circuit session");
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
    ok("skip advances phase", txt("phase") === "Work", txt("phase"));
    click("end");
    ok("end returns to setup", d.getElementById("run").className === "");

    console.log("hold mode");
    clickEl(modeBtn("hold"));
    ok("row labels swap", rowLabel("work")==="Down" && rowLabel("rest")==="Up" &&
       rowLabel("ex")==="Sets" && rowLabel("brk")==="Rest",
       [rowLabel("work"),rowLabel("rest"),rowLabel("ex"),rowLabel("brk")].join(","));
    ok("hold defaults 6/1/15/3/90/10", fields() === "6/1/15/3/90/10", fields());
    ok("stepper buttons renamed with the row",
       d.querySelector('.stepper[data-key="work"] button').getAttribute("aria-label") === "Less down",
       d.querySelector('.stepper[data-key="work"] button').getAttribute("aria-label"));
    ok("the up steps by 1, max 60",
       d.querySelector('.stepper[data-key="rest"]').dataset.step === "1" &&
       d.querySelector('.stepper[data-key="rest"]').dataset.max === "60");
    ok("total is 8m 22s", txt("total") === "8m 22s", txt("total"));
    ok("summary shows time under tension", /under tension/.test(txt("seq")), txt("seq"));
    ok("one preview button, the down tone",
       visiblePreviews().map(b => b.textContent).join("|") === "⏵ Down tone",
       [...d.querySelectorAll(".previews .testbtn")]
         .map(b => (b.style.display === "none" ? "[hidden]" : b.textContent)).join("|"));
    ok("sound row explains the single tone",
       txt("snd-sub") === "One tone as each rep starts", txt("snd-sub"));

    // What actually sounds. The preview plays the hold tone; the session that
    // follows must play that same clip, once per hold start, and nothing else.
    plays.length = 0;
    click("hear-start");
    click("start");
    const tally = {prep:0, work:0, rest:0, break:0};
    let guard = 0;
    while(phaseType() && guard++ < 300){
      tally[phaseType()]++;
      click("skip");
    }
    ok("45 downs", tally.work === 45, tally.work);
    ok("42 ups", tally.rest === 42, tally.rest);
    ok("2 rests between sets", tally.break === 2, tally.break);
    ok("one lead-in", tally.prep === 1, tally.prep);
    ok("session ends after a hold", txt("phase") === "Done", txt("phase"));
    ok("hold wording on finish", txt("where") === "Sets complete" &&
       txt("next") === "3 sets · 15 reps each", txt("where") + " / " + txt("next"));
    click("end");

    setTimeout(() => {                      // let deferred play() promises settle
      const uniq = [...new Set(heard())];
      ok("only one clip sounds in a hold session", uniq.length === 1,
         uniq.length + " distinct clips");
      ok("and it is the hold tone the preview plays", uniq[0] === heard()[0]);
      ok("it sounds once per hold start, plus the preview", heard().length === 46,
         heard().length);

      // The bar: a down drains from full, an up climbs from nothing, eased
      const barAt = () => d.getElementById("drain").style.height;
      click("start");
      while(phaseType() === "prep") click("skip");
      ok("a down starts from a full bar", barAt() === "100%", barAt());
      ok("phase reads Down", txt("phase") === "Down", txt("phase"));
      click("skip");
      ok("an up starts from an empty bar and climbs",
         phaseType() === "rest" && barAt() === "0%", phaseType() + " / " + barAt());
      ok("phase reads Up", txt("phase") === "Up", txt("phase"));
      click("end");

      // 0s reset is a real variant: holds run back to back, no reset phase
      setField("f-rest", 0);
      ok("up of 0 drops the up phases", txt("total") === "7m 40s", txt("total"));
      ok("summary omits the up", !/s up/.test(txt("seq")), txt("seq"));
      click("start");
      const back = [];
      for(let i=0;i<4 && phaseType();i++){ back.push(phaseType()); click("skip"); }
      ok("downs run back to back", back.join(",") === "prep,work,work,work", back.join(","));
      click("end");
      setField("f-rest", 1);

      // one set of one rep: the finish line still has to read as English
      setField("f-ex", 1); setField("f-reps", 1);
      click("start");
      let g2 = 0; while(phaseType() && g2++ < 20) click("skip");
      ok("finish line pluralises", txt("next") === "1 set \u00b7 1 rep each", txt("next"));
      click("end");
      setField("f-ex", 3); setField("f-reps", 15);

      console.log("back to circuit");
      clickEl(modeBtn("circuit"));
      ok("circuit labels restored", rowLabel("work")==="Work" && rowLabel("brk")==="Break",
         rowLabel("work")+","+rowLabel("brk"));
      ok("circuit numbers restored", fields() === "20/40/5/3/60/10", fields());
      ok("all three previews back", visiblePreviews().length === 3);
      ok("stepper buttons renamed back",
         d.querySelector('.stepper[data-key="work"] button').getAttribute("aria-label") === "Less work",
         d.querySelector('.stepper[data-key="work"] button').getAttribute("aria-label"));
      ok("mode persisted to storage",
         (dom.window.localStorage.getItem("circuit-timer:settings")||"").includes('"mode":"circuit"'));

      plays.length = 0;
      click("start");
      click("skip"); click("skip");
      ok("circuit still sounds a tone per change", [...new Set(heard())].length >= 2,
         [...new Set(heard())].length + " distinct clips");
      ok("circuit rests still drain from full",
         phaseType() === "rest" && d.getElementById("drain").style.height === "100%",
         phaseType() + " / " + d.getElementById("drain").style.height);
      click("end");

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
    }, 80);
  }, 250);
}, 600);
