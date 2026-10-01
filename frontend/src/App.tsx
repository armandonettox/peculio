import { useEffect, useState } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Tela temporaria para conferir a paleta e o tema. As telas reais entram na etapa 4.
export default function App() {
  const [apiStatus, setApiStatus] = useState("verificando...");

  // Confere se a API responde, so para validar a conexao frontend e backend
  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((data) => setApiStatus(data.status))
      .catch(() => setApiStatus("fora do ar"));
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-primary-text">finance-app</h1>
        <ThemeToggle />
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Pre-visualizacao do tema</CardTitle>
          <CardDescription>API: {apiStatus}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="exemplo">Campo de exemplo</Label>
            <Input id="exemplo" placeholder="Digite algo" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button>Principal</Button>
            <Button variant="outline">Contorno</Button>
            <Button variant="ghost">Discreto</Button>
            <Button variant="destructive">Excluir</Button>
            <Button variant="link">Link</Button>
          </div>
          <div className="flex gap-2 text-sm">
            <span className="rounded-md bg-brand-accent px-2 py-1 text-brand-accent-foreground">
              Destaque
            </span>
            <span className="rounded-md bg-support px-2 py-1 text-white">Suporte</span>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
