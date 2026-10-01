import { useLocation } from "react-router-dom";

// Mostra a rota atual na tela, para o teste conferir para onde o app navegou
export function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}
