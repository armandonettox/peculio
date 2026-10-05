// Aplica o tema antes do React carregar, para a tela nao piscar clara e depois escura.
// Fica num arquivo (e nao inline no index.html) porque a politica de seguranca do servidor
// so aceita scripts do proprio endereco.
try {
  var stored = localStorage.getItem("peculio-theme");
  var dark =
    stored === "dark" ||
    ((stored === null || stored === "system") &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  if (dark) document.documentElement.classList.add("dark");
} catch (e) {}
