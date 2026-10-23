import { redirect } from 'next/navigation'

// Ancien lien « Évaluations » : la gestion des qualifications (grilles, coefficients, salaires) est sur /hr/qualifications
export default async function EvaluationsRedirect({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  redirect(`/${locale}/hr/qualifications`)
}
