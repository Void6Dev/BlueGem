// Противоречия в хронологии: то, что не может быть правдой в мире.
//
// Проверка намеренно осторожная — подсказывает, а не запрещает. Даты с
// неопределённостью («около», «до», «между») сравниваются краями: событие
// «около 1150» и рождение в 1149 противоречием не считаются, пока их
// промежутки пересекаются.
import { BIRTH_KEY, DEATH_KEY } from "./dates";

// Даты, которые означают «узел был там»: само событие, его начало и конец.
// Основание города или постройка храма раньше рождения героя — не
// противоречие, поэтому «created», «construction», «discovery» не в счёт.
const PRESENCE_KEYS = new Set(["date", "started", "ended", "custom"]);

const lo = (it) => (Number.isFinite(it.lo) ? it.lo : it.t);
const hi = (it) => (Number.isFinite(it.hi) ? it.hi : it.t2 ?? it.t);

function lifeOf(chrono, nodeId) {
  const list = chrono.byNode.get(nodeId) || [];
  const birth = list.find((x) => x.entry.key === BIRTH_KEY && x.t != null) || null;
  const death = list.find((x) => x.entry.key === DEATH_KEY && x.t != null) || null;
  return { birth, death };
}

/**
 * @param chrono результат buildChronology
 * @param edges  связи проекта [{source, target}]
 * @returns {Map<string, Array<{code, otherId?}>>} ключ — key события
 */
export function findConflicts(chrono, edges = []) {
  const out = new Map();
  const add = (key, issue) => {
    if (!out.has(key)) out.set(key, []);
    const list = out.get(key);
    if (!list.some((x) => x.code === issue.code && x.otherId === issue.otherId)) list.push(issue);
  };

  const neighbours = new Map();
  for (const e of edges) {
    const s = e.source;
    const t = e.target;
    if (!neighbours.has(s)) neighbours.set(s, new Set());
    if (!neighbours.has(t)) neighbours.set(t, new Set());
    neighbours.get(s).add(t);
    neighbours.get(t).add(s);
  }

  for (const [nodeId, list] of chrono.byNode) {
    const { birth, death } = lifeOf(chrono, nodeId);
    if (birth && death && hi(death) < lo(birth)) add(death.key, { code: "deathBeforeBirth" });
    for (const item of list) {
      if (item.t == null) continue;
      // Конец раньше начала: шкала рисует такую запись точкой, и опечатка
      // иначе так и осталась бы незамеченной.
      if (item.end?.ok && item.start?.ok && item.end.hi < item.start.lo) add(item.key, { code: "endBeforeStart" });
      if (!PRESENCE_KEYS.has(item.entry.key || "date")) continue;
      if (birth && item !== birth && hi(item) < lo(birth)) add(item.key, { code: "beforeOwnBirth" });
      if (death && item !== death && lo(item) > hi(death)) add(item.key, { code: "afterOwnDeath" });
      // Участники события — узлы, связанные с ним: их не могло там быть до
      // рождения и после смерти. Сам участник — не событие, а человек: у
      // события своей даты рождения нет.
      if (birth) continue;
      for (const otherId of neighbours.get(nodeId) || []) {
        const life = lifeOf(chrono, otherId);
        if (life.birth && hi(item) < lo(life.birth)) add(item.key, { code: "beforeBirth", otherId });
        if (life.death && lo(item) > hi(life.death)) add(item.key, { code: "afterDeath", otherId });
      }
    }
  }
  return out;
}
