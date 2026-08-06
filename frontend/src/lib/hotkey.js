// Раскладка не должна отбирать горячие клавиши. На русской раскладке e.key для
// Ctrl+B — это «и», и сравнение с "b" не срабатывало: половина сочетаний молча
// не работала, пока не переключишься на латиницу. e.code называет физическую
// клавишу и от языка ввода не зависит; e.key остаётся запасным вариантом для
// случаев, где code пуст (экранные клавиатуры, часть Linux-раскладок).
export function hotkey(e) {
  const c = e.code || "";
  if (/^Key[A-Z]$/.test(c)) return c.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(c)) return c.slice(5);
  if (/^Numpad[0-9]$/.test(c)) return c.slice(6);
  const k = e.key || "";
  return k.length === 1 ? k.toLowerCase() : k;
}
