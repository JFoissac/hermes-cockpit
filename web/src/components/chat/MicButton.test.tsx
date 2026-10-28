import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import MicButton from "./MicButton";

/* ── Fake Web Speech engine ──────────────────────────────────────────────
 * Stands in for `window.SpeechRecognition`: records the calls the component
 * makes and lets a test push results and errors into it.
 */
interface FakeResult {
  readonly isFinal: boolean;
  readonly [index: number]: { transcript: string };
}

function result(transcript: string, isFinal: boolean) {
  return Object.assign([{ transcript }], { isFinal }) as unknown as FakeResult;
}

function resultEvent(entries: FakeResult[], resultIndex = 0) {
  return { resultIndex, results: entries };
}

class FakeRecognition {
  static instances: FakeRecognition[] = [];

  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;

  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();

  constructor() {
    FakeRecognition.instances.push(this);
  }

  static get last(): FakeRecognition {
    const instance = FakeRecognition.instances.at(-1);
    if (!instance) throw new Error("aucune reconnaissance instanciée");
    return instance;
  }
}

function stubRecognition() {
  vi.stubGlobal("SpeechRecognition", FakeRecognition);
}

describe("MicButton", () => {
  beforeEach(() => {
    FakeRecognition.instances = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("démarre la reconnaissance en français avec les partiels", () => {
    stubRecognition();
    render(<MicButton onTranscript={vi.fn()} />);

    const button = screen.getByRole("button", { name: "Dicter" });
    expect(button).toHaveAttribute("data-state", "idle");
    expect(button.getAttribute("data-state")).toBe("idle");
    expect(button.querySelector("svg")).toBeTruthy();

    fireEvent.click(button);

    const recognition = FakeRecognition.last;
    expect(recognition.start).toHaveBeenCalledTimes(1);
    expect(recognition.lang).toBe("fr-FR");
    expect(recognition.continuous).toBe(true);
    expect(recognition.interimResults).toBe(true);
    expect(screen.getByRole("button")).toHaveAttribute("data-state", "listening");
    expect(screen.getByRole("button").querySelector("svg rect")?.getAttribute("fill")).toBe("currentColor");
  });

  it("respecte la langue passée en prop", () => {
    stubRecognition();
    render(<MicButton onTranscript={vi.fn()} language="en-GB" />);

    fireEvent.click(screen.getByRole("button"));
    expect(FakeRecognition.last.lang).toBe("en-GB");
  });

  it("émet les partiels puis le texte final accumulé", () => {
    stubRecognition();
    const onTranscript = vi.fn();
    render(<MicButton onTranscript={onTranscript} />);
    fireEvent.click(screen.getByRole("button"));

    const recognition = FakeRecognition.last;

    act(() => {
      recognition.onresult?.(resultEvent([result("bonjour", false)]));
    });
    expect(onTranscript).toHaveBeenLastCalledWith("bonjour", false);

    act(() => {
      recognition.onresult?.(resultEvent([result("bonjour", true)]));
    });
    expect(onTranscript).toHaveBeenLastCalledWith("bonjour", true);

    // Second chunk: the final text accumulates instead of replacing.
    act(() => {
      recognition.onresult?.(resultEvent([result("le cockpit", false)]));
    });
    expect(onTranscript).toHaveBeenLastCalledWith("bonjour le cockpit", false);

    act(() => {
      recognition.onresult?.(resultEvent([result("le cockpit", true)]));
    });
    expect(onTranscript).toHaveBeenLastCalledWith("bonjour le cockpit", true);
  });

  it("expose l'état d'erreur avec un message lisible", () => {
    stubRecognition();
    const onTranscript = vi.fn();
    render(<MicButton onTranscript={onTranscript} />);
    fireEvent.click(screen.getByRole("button"));

    const recognition = FakeRecognition.last;
    act(() => {
      recognition.onerror?.({ error: "not-allowed", message: "denied" });
      recognition.onend?.();
    });

    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("data-state", "error");
    expect(button).toHaveAttribute("title", "Micro refusé par le navigateur");
    expect(button).toHaveAttribute("data-tone", "red");
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("revient à idle après l'arrêt demandé", () => {
    stubRecognition();
    render(<MicButton onTranscript={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Dicter" }));

    fireEvent.click(screen.getByRole("button", { name: "Arrêter la dictée" }));
    expect(FakeRecognition.last.stop).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button")).toHaveAttribute("data-state", "listening");

    act(() => {
      FakeRecognition.last.onend?.();
    });
    expect(screen.getByRole("button")).toHaveAttribute("data-state", "idle");
    expect(FakeRecognition.last.abort).not.toHaveBeenCalled();
  });

  it("abandonne la reconnaissance au démontage", () => {
    stubRecognition();
    const { unmount } = render(<MicButton onTranscript={vi.fn()} />);
    fireEvent.click(screen.getByRole("button"));

    const recognition = FakeRecognition.last;
    unmount();

    expect(recognition.abort).toHaveBeenCalledTimes(1);
    expect(recognition.onresult).toBeNull();
    expect(recognition.onend).toBeNull();
  });

  it("reste inerte quand l'API manque, sans simuler de transcription", () => {
    const onTranscript = vi.fn();
    render(<MicButton onTranscript={onTranscript} />);

    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Dictée non supportée par ce navigateur");
    expect(button).toHaveAttribute("data-state", "idle");

    fireEvent.click(button);

    expect(FakeRecognition.instances).toHaveLength(0);
    expect(onTranscript).not.toHaveBeenCalled();
    expect(button).toHaveAttribute("data-state", "idle");
  });
});
