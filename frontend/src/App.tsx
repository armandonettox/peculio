import { useEffect, useState } from "react";

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
    <main>
      <h1>finance-app</h1>
      <p>API: {apiStatus}</p>
    </main>
  );
}
