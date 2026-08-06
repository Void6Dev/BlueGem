import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useT } from "@/lib/i18n";

// [[Title]] -> ссылка на существующий узел (node:<id>) либо предложение создать
// новый (new:<title>) — так заметка сама подсказывает, чего в мире не хватает.
function preprocess(text, nodesByTitle) {
  return (text || "").replace(/\[\[([^\]]+)\]\]/g, (_, name) => {
    const clean = name.trim();
    const id = nodesByTitle[clean.toLowerCase()];
    return id ? `[${clean}](node:${id})` : `[${clean}](new:${encodeURIComponent(clean)})`;
  });
}

/**
 * @param {object} p
 * @param {boolean} [p.compact] режим карточки на холсте: markdown рисуется,
 *   но ссылки становятся обычным текстом — кликом по карточке владеет холст.
 */
export default function MarkdownView({ text, nodes = [], onOpenNode, onCreateNode, compact = false }) {
  const t = useT();
  const nodesByTitle = {};
  nodes.forEach((n) => {
    if (n.title) nodesByTitle[n.title.trim().toLowerCase()] = n.id;
  });
  const src = preprocess(text, nodesByTitle);

  if (!text || !text.trim()) {
    return <p className={`sw-text-dim ${compact ? "text-xs" : "text-sm"}`}>{t("common.noDescription")}</p>;
  }

  if (compact) {
    return (
      <div className="sw-md sw-md-compact text-xs leading-relaxed pointer-events-none">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          urlTransform={(url) => url}
          components={{
            a: ({ children }) => <span className="sw-accent-text">{children}</span>,
          }}
        >
          {src}
        </ReactMarkdown>
      </div>
    );
  }

  return (
    <div className="sw-md sw-md-doc leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => url}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith("node:")) {
              const id = href.slice(5);
              return (
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); onOpenNode?.(id); }}
                  className="sw-accent-text underline underline-offset-2 hover:opacity-80"
                >
                  {children}
                </button>
              );
            }
            if (href?.startsWith("new:")) {
              const title = decodeURIComponent(href.slice(4));
              return (
                <button
                  type="button"
                  title={onCreateNode ? t("markdown.createNode", { title }) : t("markdown.missingNode")}
                  onClick={(e) => { e.preventDefault(); onCreateNode?.(title); }}
                  className="sw-text-dim underline decoration-dashed underline-offset-2 hover:sw-accent-text"
                >
                  {children}
                </button>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer" className="sw-accent-text underline">
                {children}
              </a>
            );
          },
        }}
      >
        {src}
      </ReactMarkdown>
    </div>
  );
}
