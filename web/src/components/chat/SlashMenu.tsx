import { useMemo } from "react";

/** Une entrée du menu « / ». */
export interface SlashItem {
  /** Nom sans le slash : « goal », « plan », « gif-search »… */
  name: string;
  /** Courte explication affichée à droite. */
  hint: string;
  group: "Commande" | "Skill";
}

/**
 * Commandes intégrées à Hermes (référence `reference/slash-commands.md`).
 * Un skill qui porte le même nom reste accessible via `/skill <nom>`.
 */
export const HERMES_COMMANDS: SlashItem[] = [
  { name: "new", hint: "nouvelle conversation", group: "Commande" },
  { name: "plan", hint: "écrire un plan avant d'agir", group: "Commande" },
  { name: "goal", hint: "objectif de la session", group: "Commande" },
  { name: "loop", hint: "tâche récurrente", group: "Commande" },
  { name: "model", hint: "changer de modèle", group: "Commande" },
  { name: "skill", hint: "charger un skill précis", group: "Commande" },
  { name: "skills", hint: "lister les skills installés", group: "Commande" },
  { name: "save", hint: "sauvegarder la conversation", group: "Commande" },
  { name: "history", hint: "revoir l'historique", group: "Commande" },
  { name: "help", hint: "toutes les commandes", group: "Commande" },
];

/**
 * Filtre les entrées sur ce qui suit le slash.
 * Un skill masqué par une commande de même nom n'est pas proposé : Hermes
 * refuserait le raccourci (la commande intégrée gagne toujours).
 */
export function filterSlashItems(
  skills: ReadonlyArray<{ name: string }> = [],
  query = ""
): SlashItem[] {
  const q = query.trim().toLowerCase();
  const builtins = HERMES_COMMANDS.filter((item) => item.name.startsWith(q));
  const taken = new Set(HERMES_COMMANDS.map((item) => item.name));
  const dynamic = skills
    .filter((skill) => skill.name && !taken.has(skill.name))
    .map<SlashItem>((skill) => ({ name: skill.name, hint: "skill", group: "Skill" }))
    .filter((item) => item.name.toLowerCase().startsWith(q))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...builtins, ...dynamic];
}

interface Props {
  items: SlashItem[];
  /** Index surligné (navigation clavier). */
  active: number;
  onPick: (item: SlashItem) => void;
  onHover: (index: number) => void;
}

export default function SlashMenu({ items, active, onPick, onHover }: Props) {
  const groups = useMemo(() => {
    const out: Array<{ label: string; rows: Array<{ item: SlashItem; index: number }> }> = [];
    items.forEach((item, index) => {
      let group = out.find((g) => g.label === item.group);
      if (!group) {
        group = { label: item.group, rows: [] };
        out.push(group);
      }
      group.rows.push({ item, index });
    });
    return out;
  }, [items]);

  if (items.length === 0) return null;

  return (
    <div className="slash" role="listbox" aria-label="Commandes et skills">
      {groups.map((group) => (
        <div className="slash__group" key={group.label}>
          <p className="slash__label">{group.label}</p>
          {group.rows.map(({ item, index }) => (
            <button
              type="button"
              key={`${item.group}-${item.name}`}
              role="option"
              aria-selected={index === active}
              className="slash__item"
              data-active={index === active}
              onMouseEnter={() => onHover(index)}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(item);
              }}
            >
              <span className="slash__name">/{item.name}</span>
              <span className="slash__hint">{item.hint}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
