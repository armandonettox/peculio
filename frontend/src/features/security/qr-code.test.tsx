import { render, screen } from "@testing-library/react";
import QRCode from "qrcode";
import { expect, it } from "vitest";

import { QrCode } from "./qr-code";

const URL_A = "otpauth://totp/finance-app:ana%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=finance-app";
const URL_B = "otpauth://totp/finance-app:bia%40example.com?secret=KRSXG5CTMVRXEZLU&issuer=finance-app";

const pathOf = () => screen.getByRole("img").querySelector("path")!.getAttribute("d");

it("desenha um modulo escuro para cada modulo do QR code do texto", () => {
  render(<QrCode value={URL_A} label="QR de teste" />);
  const { modules } = QRCode.create(URL_A, { errorCorrectionLevel: "M" });
  const dark = Array.from(modules.data).filter(Boolean).length;
  expect(pathOf()!.match(/M/g)).toHaveLength(dark);
});

it("tem nome acessivel e area de respiro de 4 modulos em volta", () => {
  render(<QrCode value={URL_A} label="QR de teste" />);
  const svg = screen.getByRole("img", { name: "QR de teste" });
  const size = QRCode.create(URL_A, { errorCorrectionLevel: "M" }).modules.size;
  expect(svg.getAttribute("viewBox")).toBe(`0 0 ${size + 8} ${size + 8}`);
});

it("textos diferentes geram desenhos diferentes e o mesmo texto gera o mesmo", () => {
  const { unmount } = render(<QrCode value={URL_A} label="QR" />);
  const first = pathOf();
  unmount();
  render(<QrCode value={URL_B} label="QR" />);
  expect(pathOf()).not.toBe(first);
  expect(pathOf()).not.toBe("");
});

it("e sempre preto sobre branco, nos dois temas", () => {
  render(<QrCode value={URL_A} label="QR" />);
  const svg = screen.getByRole("img");
  expect(svg.querySelector("rect")!.getAttribute("fill")).toBe("#ffffff");
  expect(svg.querySelector("path")!.getAttribute("fill")).toBe("#000000");
});
