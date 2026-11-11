import { useLayoutEffect } from "react";

/**
 * Ползунок, который переезжает под выбранный пункт, а не перескакивает.
 *
 * Выбранное в переключателе раньше просто загоралось на новом месте, и глаз
 * терял, откуда и куда ушёл выбор. Здесь под пунктами лежит одна общая
 * подложка (.sw-thumb) и едет к выбранному — так видно направление.
 *
 * Положение считается от offsetLeft/offsetTop, поэтому контейнер обязан быть
 * позиционированным — это делает класс .sw-thumb-host. Работает и по
 * горизонтали (сегменты, вкладки), и по вертикали (списки).
 *
 * До первой расстановки переходов нет: ползунок встаёт на место сразу, а
 * ехать начинает только со второго выбора (data-thumb-anim ставится кадром
 * позже). Иначе на каждом открытии он выезжал бы из левого верхнего угла.
 *
 * @param ref      ref контейнера, в котором лежат .sw-thumb и пункты
 * @param deps     при смене любого значения наблюдатели ставятся заново;
 *                 обычно это выбранный пункт (состав списка ловит
 *                 MutationObserver сам)
 * @param selector как найти выбранный пункт среди прямых потомков
 */
export function useSlidingThumb(ref, deps, selector = '[aria-pressed="true"]') {
  useLayoutEffect(() => {
    const host = ref.current;
    const thumb = host?.querySelector(":scope > .sw-thumb");
    if (!host || !thumb) return undefined;

    const place = () => {
      const active = host.querySelector(`:scope > ${selector}`);
      if (!active) {
        thumb.style.opacity = "0";
        delete host.dataset.thumb;
        return;
      }
      host.dataset.thumb = "on";
      thumb.style.opacity = "1";
      thumb.style.width = `${active.offsetWidth}px`;
      thumb.style.height = `${active.offsetHeight}px`;
      thumb.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
    };
    place();

    let frame = 0;
    if (!host.dataset.thumbAnim) {
      frame = requestAnimationFrame(() => { host.dataset.thumbAnim = "on"; });
    }

    // Ширина пункта меняется не только при выборе: сменился язык, догрузился
    // шрифт, переименовали вкладку. Следим и за контейнером, и за пунктами.
    const ro = new ResizeObserver(place);
    ro.observe(host);
    for (const child of host.children) if (child !== thumb) ro.observe(child);

    // Состав пунктов и отметку выбранного React меняет и без смены deps:
    // добавили вкладку, вкладка ушла в режим переименования, в палитре
    // сменились найденные строки. Наблюдатель срабатывает до отрисовки кадра,
    // так что ползунок не успевает мигнуть не на своём месте.
    const mo = new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1) ro.observe(n);
      place();
    });
    mo.observe(host, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-pressed", "data-active"],
    });

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      mo.disconnect();
    };
  }, deps);
}

export default useSlidingThumb;
