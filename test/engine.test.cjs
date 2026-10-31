const test = require("node:test");
const assert = require("node:assert");
const E = require("../public/engine.js");

const original =
  "The water cycle describes how water evaporates from the surface of the earth, rises into the atmosphere, " +
  "cools and condenses into clouds, and falls again to the surface as precipitation. This process is driven by solar energy.";
const unrelated =
  "Bananas are a popular fruit eaten around the world. They grow in tropical climates and are rich in potassium.";

test("verbatim copy is found and attributed to its source", () => {
  const doc = { name: "essay", text: "Intro sentence here. " + original + " My own closing words follow now." };
  const r = E.compareToSources(doc, [{ name: "bananas", text: unrelated }, { name: "wiki", text: original }]);
  assert.ok(r.percent > 60, "overall " + r.percent);
  assert.strictEqual(r.perSource[0].percent, 0);
  assert.ok(r.perSource[1].percent > 60);
  assert.strictEqual(r.passages.length, 1);
  assert.strictEqual(r.passages[0].source, 1);
  assert.ok(r.passages[0].text.startsWith("The water cycle"));
  assert.ok(r.passages[0].sourceText.endsWith("solar energy"));
});

test("original text scores zero", () => {
  const r = E.compareToSources({ name: "d", text: unrelated }, [{ name: "s", text: original }]);
  assert.strictEqual(r.percent, 0);
  assert.strictEqual(r.passages.length, 0);
});

test("paraphrase mode catches light rewording", () => {
  const reworded = original.replace("describes how", "describes the way").replace("falls again", "falling again").replace("This process is", "The process is");
  const strict = E.compareToSources({ name: "d", text: reworded }, [{ name: "s", text: original }]);
  const loose = E.compareToSources({ name: "d", text: reworded }, [{ name: "s", text: original }], { paraphrase: true });
  assert.ok(loose.percent > strict.percent, `${loose.percent} > ${strict.percent}`);
});

test("compareAll ranks the copied pair highest", () => {
  const r = E.compareAll([
    { name: "a", text: original },
    { name: "b", text: unrelated },
    { name: "c", text: original + " Extra words appended at the end of it." },
  ]);
  const top = r.pairs.sort((x, y) => y.jaccard - x.jaccard)[0];
  assert.deepStrictEqual([top.a, top.b], [0, 2]);
  assert.ok(top.aInB > 99);
});

test("large input stays fast", () => {
  const big = Array.from({ length: 200000 }, (_, i) => "word" + (i % 5000)).join(" ");
  const t = Date.now();
  const r = E.compareToSources({ name: "d", text: big + " " + original }, [{ name: "s", text: original }]);
  assert.ok(r.passages.length >= 1);
  assert.ok(Date.now() - t < 5000);
});

test("AI heuristics separate stock LLM prose from casual writing", () => {
  const llm = Array(4).fill(
    "Furthermore, it is important to note that technology plays a crucial role in the modern landscape. " +
    "Moreover, organizations must navigate the ever-evolving realm of innovation to remain competitive. " +
    "Additionally, fostering a holistic approach can unlock transformative and seamless outcomes. " +
    "In conclusion, this comprehensive strategy underscores the pivotal importance of robust planning."
  ).join(" ");
  const human =
    "I wasn't sure about the trip at first. Rain. Then the bus broke down outside some town I can't even spell, " +
    "and we sat there for three hours eating crisps and arguing about football. My brother thinks Arsenal will win the league, which is honestly hilarious. " +
    "Anyway we got there eventually! The hostel was fine, a bit damp. Next morning we hiked up to the lake and it was freezing, " +
    "but the view? Worth it. I'd go back tomorrow if I could. Didn't take many photos though, phone died on the second day, typical. " +
    "We'll probably do it again in spring when it's warmer and the paths aren't a mud bath.";
  const a = E.aiSignals(llm), h = E.aiSignals(human);
  assert.ok(a.score > 60, "llm " + a.score);
  assert.ok(h.score < 35, "human " + h.score);
});

