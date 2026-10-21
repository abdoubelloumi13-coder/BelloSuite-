import { redirect } from 'next/navigation'

// Ancien lien « Brouillard » : la saisie et la consultation des écritures sont sur /accounting/entries
export default async function BrouillardRedirect({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  redirect(`/${locale}/accounting/entries`)
}
