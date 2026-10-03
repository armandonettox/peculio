// Navegacao por teclado dos graficos. Cada grafico tem UMA parada de Tab; as setas, Home e End percorrem
// os pontos (padrao "roving tabindex"). Aqui so a logica, sem DOM, para testar em tabela.

export type GridPoint = { seriesIndex: number; xIndex: number };

/**
 * Para onde ir a partir de `current` com a tecla `key` numa lista de itens (as fatias da rosca).
 * Devolve o novo indice, ou null quando a tecla nao navega ou ja esta na ponta.
 */
export function nextListIndex(count: number, current: number, key: string): number | null {
  let target: number;
  if (key === "ArrowRight" || key === "ArrowDown") target = current + 1;
  else if (key === "ArrowLeft" || key === "ArrowUp") target = current - 1;
  else if (key === "Home") target = 0;
  else if (key === "End") target = count - 1;
  else return null;
  if (target < 0 || target >= count || target === current) return null;
  return target;
}

/**
 * Para onde ir numa grade de series x periodos. `presence[s][x]` diz se a serie `s` tem ponto no periodo `x`
 * (series podem ter buracos). Esquerda e direita andam pela mesma serie, pulando os buracos; cima e baixo
 * mudam de serie no MESMO periodo, pulando as series que nao tem ponto ali; Home e End vao ao primeiro e ao
 * ultimo ponto da serie. Devolve null quando a tecla nao navega ou nao ha para onde ir.
 */
export function nextGridPoint(presence: boolean[][], current: GridPoint, key: string): GridPoint | null {
  const { seriesIndex, xIndex } = current;
  const row = presence[seriesIndex] ?? [];

  const along = (from: number, step: number): GridPoint | null => {
    for (let x = from; x >= 0 && x < row.length; x += step) {
      if (row[x]) return { seriesIndex, xIndex: x };
    }
    return null;
  };
  const across = (step: number): GridPoint | null => {
    for (let s = seriesIndex + step; s >= 0 && s < presence.length; s += step) {
      if (presence[s]?.[xIndex]) return { seriesIndex: s, xIndex };
    }
    return null;
  };

  let target: GridPoint | null;
  switch (key) {
    case "ArrowRight":
      target = along(xIndex + 1, 1);
      break;
    case "ArrowLeft":
      target = along(xIndex - 1, -1);
      break;
    case "ArrowDown":
      target = across(1);
      break;
    case "ArrowUp":
      target = across(-1);
      break;
    case "Home":
      target = along(0, 1);
      break;
    case "End":
      target = along(row.length - 1, -1);
      break;
    default:
      return null;
  }
  if (target && target.seriesIndex === seriesIndex && target.xIndex === xIndex) return null;
  return target;
}

/** O primeiro ponto existente (a parada de Tab inicial). */
export function firstGridPoint(presence: boolean[][]): GridPoint | null {
  for (let seriesIndex = 0; seriesIndex < presence.length; seriesIndex += 1) {
    const xIndex = presence[seriesIndex].indexOf(true);
    if (xIndex >= 0) return { seriesIndex, xIndex };
  }
  return null;
}
