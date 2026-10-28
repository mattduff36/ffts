"use client";

import * as React from "react"

import { cn } from "@/lib/utils/cn"

const IN_PROGRESS_NUMERIC_DRAFT = /^-?\d*\.?\d*$/;

function isNumericDraftEcho(draft: string, parentValue: unknown): boolean {
  if (parentValue == null || parentValue === "") {
    return draft.trim() === "";
  }

  const normalizedDraft = draft.trim();
  if (
    normalizedDraft === ""
    || normalizedDraft === "-"
    || normalizedDraft === "."
    || normalizedDraft === "-."
  ) {
    return parentValue === 0 || parentValue === "0";
  }

  if (String(parentValue) === draft || String(parentValue) === normalizedDraft) {
    return true;
  }

  if (!IN_PROGRESS_NUMERIC_DRAFT.test(normalizedDraft)) {
    return false;
  }

  const draftNumber = Number(normalizedDraft);
  const parentNumber = typeof parentValue === "number"
    ? parentValue
    : Number(String(parentValue).trim());

  return Number.isFinite(draftNumber)
    && Number.isFinite(parentNumber)
    && draftNumber === parentNumber;
}

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, value, onChange, onBlur, onFocus, ...props }, ref) => {
    const isControlledNumber = type === "number" && value !== undefined;
    const [draft, setDraft] = React.useState<string | null>(null);
    const lastParentValueRef = React.useRef(value);

    React.useEffect(() => {
      if (!isControlledNumber) return;
      if (Object.is(lastParentValueRef.current, value)) return;

      lastParentValueRef.current = value;
      setDraft((current) => {
        if (current === null) return null;
        return isNumericDraftEcho(current, value) ? current : null;
      });
    }, [isControlledNumber, value]);

    const displayValue = isControlledNumber && draft !== null ? draft : value;

    return (
      <input
        type={type}
        className={cn(
          "ui-component flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base text-foreground ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm [&::placeholder]:!text-slate-400 dark:[&::placeholder]:!text-slate-400",
          className
        )}
        ref={ref}
        {...props}
        value={displayValue}
        onFocus={(event) => {
          if (isControlledNumber) {
            setDraft(event.currentTarget.value);
          }
          onFocus?.(event);
        }}
        onChange={(event) => {
          if (isControlledNumber) {
            setDraft(event.target.value);
          }
          onChange?.(event);
        }}
        onBlur={(event) => {
          if (isControlledNumber) {
            setDraft(null);
          }
          onBlur?.(event);
        }}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