test("short text returns no AI score", () => {
  assert.strictEqual(E.aiSignals("Too short.").score, null);
});

const source2 =
  "Researchers demonstrated that regular exercise significantly reduces the risk of heart disease in older adults. " +
  "The study followed 4,000 participants across twelve hospitals for a decade.";

test("reworded sentence with synonyms and new word order is caught", () => {
  const doc = "My essay starts here with my own thoughts on the matter. " +
    "In older adults, the risk of heart disease is considerably lowered by regular exercise, researchers showed. " +
    "Then I write about something else entirely, like my holiday in Spain.";
  const r = E.compareToSources({ name: "d", text: doc }, [{ name: "s", text: source2 }]);
  const rw = r.passages.filter((p) => p.kind === "reworded");
  assert.strictEqual(rw.length, 1, JSON.stringify(r.passages));
  assert.ok(rw[0].text.startsWith("In older adults"));
  assert.ok(rw[0].sourceText.startsWith("Researchers demonstrated"));
  assert.ok(r.rewordedPercent > 0 && r.exactPercent === 0);
});

test("unrelated sentences on the same topic are not flagged as reworded", () => {
  const doc = "Exercise is something many older people enjoy at the weekend with friends. " +
    "Hospitals are busy places where doctors work long hours every single day.";
  const r = E.compareToSources({ name: "d", text: doc }, [{ name: "s", text: source2 }]);
  assert.strictEqual(r.passages.length, 0, JSON.stringify(r.passages));
});

test("look-alike letters and invisible characters do not hide copying", () => {
  const disguised = original.replace(/a/g, "а").replace(/o/g, "о").replace(/ /g, " ​");
  const r = E.compareToSources({ name: "d", text: disguised }, [{ name: "s", text: original }]);
  assert.ok(r.exactPercent > 90, "exact " + r.exactPercent);
  const d = E.disguiseScan(disguised);
  assert.ok(d.lookalikes > 20 && d.invisible > 20);
  assert.deepStrictEqual(E.disguiseScan(original), { invisible: 0, lookalikes: 0 });
});

test("genuine Cyrillic text is left alone", () => {
  assert.deepStrictEqual(E.disguiseScan("Привет, как дела? Это обычный русский текст."), { invisible: 0, lookalikes: 0 });
});

test("quotations and the reference list can be excluded", () => {
  const doc = 'As the textbook puts it, "' + original + '" That is my opening. ' +
    "Now some original discussion follows here at length about rivers and lakes and seas.\n\nReferences\n" + original;
  const withAll = E.compareToSources({ name: "d", text: doc }, [{ name: "s", text: original }]);
  const without = E.compareToSources({ name: "d", text: doc }, [{ name: "s", text: original }], { excludeQuotes: true, excludeReferences: true });
  assert.ok(withAll.percent > 50);
  assert.strictEqual(without.percent, 0);
  assert.ok(without.referencesExcluded);
});

test("matches shorter than the minimum are ignored", () => {
  const doc = "Unrelated words then water evaporates from the surface of the earth and nothing more.";
  const loose = E.compareToSources({ name: "d", text: doc }, [{ name: "s", text: original }], { minWords: 5, reworded: false });
  const strict = E.compareToSources({ name: "d", text: doc }, [{ name: "s", text: original }], { minWords: 12, reworded: false });
  assert.ok(loose.passages.length === 1 && strict.passages.length === 0);
});

test("web passages favour distinctive sentences", () => {
  const text = Array.from({ length: 30 }, (_, i) => i === 7
    ? "The Hubble Space Telescope photographed galaxy NGC 4414 in 1995 at extraordinary resolution."
    : "This is a fairly ordinary sentence that says very little of anything at all.").join(" ");
  const picks = E.samplePassages(text, 3, 30);
  assert.ok(picks.some((p) => p.includes("Hubble")));
});
