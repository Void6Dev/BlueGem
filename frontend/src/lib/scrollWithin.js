/**
 * Прокрутка к элементу внутри одного контейнера.
 *
 * Штатный `el.scrollIntoView()` докручивает не только ближайший скроллер, а всю
 * цепочку предков — включая те, у кого `overflow: hidden`: скрытая полоса всё
 * равно прокручивается программно. В редакторе такой предок — корневой
 * `h-screen w-screen overflow-hidden`, поэтому доводка до поля в правой панели
 * уводила вбок весь экран. Опции, ограничивающей scrollIntoView одним
 * контейнером, в DOM нет, поэтому считаем смещение сами.
 *
 * @param {HTMLElement|null} container скроллер, который можно двигать
 * @param {HTMLElement|null} el        элемент внутри него
 * @param {"nearest"|"center"} block   довести до края или поставить по центру
 * @param {"smooth"|"auto"} behavior   на перебор стрелками нужен мгновенный
 */
export function scrollWithin(container, el, block = "nearest", behavior = "smooth") {
  if (!container || !el) return;
  const view = container.getBoundingClientRect();
  const box = el.getBoundingClientRect();
  const pad = 8;

  let delta = 0;
  if (block === "center") {
    delta = (box.top + box.height / 2) - (view.top + view.height / 2);
  } else if (box.top < view.top + pad) {
    delta = box.top - view.top - pad;
  } else if (box.bottom > view.bottom - pad) {
    // Поле выше видимой области целиком не поместится — тогда прижимаем верх,
    // иначе бы уехало начало текста, а это как раз то, что читают.
    delta = Math.min(box.bottom - view.bottom + pad, box.top - view.top - pad);
  }
  if (!delta) return;

  const top = Math.max(0, Math.min(container.scrollTop + delta,
    container.scrollHeight - container.clientHeight));
  container.scrollTo({ top, behavior });
}
