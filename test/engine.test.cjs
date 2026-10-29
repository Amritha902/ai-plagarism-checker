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
