import { memo, useDeferredValue, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Handle, NodeResizeControl, Position, useStore, useUpdateNodeInternals } from "@xyflow/react";
import { CalendarRange, FileText, Layers, Link2, Pencil } from "lucide-react";
import { NodeIcon } from "@/components/NodeIcon";
import MiniMarkdown from "@/lib/miniMarkdown";
import { useT } from "@/lib/i18n";

// Больше в карточку всё равно не влезает, а разбирать простыню на каждый узел
// холста незачем.
const CARD_MD_LIMIT = 400;
// В режиме «граф» описание — это подпись в две строки, а не текст: там смотрят
// на связи, и высокая карточка мешает увидеть соседей.
const COMPACT_MD_LIMIT = 140;
const COMPACT_TAGS = 3;
const DETAILED_TAGS = 6;
// Сколько дат показывать, пока карточка не развёрнута. Развёрнутая показывает
// всё: её для того и разворачивают.
const DATE_LINES = 2;
const DETAILED_FIELDS = 3;

// Ширина карточки по умолчанию. Совпадает с NODE_W в Editor — там она нужна
// для расчёта центра при добавлении узла.
const DEFAULT_W = 260;

// Хват изменения ширины: стиль модульный, чтобы не давать React Flow новый
// объект на каждую перерисовку карточки.
const RESIZE_STYLE = { background: "transparent", border: "none" };

// Уровни детализации. Ниже 0.55 текст тела уже не читается — показывать его
// значит платить за разбор markdown ни за что; ниже 0.3 не читается и
// заголовок, от карточки остаётся цветная плашка с иконкой.
const LOD_ICON = 0;
const LOD_HEAD = 1;
const LOD_FULL = 2;
// Порог «карты»: ниже него карточка становится плашкой, а редактор вешает на
// холст .sw-far (см. FarZoomFlag в Editor.jsx) — числа обязаны совпадать.
export const FAR_ZOOM = 0.3;
const lodOf = (zoom) => (zoom < FAR_ZOOM ? LOD_ICON : zoom < 0.55 ? LOD_HEAD : LOD_FULL);

// Высота плашки для узла, которого ещё не видели вблизи (проект открыли уже
// отдалённым): примерно столько карточка и занимает в полном виде.
const PLATE_H_COMPACT = 120;
const PLATE_H_DETAILED = 180;

/** Микро-тост прямо у курсора: подтверждение, ради которого не стоит будить
 *  общую систему уведомлений внизу экрана. */
