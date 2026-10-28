import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export interface ProviderModels {
  slug: string;
  name: string;
  models: string[];
  is_current: boolean;
}

export interface ModelRef {
  provider: string;
  model: string;
}

interface Props {
  providers: ProviderModels[];
  value: ModelRef | null;
  onChange: (next: ModelRef) => void;
  disabled?: boolean;
}

interface Option {
  provider: string;
  providerName: string;
  model: string;
  id: string;
}

/** Nom court : dernier segment du chemin, tronqué pour tenir dans le bouton. */
export function shortModel(model: string, max = 26): string {
  const leaf = model.split("/").filter(Boolean).pop() ?? model;
  return leaf.length > max ? `${leaf.slice(0, max - 1)}…` : leaf;
}

function optionId(provider: string, model: string): string {
  return `mp-${provider}-${model}`.replace(/[^a-zA-Z0-9_-]/g, "-");
}

/** Liste plate des modèles filtrés, dans l'ordre des providers fournis. */
export function filterOptions(providers: ProviderModels[], query: string): Option[] {
  const q = query.trim().toLowerCase();
  const out: Option[] = [];
  for (const provider of providers) {
    const haystack = `${provider.name} ${provider.slug}`.toLowerCase();
    const providerMatches = q.length > 0 && haystack.includes(q);
    for (const model of provider.models) {
      if (q.length > 0 && !providerMatches && !model.toLowerCase().includes(q)) continue;
      out.push({
        provider: provider.slug,
        providerName: provider.name,
        model,
        id: optionId(provider.slug, model),
      });
    }
  }
  return out;
}

/**
 * Sélecteur de modèle contrôlé : bouton compact + panneau de recherche.
 * Navigation clavier ↑ ↓ Entrée Échap, listbox ARIA, aucun état métier interne.
 */
export default function ModelPicker({ providers, value, onChange, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const listId = `${useId()}-modeles`;

  const options = useMemo(() => filterOptions(providers, query), [providers, query]);

  const selectedIndex = useMemo(
    () => options.findIndex((o) => o.provider === value?.provider && o.model === value?.model),
    [options, value],
  );

  const currentProvider = providers.find((p) => p.slug === value?.provider);
  const label = value ? shortModel(value.model) : "modèle du profil";

  const close = useCallback((refocus = true) => {
    setOpen(false);
    setQuery("");
    if (refocus) triggerRef.current?.focus();
  }, []);

  const openPanel = useCallback(() => {
    setOpen(true);
    setQuery("");
    setActive(selectedIndex >= 0 ? selectedIndex : 0);
  }, [selectedIndex]);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
  }, [open]);

  // Fermeture au clic extérieur (le panneau est en position absolue).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, close]);

  // Garde l'élément actif visible et dans les bornes quand la liste change.
  useEffect(() => {
    if (!open) return;
    if (options.length === 0) {
      setActive(-1);
      return;
    }
    setActive((prev) => (prev < 0 || prev >= options.length ? 0 : prev));
  }, [open, options.length]);

  useEffect(() => {
    if (!open || active < 0) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    node?.scrollIntoView?.({ block: "nearest" });
  }, [open, active]);

  const select = useCallback(
    (option: Option) => {
      onChange({ provider: option.provider, model: option.model });
      close();
    },
    [onChange, close],
  );

  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      // N'atteint pas la modale qui nous héberge : on ne ferme que le panneau.
      event.stopPropagation();
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (options.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((prev) => {
        const from = prev < 0 ? (step > 0 ? -1 : 0) : prev;
        return (from + step + options.length) % options.length;
      });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const option = options[active];
      if (option) select(option);
      return;
    }
    if (event.key === "Tab") close(false);
  };

  const groups = useMemo(() => {
    const map = new Map<string, { name: string; items: Option[] }>();
    for (const option of options) {
      const entry = map.get(option.provider) ?? { name: option.providerName, items: [] };
      entry.items.push(option);
      map.set(option.provider, entry);
    }
    return [...map.entries()].map(([slug, entry]) => ({ slug, ...entry }));
  }, [options]);

  return (
    <div className="mp" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="mp__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`Modèle : ${value ? `${currentProvider?.name ?? value.provider} ${value.model}` : "modèle du profil"}`}
        title={value ? `${currentProvider?.name ?? value.provider} · ${value.model}` : "Modèle du profil"}
        onClick={() => (open ? close() : openPanel())}
        disabled={disabled}
      >
        <span className="mp__icon" aria-hidden="true">◇</span>
        <span className="mp__label">{label}</span>
        <span className="mp__chev" aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div className="mp__panel">
          <input
            ref={searchRef}
            className="mp__search"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? options[active]?.id : undefined}
            placeholder="Rechercher un modèle…"
            aria-label="Rechercher un modèle"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            disabled={disabled}
          />

          <div className="mp__list" role="listbox" id={listId} aria-label="Modèles disponibles" ref={listRef}>
            {options.length === 0 && <p className="mp__empty">Aucun modèle ne correspond.</p>}
            {groups.map((group) => (
              <div className="mp__group" role="group" aria-label={group.name} key={group.slug}>
                <div className="mp__group-label" aria-hidden="true">
                  {group.name}
                </div>
                {group.items.map((option) => {
                  const index = options.indexOf(option);
                  const isSelected = option.provider === value?.provider && option.model === value?.model;
                  return (
                    <div
                      key={option.id}
                      id={option.id}
                      data-index={index}
                      role="option"
                      aria-selected={isSelected}
                      className="mp__option"
                      data-active={index === active}
                      data-selected={isSelected}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => select(option)}
                      title={option.model}
                    >
                      <span className="mp__check" aria-hidden="true">{isSelected ? "✓" : ""}</span>
                      <span className="mp__opt-name">{shortModel(option.model, 40)}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
