import { memo, useEffect, useRef, useState } from "react";
import { Handle, Position, useStore } from "@xyflow/react";
import { CalendarRange, Link2 } from "lucide-react";
import { NodeIcon } from "@/components/NodeIcon";
import MarkdownView from "@/components/MarkdownView";
import { useT } from "@/lib/i18n";

// Больше в карточку всё равно не влезает, а react-markdown не заставляем
// разбирать простыню на каждый узел холста.
const CARD_MD_LIMIT = 400;

// Уровни детализации. Ниже 0.55 текст тела уже не читается — показывать его
// значит платить за разбор markdown ни за что; ниже 0.3 не читается и
// заголовок, от карточки остаётся цветная плашка с иконкой.
const LOD_ICON = 0;
const LOD_HEAD = 1;
const LOD_FULL = 2;
const lodOf = (zoom) => (zoom < 0.3 ? LOD_ICON : zoom < 0.55 ? LOD_HEAD : LOD_FULL);

// Карточка перерисовывается на каждое выделение и поиск, а разбор markdown —
// самое дорогое, что в ней есть. Отдельный memo по одной строке: пока текст
// не менялся, дерево не пересобирается.
const CardBody = memo(function CardBody({ text }) {
  return <MarkdownView text={text} compact />;
});

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

function CustomNode({ data, selected }) {
  const t = useT();
  const {
    id, title, description, nodeType, fields = [], image, tags = [], date,
    degree = 0, dimmed, faded, hit, linking, linkable, onRename, onFocusField,
  } = data;
  const color = nodeType?.color || "#64748b";
  const filled = fields.filter((f) => f.key);

  // Селектор возвращает номер ступени, а не сам масштаб: иначе карточка
  // перерисовывалась бы на каждый щелчок колеса — ровно то, от чего LOD должен
  // спасать на графе в две сотни узлов.
  const lod = useStore((s) => lodOf(s.transform[2]));

  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(title || "");
  const inputRef = useRef(null);

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

  const titleText = title || t("common.untitled");
  const wrapClasses = [
    "sw-node sw-node-in relative",
    dimmed ? "sw-node-dim" : "",
    faded ? "sw-node-faded" : "",
    hit ? "sw-node-hit" : "",
    linking ? "sw-node-linking" : "",
    linkable ? "sw-node-linkable" : "",
  ].filter(Boolean).join(" ");

  return (
    // Внешняя обёртка без overflow — иначе она срезает половину точек связи
    // вместе с их зоной нажатия. Скругление и обрезка живут на внутренней карточке.
    // И без transform: React Flow снимает координаты точек связи с этого узла
    // один раз, и любой масштаб на нём смещает линии (см. .sw-node-in в index.css).
    <div
      data-testid={`canvas-node-${data.id}`}
      className={wrapClasses}
      style={{ width: 260, "--node-color": color }}
    >
      <Handle type="target" position={Position.Left} />
      <div
        className={`sw-node-card sw-node-card-in ${selected || linking ? "is-selected" : ""}`}
        data-lod={lod}
      >
        {/* Шапка. Цветной рельс сверху — то, что делает тип читаемым при
            zoom-out, когда от шапки остаётся четыре пикселя. */}
        <div className="sw-node-head" style={lod === LOD_ICON ? { height: 34, justifyContent: "center" } : undefined}>
          <span className="sw-node-badge-icon">
            <NodeIcon name={nodeType?.icon} className="w-3.5 h-3.5 text-white" />
          </span>
          {lod > LOD_ICON && (renaming ? (
            <input
              ref={inputRef}
              data-testid={`node-inline-title-${id}`}
              // nodrag/nopan: пока правим имя, холст не должен уезжать под курсором.
              className="sw-node-title-input nodrag nopan sw-t-card"
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
              className={`sw-t-card sw-node-head-title truncate flex-1 cursor-text rounded px-0.5 -mx-0.5
                transition-colors hover:bg-[var(--sw-hover)] ${title ? "" : "sw-untitled"}`}
              style={{ color: "var(--sw-text)" }}
            >
              {titleText}
            </span>
          ))}
          {lod > LOD_ICON && degree > 0 && (
            <span
              className="sw-badge sw-badge-mute shrink-0"
              title={t("node.linksCount", { count: degree })}
            >
              <Link2 className="w-2.5 h-2.5" />
              {degree}
            </span>
          )}
        </div>

        {lod === LOD_FULL && (
          <>
            {image && (
              <div className="sw-node-img-wrap">
                <img src={image} alt="" loading="lazy" className="sw-node-img" />
              </div>
            )}
            <div
              className="px-3.5 py-3"
              onClick={() => onFocusField?.(id, "description")}
              title={t("node.editDescHint")}
            >
              {date && (
                <div className="sw-badge sw-badge-quiet mb-1.5 px-0">
                  <CalendarRange className="w-2.5 h-2.5" /> {date}
                </div>
              )}
              {/* Тот же markdown, что и в просмотре справа, — карточка больше не
                  показывает звёздочки и решётки сырым текстом. */}
              {description && (
                <div className="sw-node-md">
                  <CardBody text={description.slice(0, CARD_MD_LIMIT)} />
                </div>
              )}
              {/* Поля таблицей «ключ — значение»: значения выстраиваются в
                  колонку, ряд карточек перестаёт выглядеть рваным. */}
              {filled.length > 0 && (
                <div className="sw-node-fields mt-2">
                  {filled.slice(0, 3).map((f, i) => (
                    <div key={`${f.key}-${i}`} className="contents">
                      <span className="sw-node-field-key truncate">{f.key}</span>
                      <span className="sw-node-field-val">{f.value || "—"}</span>
                    </div>
                  ))}
                  {filled.length > 3 && (
                    <span className="sw-node-field-key col-span-2">+{filled.length - 3}</span>
                  )}
                </div>
              )}
              {tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {tags.slice(0, 3).map((tag) => (
                    <span key={`tag-${tag}`} className="sw-node-tag">{tag}</span>
                  ))}
                  {tags.length > 3 && (
                    <span className="sw-node-tag" style={{ background: "var(--sw-surface-2)" }}>
                      +{tags.length - 3}
                    </span>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export default memo(CustomNode);
