import * as React from "react";
import { useImeSafe } from "@/lib/useImeSafe";

/**
 * <input> для текста, безопасный для телефонной клавиатуры (см. useImeSafe).
 * Пишется как обычное управляемое поле: value + onChange.
 */
export const TextField = React.forwardRef(
  ({ value, onChange, onCompositionStart, onCompositionEnd, ...rest }, ref) => {
    const safe = useImeSafe({ value, onChange, onCompositionStart, onCompositionEnd, ref });
    return <input {...rest} {...safe} />;
  },
);
TextField.displayName = "TextField";

/** То же для <textarea>. */
export const TextArea = React.forwardRef(
  ({ value, onChange, onCompositionStart, onCompositionEnd, ...rest }, ref) => {
    const safe = useImeSafe({ value, onChange, onCompositionStart, onCompositionEnd, ref });
    return <textarea {...rest} {...safe} />;
  },
);
TextArea.displayName = "TextArea";
