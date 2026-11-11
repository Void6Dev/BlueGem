import { useEffect, useState } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import Sheet from "@/components/mobile/Sheet";
import { haptic } from "@/lib/platform";

/**
 * Меню на телефоне — снизу, крупными строками под палец.
 *
 * Принимает ровно то же описание, что и ContextMenu на компьютере
 * ({ header, headerColor, items }), поэтому каждое меню приложения — по узлу,
 * связи, холсту, «Создать», «⋯» — на телефоне становится таким само, без
 * второго набора пунктов. Подменю не всплывают вбок (места нет), а открываются
 * следующей страницей с кнопкой «назад»; системная «назад» делает то же.
 */
export default function ActionSheet({ menu, onClose }) {
  const [stack, setStack] = useState([]);

  // Новое меню — с первой страницы.
  useEffect(() => { setStack([]); }, [menu]);

  if (!menu) return null;

  const page = stack[stack.length - 1];
  const items = page ? page.items : menu.items;
  const pop = () => { haptic("tick"); setStack((s) => s.slice(0, -1)); };

  const pick = (item) => {
    if (item.disabled) return;
    if (item.items?.length) {
      haptic("tick");
      setStack((s) => [...s, { title: item.label, items: item.items, id: item.id }]);
      return;
    }
    if (!item.onSelect) return;
    haptic(item.danger ? "warning" : "light");
    // Сначала закрыть, потом выполнить: пункт может открыть следующее меню.
    onClose();
    item.onSelect();
  };

  return (
    <Sheet
      key={menu.x + ":" + menu.y + ":" + (menu.header || "")}
      onClose={onClose}
      onBack={page ? pop : undefined}
      z={70}
      testId="action-sheet"
      className="sw-action-sheet"
    >
      <div className="sw-as-head">
        {page ? (
          <button type="button" className="sw-as-back" onClick={pop} data-testid="action-sheet-back">
            <ChevronLeft className="w-5 h-5" />
            <span className="truncate">{page.title}</span>
          </button>
        ) : menu.header ? (
          <div className="sw-as-title">
            {menu.headerColor && <span className="sw-as-dot" style={{ background: menu.headerColor }} />}
            <span className="truncate">{menu.header}</span>
          </div>
        ) : null}
      </div>
      <div className="sw-as-list sw-scroll-y" key={page?.id || "root"}>
        {items.map((item) => {
          if (item.separator) return <div key={item.id} className="sw-as-sep" />;
          if (item.title) return <div key={item.id} className="sw-as-caption">{item.title}</div>;
          const Icon = item.icon;
          const hasSub = !!item.items?.length;
          return (
            <button
              key={item.id}
              type="button"
              data-testid={`ctx-${item.id}`}
              disabled={item.disabled}
              onClick={() => pick(item)}
              className={`sw-as-item ${item.danger ? "is-danger" : ""}`}
            >
              <span className="sw-as-icon">
                {item.swatch ? (
                  <span className="sw-as-swatch" style={{ background: item.swatch }} />
                ) : Icon ? <Icon className="w-[18px] h-[18px]" /> : null}
              </span>
              <span className="sw-as-label">{item.label}</span>
              {item.checked && <Check className="w-[18px] h-[18px] sw-accent-text shrink-0" />}
              {hasSub && <ChevronRight className="w-[18px] h-[18px] opacity-50 shrink-0" />}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
