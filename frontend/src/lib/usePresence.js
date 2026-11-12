import { useEffect, useState } from "react";

/**
 * Показ с уходом: экран не исчезает за кадр, а успевает доиграть анимацию
 * ухода. Пока show выключен, но время не вышло, — mounted и leaving.
 *
 * @returns {{mounted: boolean, leaving: boolean}}
 */
export function usePresence(show, ms = 200) {
  const [kept, setKept] = useState(show);
  useEffect(() => {
    if (show) { setKept(true); return undefined; }
    const t = setTimeout(() => setKept(false), ms);
    return () => clearTimeout(t);
  }, [show, ms]);
  return { mounted: show || kept, leaving: !show && kept };
}
