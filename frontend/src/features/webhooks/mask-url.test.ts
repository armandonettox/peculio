import { describe, expect, it } from "vitest";

import { maskWebhookUrl } from "./mask-url";

describe("maskWebhookUrl", () => {
  it.each([
    // sem query
    ["https://hooks.exemplo.com/finance", "https://hooks.exemplo.com/finance"],
    ["https://hooks.exemplo.com/", "https://hooks.exemplo.com/"],
    ["https://hooks.exemplo.com", "https://hooks.exemplo.com/"],
    ["http://192.168.0.10/hook", "http://192.168.0.10/hook"],
    // com query: o token some
    ["https://hooks.exemplo.com/finance?token=abc123", "https://hooks.exemplo.com/finance?***"],
    ["https://hooks.exemplo.com/finance?a=1&token=abc123", "https://hooks.exemplo.com/finance?***"],
    ["https://hooks.exemplo.com/?token=abc123", "https://hooks.exemplo.com/?***"],
    ["https://hooks.exemplo.com/finance?", "https://hooks.exemplo.com/finance"],
    // fragmento tambem pode levar segredo
    ["https://hooks.exemplo.com/finance#token=abc", "https://hooks.exemplo.com/finance#***"],
    ["https://hooks.exemplo.com/finance?t=1#abc", "https://hooks.exemplo.com/finance?***#***"],
    // credenciais
    ["https://maria:segredo@hooks.exemplo.com/finance", "https://***@hooks.exemplo.com/finance"],
    ["https://maria@hooks.exemplo.com/finance", "https://***@hooks.exemplo.com/finance"],
    ["https://:segredo@hooks.exemplo.com/finance", "https://***@hooks.exemplo.com/finance"],
    ["https://maria:segredo@hooks.exemplo.com/finance?token=abc", "https://***@hooks.exemplo.com/finance?***"],
    // porta
    ["https://hooks.exemplo.com:8443/finance?token=abc", "https://hooks.exemplo.com:8443/finance?***"],
    ["http://localhost:8123/api/webhook/abc", "http://localhost:8123/api/webhook/abc"],
    ["http://[::1]:8123/hook?t=1", "http://[::1]:8123/hook?***"],
    // espacos em volta
    ["  https://hooks.exemplo.com/finance?token=abc  ", "https://hooks.exemplo.com/finance?***"],
  ])("%s -> %s", (input, expected) => {
    expect(maskWebhookUrl(input)).toBe(expected);
  });

  it.each([
    ["texto solto", "isto nao e um endereco?token=abc"],
    ["vazio", ""],
    ["so espacos", "   "],
    ["sem esquema", "hooks.exemplo.com/finance?token=abc"],
    ["esquema que nao e http", "ftp://hooks.exemplo.com/finance?token=abc"],
    ["javascript", "javascript:alert(1)"],
    ["porta invalida", "https://hooks.exemplo.com:99999/finance?token=abc"],
    ["so o esquema", "https://"],
  ])("endereço inválido (%s) não mostra nada do texto", (_label, input) => {
    const result = maskWebhookUrl(input);
    expect(result).toBe("Endereço inválido");
    expect(result).not.toContain("abc");
  });

  it("nunca deixa o token nem a senha aparecerem", () => {
    const out = maskWebhookUrl("https://maria:s3nh4@hooks.exemplo.com:8443/finance?token=t0k3n&x=1#frag");
    expect(out).not.toMatch(/t0k3n|s3nh4|maria|frag|x=1/);
    expect(out).toBe("https://***@hooks.exemplo.com:8443/finance?***#***");
  });
});
