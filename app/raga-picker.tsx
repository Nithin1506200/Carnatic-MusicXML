import { useState } from "react";

const searchText = (text: string) =>
  text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

export default function RagaPicker({
  value,
  names,
  onChange,
}: {
  value: string;
  names: string[];
  onChange: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const matches = names.filter((name) =>
    searchText(name).includes(searchText(query.trim())),
  );
  const listId = "playground-raga-options";

  const choose = (name: string) => {
    onChange(name);
    setOpen(false);
  };
  const showOptions = () => {
    if (!open) {
      setQuery("");
      setHighlighted(0);
      setOpen(true);
    }
  };

  return (
    <div className="raga-picker">
      <label htmlFor="playground-raga">
        <small>Raga</small>
      </label>
      <input
        id="playground-raga"
        type="text"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={
          open && matches[highlighted] ? `${listId}-${highlighted}` : undefined
        }
        placeholder={open ? "Search ragas…" : value}
        value={open ? query : value}
        onFocus={showOptions}
        onClick={showOptions}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          setQuery(event.target.value);
          setHighlighted(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) showOptions();
            else if (matches.length) {
              const direction = event.key === "ArrowDown" ? 1 : -1;
              const next =
                (highlighted + direction + matches.length) % matches.length;
              setHighlighted(next);
              document
                .getElementById(`${listId}-${next}`)
                ?.scrollIntoView({ block: "nearest" });
            }
          } else if (event.key === "Enter" && open) {
            event.preventDefault();
            if (matches[highlighted]) choose(matches[highlighted]);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {open && (
        <div className="raga-picker-popup">
          <ul id={listId} role="listbox" aria-label="Ragas">
            {matches.map((name, index) => (
              <li
                key={name}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={name === value}
                className={highlighted === index ? "is-highlighted" : ""}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(name)}
                onMouseEnter={() => setHighlighted(index)}
              >
                {name}
                {name === value && <span aria-hidden="true">✓</span>}
              </li>
            ))}
          </ul>
          {matches.length === 0 && <p role="status">No matching ragas</p>}
        </div>
      )}
    </div>
  );
}
