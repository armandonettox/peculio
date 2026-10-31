// Trava o zoom por gesto de pinca. O iOS Safari ignora user-scalable=no do meta viewport,
// entao o gesto precisa ser cancelado aqui. Fica num arquivo (e nao inline no index.html)
// porque a politica de seguranca do servidor so aceita scripts do proprio endereco.
["gesturestart", "gesturechange", "gestureend"].forEach(function (name) {
  document.addEventListener(name, function (event) {
    event.preventDefault();
  });
});
