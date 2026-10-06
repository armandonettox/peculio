import { i18n } from "@/i18n";
// O teclado da tabela, sem tela: que tecla faz o que e para qual linha o foco vai. Fica aqui, com testes, e a tabela so
// aplica o resultado. As teclas de uma letra so valem com o foco na propria linha da tabela (nunca dentro de um campo
// de texto nem de um botao), para nao atrapalhar quem digita ou usa leitor de tela.

export type NavAction =
  | { kind: "move"; delta: 1 | -1 }
  | { kind: "edge"; edge: "first" | "last" }
  | { kind: "new" }
  | { kind: "open" }
  // Selecao: marcar a linha, marcar do ultimo marcado ate ela, marcar todas as carregadas, limpar
  | { kind: "select" }
  | { kind: "range" }
  | { kind: "all" }
  | { kind: "clear" };

export type KeyInfo = { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean };

/** A acao de uma tecla apertada com o foco numa linha; null se a tecla nao e da tabela. */
export function navAction(event: KeyInfo): NavAction | null {
  if (event.altKey) return null;
  // Ctrl e Meta sao de outros atalhos (do navegador, do sistema); so Ctrl+A e da tabela
  if (event.ctrlKey || event.metaKey) return event.key === "a" && !event.shiftKey ? { kind: "all" } : null;
  switch (event.key) {
    case "ArrowDown":
      return { kind: "move", delta: 1 };
    case "ArrowUp":
      return { kind: "move", delta: -1 };
    case "Home":
      return { kind: "edge", edge: "first" };
    case "End":
      return { kind: "edge", edge: "last" };
    case "Enter":
      return { kind: "open" };
    case " ":
      return event.shiftKey ? { kind: "range" } : { kind: "select" };
    case "Escape":
      return { kind: "clear" };
  }
  // Letra com Shift e outra coisa (maiuscula), e fica de fora
  if (event.shiftKey) return null;
  if (event.key === "j") return { kind: "move", delta: 1 };
  if (event.key === "k") return { kind: "move", delta: -1 };
  if (event.key === "t") return { kind: "new" };
  return null;
}

/** Para qual linha o foco vai. null se nao ha linhas. Nas pontas fica onde esta, sem dar a volta. */
export function nextIndex(current: number, count: number, action: NavAction): number | null {
  if (count <= 0) return null;
  const last = count - 1;
  const clamp = (value: number) => Math.min(Math.max(value, 0), last);
  if (action.kind === "move") return clamp(current + action.delta);
  if (action.kind === "edge") return action.edge === "first" ? 0 : last;
  return clamp(current);
}

/** A linha que tem a parada do Tab: a ultima em que o foco esteve, sempre dentro da lista. */
export function tabStop(active: number, count: number): number {
  return count <= 0 ? -1 : Math.min(Math.max(active, 0), count - 1);
}

// ---------- A lista que o botao "Atalhos" mostra ----------

export type ShortcutGroup = { title: string; items: { keys: string[]; text: string }[] };

/** Os grupos de atalhos, no idioma em uso (chamar na hora de mostrar, nao guardar). */
export function shortcutGroups(): ShortcutGroup[] {
  const space = i18n.t("transactions.shortcuts.keySpace");
  return [
    {
      title: i18n.t("transactions.shortcuts.focusedRow"),
      items: [
        { keys: ["↓", "J"], text: i18n.t("transactions.shortcuts.nextRow") },
        { keys: ["↑", "K"], text: i18n.t("transactions.shortcuts.previousRow") },
        { keys: ["Home", "End"], text: i18n.t("transactions.shortcuts.firstLastRow") },
        { keys: ["Enter"], text: i18n.t("transactions.shortcuts.editRow") },
        { keys: ["T"], text: i18n.t("transactions.shortcuts.newRow") },
      ],
    },
    {
      title: i18n.t("transactions.shortcuts.selecting"),
      items: [
        { keys: [space], text: i18n.t("transactions.shortcuts.toggleRow") },
        { keys: [`Shift+${space}`], text: i18n.t("transactions.shortcuts.markRange") },
        { keys: ["Ctrl+A"], text: i18n.t("transactions.shortcuts.markAll") },
        { keys: ["Esc"], text: i18n.t("transactions.shortcuts.clearSelection") },
      ],
    },
    {
      title: i18n.t("transactions.shortcuts.inRow"),
      items: [
        { keys: ["Tab", "Shift+Tab"], text: i18n.t("transactions.shortcuts.nextField") },
        { keys: ["Enter"], text: i18n.t("transactions.shortcuts.saveRow") },
        { keys: ["Ctrl+Enter"], text: i18n.t("transactions.shortcuts.saveClose") },
        { keys: ["Esc"], text: i18n.t("transactions.shortcuts.cancel") },
      ],
    },
  ];
}
