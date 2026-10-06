import { ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Atalho para a pagina de Seguranca, que tem a verificacao em duas etapas e os tokens de API. */
export function SecuritySection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Segurança</CardTitle>
        <CardDescription>Verificação em duas etapas e tokens de API para scripts.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline">
          <Link to="/seguranca">
            <ShieldCheck />
            Abrir a página de Segurança
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
