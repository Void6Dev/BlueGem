import * as React from "react";
import { cn } from "@/lib/utils";
import { TextField } from "@/components/ui/text-field";

// Текстовые поля — безопасные для телефонной клавиатуры (см. lib/useImeSafe).
const TEXT_TYPES = new Set([undefined, "text", "search", "email", "url"]);

const Input = React.forwardRef(({ className, type, ...props }, ref) => {
  const Tag = TEXT_TYPES.has(type) && props.value !== undefined ? TextField : "input";
  return (
    <Tag
      type={type}
      className={cn(
        "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = "Input";

export { Input };
