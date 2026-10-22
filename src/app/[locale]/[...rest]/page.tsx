import { notFound } from 'next/navigation'

// Toute URL inconnue sous /[locale]/… affiche la page 404 localisée ([locale]/not-found.tsx)
// au lieu de la page 404 par défaut de Next (blanche, sans navigation).
export default function CatchAllPage() {
  notFound()
}
