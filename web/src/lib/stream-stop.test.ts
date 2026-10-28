import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useChatStream } from "./api";

/**
 * Ultracode lance trois tours en parallèle. « Arrêter » doit couper les trois :
 * avant ce test, seul le dernier AbortController était conservé et les deux
 * autres tours continuaient leur travail, l'animation avec eux.
 */
describe("useChatStream — arrêt de plusieurs tours", () => {
  beforeEach(() => {
    // fetch qui ne se résout jamais : les tours restent en vol.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {}))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("stop() annule tous les tours en cours, pas seulement le dernier", async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, "abort");
    const { result } = renderHook(() => useChatStream(() => {}, () => {}, () => {}));

    void result.current.send("s1", "premier");
    void result.current.send("s2", "deuxième");
    void result.current.send("s3", "troisième");

    await waitFor(() => expect(result.current.streaming).toBe(true));
    await waitFor(() => expect(abortSpy).toHaveBeenCalledTimes(0));

    act(() => result.current.stop());

    expect(abortSpy).toHaveBeenCalledTimes(3);
    expect(result.current.streaming).toBe(false);
  });

  it("l'état streaming ne retombe pas tant qu'un tour tourne encore", async () => {
    const { result } = renderHook(() => useChatStream(() => {}, () => {}, () => {}));

    void result.current.send("s1", "a");
    void result.current.send("s2", "b");

    await waitFor(() => expect(result.current.streaming).toBe(true));
    // Deux tours en vol : l'anneau d'activité doit rester affiché.
    expect(result.current.streaming).toBe(true);
  });
});
