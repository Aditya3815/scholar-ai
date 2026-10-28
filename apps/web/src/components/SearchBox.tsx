import { ArrowRight, Search, X } from "lucide-react";
import type { RefObject } from "react";

export function SearchBox({
  value,
  onChange,
  onSubmit,
  inputRef,
  busy = false,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
  busy?: boolean;
}) {
  return (
    <form
      className="searchbox searchbox-compact"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <Search className="searchbox-icon" size={18} aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search papers, topics, or paste a DOI"
        aria-label="Search papers"
        maxLength={300}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
      />
      {value && (
        <button
          type="button"
          className="searchbox-clear"
          aria-label="Clear search"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
        >
          <X size={16} aria-hidden="true" />
        </button>
      )}
      <kbd className="searchbox-kbd" aria-hidden="true">
        /
      </kbd>
      <button type="submit" className="btn btn-primary searchbox-go" disabled={value.trim().length < 2 || busy}>
        <span>{busy ? "Searching" : "Search"}</span>
        <ArrowRight size={16} aria-hidden="true" />
      </button>
    </form>
  );
}
