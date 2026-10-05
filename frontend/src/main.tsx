import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./auth/auth-context";
import "./index.css";
import { queryClient } from "./lib/query-client";
import { initInstallPrompt } from "./pwa/install";
import { registerServiceWorker } from "./pwa/update";

// App instalavel: o convite de instalar pode chegar antes de o React montar, e o service worker so existe no app publicado
initInstallPrompt();
void registerServiceWorker({
  enabled: import.meta.env.PROD,
  container: "serviceWorker" in navigator ? navigator.serviceWorker : undefined,
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
