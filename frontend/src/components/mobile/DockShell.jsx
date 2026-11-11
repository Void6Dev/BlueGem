import { motion } from "framer-motion";
import Sheet from "@/components/mobile/Sheet";
import { useIsMobile } from "@/lib/platform";

/**
 * Оболочка правой панели (узел, связь): на компьютере — закреплённая колонка
 * у холста, на телефоне — шторка снизу. Содержимое панели одно и то же: шапка,
 * прокрутка, кнопки внизу; меняется только то, во что оно вложено.
 */
export default function DockShell({
  children, onClose, testId, detent = "full", className = "", ...motionProps
}) {
  const mobile = useIsMobile();
  if (mobile) {
    return (
      <Sheet detent={detent} onClose={onClose} testId={testId}>
        <div className={`sw-dock-in-sheet ${className}`}>{children}</div>
      </Sheet>
    );
  }
  return (
    <motion.div {...motionProps} className={className} data-testid={testId}>
      {children}
    </motion.div>
  );
}