function microToast(text, x, y) {
  const el = document.createElement("div");
  el.className = "sw-microtoast";
  el.textContent = text;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

// Блик под курсором: координаты пишем не чаще кадра и на одну карточку за раз —
// подсветка всё равно живёт только там, где мышь.
let glowFrame = 0;
let glowAt = null;
function onGlowMove(e) {
  glowAt = { el: e.currentTarget, x: e.clientX, y: e.clientY };
  if (glowFrame) return;
  glowFrame = requestAnimationFrame(() => {
    glowFrame = 0;
    const at = glowAt;
    if (!at || !at.el.isConnected) return;
    const r = at.el.getBoundingClientRect();
    at.el.style.setProperty("--mx", `${((at.x - r.left) / r.width) * 100}%`);
    at.el.style.setProperty("--my", `${((at.y - r.top) / r.height) * 100}%`);
  });
}

function CustomNode({ data, selected }) {
  const t = useT();
  const {
    id, title, description, nodeType, fields = [], image, tags = [], date,
    degree = 0, dimmed, faded, hit, linking, linkable, onRename, onFocusField,
    expanded, neighbours = [], crossLinks = 0, onOpenNode, width, onResize,
    cardMode = "detailed", dateLines = [], canvasLabel, onMeasure,
  } = data;
  const color = nodeType?.color || "#64748b";
  const filled = fields.filter((f) => f.key);

  // Селектор возвращает номер ступени, а не сам масштаб: иначе карточка
  // перерисовывалась бы на каждый щелчок колеса — ровно то, от чего LOD должен
  // спасать на графе в две сотни узлов.
  // Отложенно: на пороге ступень меняется у всех карточек разом, и пересборка
  // трёх сотен карточек одним куском — это треть секунды, на которую зум
  // вставал посреди жеста. Отложенное значение React пересобирает с перерывами
  // на кадры: холст едет дальше, карточки догоняют его за несколько кадров.
  const lod = useDeferredValue(useStore((s) => lodOf(s.transform[2])));

  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(title || "");
  const inputRef = useRef(null);

  // Точки связи висят по середине карточки, а её высота меняется от разворота,
  // вида карточки, уровня детализации и подгрузившейся картинки. React Flow
  // снимает координаты точек при появлении узла и обновляет их своим
  // ResizeObserver — а он в этом проекте подменён на отложенный (см.
  // lib/quietResizeObserver.js). Поэтому просим пересчёт сами, и двумя путями:
  // по свойствам, задающим высоту, — этот путь от наблюдателя не зависит, —
  // и по самому изменению размера, которое ловит перетекание текста.
  // Без пересчёта и линия, и пунктир новой связи тянутся оттуда, где середина
  // карточки была раньше.
  // Просьба идёт в общую очередь редактора (onMeasure), а не прямо в React
  // Flow. Разница видна там, где высота меняется у всех карточек разом — то
  // есть на пересечении порога детализации, посреди зума: своим вызовом каждая
  // карточка заводила отдельное обновление хранилища, а на каждом таком
  // обновлении весь граф пересчитывает концы связей и ступени детализации.
  // Одна пачка на кадр вместо сотни обходов. Запасной путь оставлен на случай,
  // если карточку показали вне редактора.
  const updateNodeInternals = useUpdateNodeInternals();
  const measure = onMeasure || updateNodeInternals;
  const measuredRef = useRef(false);
  useEffect(() => {
    // Первый проход пропускаем: размеры при появлении узла React Flow снимает
    // сам, а просьба пересчитать стоит поиска по DOM — на двух сотнях карточек
    // это две сотни лишних обходов на каждом открытии проекта.
    if (!measuredRef.current) { measuredRef.current = true; return; }
    measure(id);
  }, [id, measure, expanded, cardMode, width, lod, image, description, date,
      fields.length, tags.length, neighbours.length, degree, crossLinks]);

  // Своего наблюдателя за размером здесь больше нет. React Flow вешает один
  // общий ResizeObserver на внешний узел каждой карточки и по его сигналу сам
  // пересчитывает точки связи (useNodeObserver → updateNodeInternals с
  // force). Наш наблюдал ту же самую высоту и делал ту же самую работу вторым
  // заходом — а стоил по экземпляру ResizeObserver на карточку, то есть тысячи
  // наблюдателей на большом проекте. Перетекание текста ловит общий, порядок
  // остальных изменений высоты — эффект выше по свойствам.

  // Пока не правим — держим то, что пришло снаружи (переименование из панели).
  useEffect(() => {
    if (!renaming) setNameDraft(title || "");
  }, [title, renaming]);

  useEffect(() => {
    if (!renaming) return;
    const el = inputRef.current;
    el?.focus();
    el?.select();
  }, [renaming]);

  const commitName = () => {
    setRenaming(false);
    const next = nameDraft.trim();
    if (next && next !== (title || "")) onRename?.(id, next);
    else setNameDraft(title || "");
  };

  // Высота карточки в полном виде — её занимает плашка на дальнем зуме.
  // Раньше отдалённая карточка схлопывалась до полосы шапки в 30 единиц, и
  // граф превращался в сетку тонких штрихов, перечёркнутых связями: где что
  // лежит, было не узнать, хотя вблизи раскладка та же самая. Плашка в размер
  // карточки держит ту же картину, только крупнее — карта, а не шум.
  // Читаем после отрисовки, а не наблюдателем: высота нужна лишь в момент
  // перехода на дальний зум, и прежнего замера для этого хватает.
  const wrapRef = useRef(null);
  const fullH = useRef(0);
  useLayoutEffect(() => {
    if (lod === LOD_FULL && wrapRef.current) fullH.current = wrapRef.current.offsetHeight;
  });

  const titleText = title || t("common.untitled");
  // Развёрнутая карточка показывает всё независимо от режима: её разворачивают
  // именно затем, чтобы посмотреть содержимое, не открывая панель.
  const detailed = expanded || cardMode !== "compact";
  const far = lod === LOD_ICON;
  const wrapClasses = [
    "sw-node sw-node-in relative",
    dimmed ? "sw-node-dim" : "",
    faded ? "sw-node-faded" : "",
    hit ? "sw-node-hit" : "",
    linking ? "sw-node-linking" : "",
    linkable ? "sw-node-linkable" : "",
    expanded ? "sw-node-expanded" : "",
  ].filter(Boolean).join(" ");

  // В развёрнутой карточке описание показываем целиком, а не первые 400 знаков:
  // ради этого её и разворачивают.
  const tagLimit = detailed ? DETAILED_TAGS : COMPACT_TAGS;
  const bodyText = expanded
    ? description
    : description?.slice(0, detailed ? CARD_MD_LIMIT : COMPACT_MD_LIMIT);
  const shownTags = expanded ? tags : tags.slice(0, tagLimit);
  const shownFields = expanded ? filled : filled.slice(0, DETAILED_FIELDS);
  const shownDates = expanded ? dateLines : dateLines.slice(0, DATE_LINES);

  return (
    // Внешняя обёртка без overflow — иначе она срезает половину точек связи
    // вместе с их зоной нажатия. Скругление и обрезка живут на внутренней карточке.
    // И без transform: React Flow снимает координаты точек связи с этого узла
    // один раз, и любой масштаб на нём смещает линии (см. .sw-node-in в index.css).
    <div
      ref={wrapRef}
      data-testid={`canvas-node-${data.id}`}
      className={wrapClasses}
      style={{ width: width || DEFAULT_W, "--node-color": color }}
    >
      {/* Тянуть можно только вбок: высота у карточки от содержимого, и
          растягивать её по вертикали значило бы оставлять пустоту. */}
      {/* autoScale={false}: иначе React Flow держит хват одного экранного
          размера, пересчитывая ему инлайновый стиль на каждое изменение зума —
          то есть перерисовывает по одному компоненту на карточку и пишет в DOM
          по разу на узел на каждый щелчок колеса. Видно от этого ничего не
          было: размеры и положение хвата и так заданы в .sw-node-resize
          с !important, и инлайновый масштаб они перебивали. */}
      {/* Хват живёт на всех масштабах, хотя прятать его на дальнем выглядело
          выгодно: минус подписка на хранилище с каждой карточки. Пробовали —
          отказались. Подписка стоит долей микросекунды в кадр, а появление и
          исчезновение хвата на пороге детализации — это ещё пятьсот
          монтирований в тот самый момент, когда карточки и так пересобирают
          своё содержимое. Дешёвое, но постоянное лучше редкого, но рывком. */}
      <NodeResizeControl
        position="right"
        autoScale={false}
        minWidth={200}
        maxWidth={620}
        shouldResize={(_, p) => p.direction[0] !== 0}
        onResizeEnd={(_, p) => onResize?.(id, Math.round(p.width))}
        style={RESIZE_STYLE}
        className="sw-node-resize"
      />
      {/* На каждой стороне по две точки, наложенные друг на друга: источник и
          приёмник. Одного источника мало — отрисовывая связь, React Flow ищет
          на целевом узле точку именно типа target, не находит её и молча не
          рисует линию. Внешне это один кружок: позиции совпадают. */}
      <Handle id="l" type="target" position={Position.Left} />
      <Handle id="l" type="source" position={Position.Left} />
      <div
        className={`sw-node-card sw-node-card-in ${detailed ? "is-detailed" : ""} ${far ? "is-far" : ""} ${selected || linking ? "is-selected" : ""}`}
        data-lod={lod}
        // Блик под курсором. Пишем координаты прямо в стиль элемента, минуя
        // состояние: перерисовывать React-дерево на каждое движение мыши ради
        // подсветки — это сотня лишних рендеров в секунду на графе из карточек.
        // И не чаще кадра: замер карточки — принудительный пересчёт разметки,
        // а событий мыши приходит вдвое больше, чем кадров.
        onPointerMove={onGlowMove}
      >
        {/* Рельс цвета типа — единственное, что доживает до zoom-out, когда от
            карточки остаётся несколько пикселей. Сбоку в компактном виде,
            сверху в подробном (см. .sw-node-rail в index.css). */}
        <span className="sw-node-rail" aria-hidden="true" />
        {/* Дальний зум: плашка цвета типа в размер карточки, крупный значок и
            крупное имя. Имя набрано в единицах холста с запасом — на 0.3 оно
            ещё читается как подпись на карте, ниже остаётся фактурой, а тип
            и так говорит цвет. Описание, теги и счётчики здесь не рисуем:
            ни прочесть, ни попасть по ним на этом масштабе нельзя. */}
        {far && (
          <div
            className="sw-node-plate"
            data-testid={`node-plate-${id}`}
            style={{ minHeight: fullH.current || (detailed ? PLATE_H_DETAILED : PLATE_H_COMPACT) }}
          >
            <span className="sw-node-badge-icon is-plate">
              <NodeIcon name={nodeType?.icon} className="text-white" />
            </span>
            <span className={`sw-node-plate-title ${title ? "" : "sw-untitled"}`}>{titleText}</span>
          </div>
        )}
        {/* Шапка. Значок и название типа; имя узла живёт ниже, в теле — цветная
            плашка с именем опознавалась хуже, чем слово «Персонаж». */}
        {!far && (
        <div className="sw-node-head">
          <span className="sw-node-badge-icon">
            <NodeIcon name={nodeType?.icon} className="text-white" />
          </span>
          {/* Рисуем и без подписи: пустая строка на flex:1 работает распоркой,
              иначе счётчик связей приезжает вплотную к значку. */}
          <span className="sw-node-type" data-testid={`node-type-${id}`}>{nodeType?.label || ""}</span>
          {degree > 0 && (
            <span
              className="sw-badge sw-badge-mute shrink-0"
              title={t("node.linksCount", { count: degree })}
            >
              <Link2 className="w-2.5 h-2.5" />
              {degree}
            </span>
          )}
          {/* Связи, уходящие на другие холсты. Линию туда нарисовать негде —
              второй конец не на этом холсте, — поэтому о ней говорит метка,
              а клик по ней перебрасывает к собеседнику. */}
          {crossLinks > 0 && (
            <button
              type="button"
              data-testid={`node-cross-${id}`}
              className="sw-badge sw-badge-cross shrink-0 nodrag"
              title={t("node.crossCanvas", { count: crossLinks })}
              onClick={(e) => {
                e.stopPropagation();
                const away = neighbours.find((n) => n.away);
                if (away) onOpenNode?.(away.id);
              }}
            >
              <Layers className="w-2.5 h-2.5" />
              {crossLinks}
            </button>
          )}
        </div>
        )}

        {/* Картинка — только в «карточках». В режиме графа она съедает
            четверть экрана на узел, а связи ради этого не читаются. */}
        {lod === LOD_FULL && detailed && image && (
          <div className="sw-node-img-wrap">
            {/* Картинка приезжает позже разметки и толкает карточку вниз —
                точки связи после этого надо пересчитать заново. */}
            {/* decoding="async": разбор картинки уходит с основного потока —
                иначе десяток карточек с фотографиями подряд стопорит холст
                ровно в тот момент, когда по нему ведут мышью. */}
            <img
              src={image}
              alt=""
              loading="lazy"
              decoding="async"
              onLoad={() => measure(id)}
              className="sw-node-img"
            />
          </div>
        )}

        {/* Тело живёт на ступень раньше остального содержимого: с именем узла
            в шапке LOD_HEAD показывал название сам, теперь название здесь —
            и без него на средних масштабах от карточки остаётся один тип. */}
        {!far && (
            <div
              className="sw-node-body px-3.5 py-3"
              // Клик по строке имени сюда не считается: у неё своя цель в панели.
              onClick={(e) => {
                if (e.target.closest(".sw-node-title-row")) return;
                onFocusField?.(id, "description");
              }}
              title={t("node.editDescHint")}
            >
              {/* Карандаш проявляется под курсором: тело карточки кликабельно —
                  клик открывает описание в панели, — но на вид оно просто текст,
                  и без подсказки это не найти. */}
              <span className="sw-node-edit-hint" aria-hidden="true">
                <Pencil className="w-3 h-3" />
              </span>
              <div className="sw-node-title-row">
                {renaming ? (
                  <input
                    ref={inputRef}
                    data-testid={`node-inline-title-${id}`}
                    // nodrag/nopan: пока правим имя, холст не должен уезжать под курсором.
                    className="sw-node-title-input nodrag nopan sw-node-title"
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                    onBlur={commitName}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") { e.preventDefault(); commitName(); }
                      if (e.key === "Escape") { e.preventDefault(); setNameDraft(title || ""); setRenaming(false); }
                    }}
                  />
                ) : (
                  <span
                    data-testid={`node-title-${id}`}
                    title={t("node.renameHint")}
                    // Одиночный клик всплывает дальше — холст сам откроет панель узла,
                    // а мы лишь подсказываем ей, к какому полю подъехать ползунком.
                    // Alt+клик копирует название: спрашивать об этом диалогом дороже,
                    // чем сделать.
                    onClick={(e) => {
                      if (e.altKey) {
                        e.stopPropagation();
                        navigator.clipboard?.writeText(titleText);
                        microToast(t("common.copied"), e.clientX, e.clientY);
                        return;
                      }
                      onFocusField?.(id, "title");
                    }}
                    onDoubleClick={(e) => { e.stopPropagation(); setRenaming(true); }}
                    className={`sw-node-title truncate flex-1 cursor-text rounded px-0.5 -mx-0.5
                      transition-colors hover:bg-[var(--sw-hover)] ${title ? "" : "sw-untitled"}`}
                  >
                    {titleText}
                  </span>
                )}
              </div>
              {lod === LOD_FULL && (
                <div className="mt-1.5">
              {/* Даты. Их у узла бывает несколько — родился, умер, основан, —
                  и на карточке они шли мимо: показывалось только старое
                  одиночное поле `date`, а всё, что заведено хронологией,
                  было видно лишь в панели и на шкале времени. */}
              {detailed && (dateLines.length > 0 || date) && (
                <div className="sw-node-dates mb-1.5">
                  {date && (
                    <span className="sw-node-date">
                      <CalendarRange className="w-2.5 h-2.5 shrink-0" />{date}
                    </span>
                  )}
                  {shownDates.map((d) => (
                    <span key={d.key} className="sw-node-date" title={d.label || undefined}>
                      <CalendarRange className="w-2.5 h-2.5 shrink-0" />
                      {d.label && <span className="sw-node-date-key">{d.label}</span>}
                      {d.text}
                    </span>
                  ))}
                  {!expanded && dateLines.length > DATE_LINES && (
                    <span className="sw-node-date">+{dateLines.length - DATE_LINES}</span>
                  )}
                </div>
              )}
              {/* Тот же markdown, что и в просмотре справа, — карточка больше не
                  показывает звёздочки и решётки сырым текстом. */}
              {description && (
                <div className={`sw-node-md ${expanded ? "" : detailed ? "sw-node-md-clip" : "sw-node-md-clamp"}`}>
                  <MiniMarkdown text={bodyText} />
                </div>
              )}
              {/* Поля таблицей «ключ — значение»: значения выстраиваются в
                  колонку, ряд карточек перестаёт выглядеть рваным. */}
              {detailed && filled.length > 0 && (
                <div className="sw-node-fields mt-2">
                  {shownFields.map((f, i) => (
                    <div key={`${f.key}-${i}`} className="contents">
                      <span className="sw-node-field-key truncate">{f.key}</span>
                      <span className="sw-node-field-val">{f.value || "—"}</span>
                    </div>
                  ))}
                  {!expanded && filled.length > DETAILED_FIELDS && (
                    <span className="sw-node-field-key col-span-2">+{filled.length - DETAILED_FIELDS}</span>
                  )}
                </div>
              )}
              {tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {shownTags.map((tag) => (
                    <span key={`tag-${tag}`} className="sw-node-tag">{tag}</span>
                  ))}
                  {!expanded && tags.length > tagLimit && (
                    <span className="sw-node-tag" style={{ background: "var(--sw-surface-2)" }}>
                      +{tags.length - tagLimit}
                    </span>
                  )}
                </div>
              )}

              {/* Итог по узлу. В режиме графа этой строки нет — там счётчик
                  связей и так стоит в шапке, а высота карточки на счету.
                  Число связей здесь не повторяем: оно уже в шапке, а в
                  развёрнутой карточке ниже идёт и сам их список. */}
              {detailed && (filled.length > 0 || crossLinks > 0 || canvasLabel) && (
                <div className="sw-node-meta mt-2.5">
                  {filled.length > 0 && (
                    <span title={t("node.fieldsCount", { count: filled.length })}>
                      <FileText className="w-3 h-3" />
                      {t("node.fieldsCount", { count: filled.length })}
                    </span>
                  )}
                  {crossLinks > 0 && (
                    <span title={t("node.crossCanvas", { count: crossLinks })}>
                      <Layers className="w-3 h-3" />
                      {crossLinks}
                    </span>
                  )}
                  {/* Страница узла: на проекте из девяти холстов «где это
                      лежит» — такой же факт о узле, как его тип. */}
                  {canvasLabel && (
                    <span className="truncate" title={canvasLabel}>
                      <Layers className="w-3 h-3" />
                      {canvasLabel}
                    </span>
                  )}
                </div>
              )}

              {/* Соседи — только в развёрнутом виде. Это главное, ради чего
                  карточку и разворачивают: увидеть окружение узла, не открывая
                  панель и не прослеживая линии глазами. */}
              {expanded && neighbours.length > 0 && (
                <div className="sw-node-links mt-2.5" data-testid={`node-links-${id}`}>
                  <span className="sw-section-label">
                    {t("node.connections")}
                    <span className="sw-node-links-count">{neighbours.length}</span>
                  </span>
                  {neighbours.map((n, i) => (
                    <button
                      key={`${n.id}-${i}`}
                      type="button"
                      className="sw-node-link nodrag"
                      onClick={(e) => { e.stopPropagation(); onOpenNode?.(n.id); }}
                      title={n.rel || undefined}
                    >
                      <span className="sw-node-link-dir">{n.outgoing ? "→" : "←"}</span>
                      <span
                        className="sw-node-link-dot"
                        style={{ background: n.color || "var(--sw-border-strong)" }}
                      />
                      <span className="truncate">{n.title || t("common.untitled")}</span>
                      {/* Кем приходится: подпись связи или название её типа.
                          Без неё список отвечает «с кем», но не «как». */}
                      {n.rel && <span className="sw-node-link-rel truncate">{n.rel}</span>}
                      {/* Сосед лежит на другой странице — линии к нему на этом
                          холсте нет, и без метки он выглядит как обычный. */}
                      {n.away && <Layers className="w-2.5 h-2.5 shrink-0 opacity-60" />}
                    </button>
                  ))}
                </div>
              )}
                </div>
              )}
            </div>
        )}
      </div>
      <Handle id="r" type="target" position={Position.Right} />
      <Handle id="r" type="source" position={Position.Right} />
    </div>
  );
}

export default memo(CustomNode);
