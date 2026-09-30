import { useMemo } from "react";
import { renderMarkdown } from "@/lib/miniMarkdown";
import { useT } from "@/lib/i18n";

/**
 * Собранный markdown — и на карточке холста, и в панели справа.
 *
 * Разбор один на оба места (lib/miniMarkdown), и это не только про скорость.
 * Пока их было два — свой на карточке и react-markdown в панели, — один и тот
 * же текст выглядел по-разному в двух местах одного экрана: разные наборы
 * поддержанного синтаксиса, разные сноски, английский заголовок «Footnotes»
 * посреди русского интерфейса. Теперь разница между режимами ровно одна и
 * названа явно: в панели ссылки живые, на карточке — нет, потому что кликом по
 * карточке владеет холст.
 *
 * @param {object} p
 * @param {boolean} [p.compact] режим карточки на холсте.
 */
export default function MarkdownView({ text, nodes = [], onOpenNode, onCreateNode, compact = false }) {
  const t = useT();
  // Карта названий: по ней [[Ссылка]] находит узел. Строится по всем узлам
  // проекта, поэтому по памяти — набор в описании перерисовывает просмотр на
  // каждую букву.
  const nodesByTitle = useMemo(() => {
    const map = {};
    for (const n of nodes) if (n.title) map[n.title.trim().toLowerCase()] = n.id;
    return map;
  }, [nodes]);

  const tree = useMemo(() => {
    if (!text || !text.trim()) return null;
    if (compact) return renderMarkdown(text);
    return renderMarkdown(text, {
      doc: true,
      nodesByTitle,
      onOpenNode,
      onCreateNode,
      createTitle: (title) => t("markdown.createNode", { title }),
      missingTitle: t("markdown.missingNode"),
    });
  }, [text, compact, nodesByTitle, onOpenNode, onCreateNode, t]);

  if (!tree) {
    return <p className={`sw-text-dim ${compact ? "text-xs" : "text-sm"}`}>{t("common.noDescription")}</p>;
  }

  if (compact) {
    return <div className="sw-md sw-md-compact text-xs leading-relaxed pointer-events-none">{tree}</div>;
  }

  return <div className="sw-md sw-md-doc leading-relaxed">{tree}</div>;
}
