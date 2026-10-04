// O teclado da tabela, sem tela: que tecla faz o que e para qual linha o foco vai. Fica aqui, com testes, e a tabela so
// aplica o resultado. As teclas de uma letra so valem com o foco na propria linha da tabela (nunca dentro de um campo
// de texto nem de um botao), para nao atrapalhar quem digita ou usa leitor de tela.

export type NavAction =
  | { kind: "move"; delta: 1 | -1 }
  | { kind: "edge"; edge: "first" | "last" }
  | { kind: "new" }
  | { kind: "open" };

export type KeyInfo = { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean };

/** A acao de uma tecla apertada com o foco numa linha; null se a tecla nao e da tabela. */
export function navAction(event: KeyInfo): NavAction | null {
  // Ctrl, Alt e Meta sao de outros atalhos (do navegador, do sistema)
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
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

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Com o foco numa linha da tabela",
    items: [
      { keys: ["↓", "J"], text: "Próxima linha" },
      { keys: ["↑", "K"], text: "Linha anterior" },
      { keys: ["Home", "End"], text: "Primeira e última linha" },
      { keys: ["Enter"], text: "Editar a linha" },
      { keys: ["T"], text: "Nova linha de lançamento" },
    ],
  },
  {
    title: "Na linha de entrada ou de edição",
    items: [
      { keys: ["Tab", "Shift+Tab"], text: "Próximo campo e campo anterior" },
      { keys: ["Enter"], text: "Gravar a linha" },
      { keys: ["Ctrl+Enter"], text: "Gravar e fechar a linha nova" },
      { keys: ["Esc"], text: "Cancelar sem gravar" },
    ],
  },
];
