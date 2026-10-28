import { useCallback, useEffect, useState } from "react";

/**
 * Sous-agents masqués à la main.
 *
 * Le masquage est partagé entre la barre latérale et la vue Agents : les deux
 * lisent la même clé et se préviennent par un évènement `window`, pour qu'un
 * sous-agent fermé ne réapparaisse pas ailleurs.
 */
const KEY = "cockpit.dismissed-subagents";
const EVENT = "cockpit:dismissed-subagents";

export function readDismissed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(KEY);
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set<string>();
  }
}

export function dismissSubagent(id: string): void {
  const next = readDismissed();
  next.add(id);
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...next]));
  } catch {
    /* stockage plein ou bloqué : la session courante garde son état en mémoire */
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function useDismissedSubagents(): [Set<string>, (id: string) => void] {
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed());

  useEffect(() => {
    const sync = () => setDismissed(readDismissed());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  // Mise à jour immédiate de l'état local : le composant qui a déclenché le
  // masquage n'attend pas l'évènement pour se redessiner.
  const dismiss = useCallback((id: string) => {
    dismissSubagent(id);
    // On met à jour l'état à partir de la valeur connue : si le stockage est
    // indisponible (mode privé, quota), le masquage doit quand même s'appliquer.
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);
  return [dismissed, dismiss];
}
