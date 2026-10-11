/**
 * Passage de l'extraction de la page « Scanner un document » au formulaire de création (facture / BC fournisseur).
 * Le contenu transite par sessionStorage (onglet courant, jamais dans l'URL ni sur le serveur), lu une seule fois
 * et périmé après quelques minutes. Module pur (le stockage est injecté) : testé par Jest.
 */
import type { InvoiceExtraction } from '@/lib/invoice-extract'
import type { PurchaseTarget } from '@/lib/scan-document'

export const SCAN_HANDOFF_KEY = 'bellosuite:scan-handoff'
export const SCAN_HANDOFF_TTL_MS = 10 * 60 * 1000
/** Paramètre d'URL (sans contenu) signalant au formulaire qu'un document scanné l'attend. */
export const SCAN_QUERY_PARAM = 'fromScan'

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type Payload = { v: 1; target: PurchaseTarget; at: number; extraction: InvoiceExtraction }

export const TARGET_PATH: Record<PurchaseTarget, string> = {
  INVOICE: '/commercial/documents/supplier-invoices',
  ORDER: '/commercial/documents/supplier-orders',
}

/** Lien vers la liste cible, qui ouvre le formulaire pré-rempli. */
export function scanTargetHref(target: PurchaseTarget): string {
  return `${TARGET_PATH[target]}?${SCAN_QUERY_PARAM}=1`
}

export function saveScanHandoff(storage: StorageLike, target: PurchaseTarget, extraction: InvoiceExtraction, now = Date.now()): boolean {
  try {
    const payload: Payload = { v: 1, target, at: now, extraction }
    storage.setItem(SCAN_HANDOFF_KEY, JSON.stringify(payload))
    return true
  } catch {
    return false // stockage plein / désactivé
  }
}

function isExtraction(x: unknown): x is InvoiceExtraction {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return Array.isArray(o.lines) && Array.isArray(o.vat) && !!o.supplierName && !!o.total && !!o.checks && typeof o.subtotal === 'object'
}

/**
 * Récupère (et efface) l'extraction destinée à `target`. Rien, périmée, illisible ou destinée à l'autre formulaire → null
 * (une extraction destinée à l'autre cible est laissée en place).
 */
export function takeScanHandoff(storage: StorageLike, target: PurchaseTarget, now = Date.now()): InvoiceExtraction | null {
  let raw: string | null = null
  try { raw = storage.getItem(SCAN_HANDOFF_KEY) } catch { return null }
  if (!raw) return null
  let p: Partial<Payload>
  try { p = JSON.parse(raw) } catch { storage.removeItem(SCAN_HANDOFF_KEY); return null }
  if (!p || p.v !== 1 || typeof p.at !== 'number' || !isExtraction(p.extraction) || (p.target !== 'INVOICE' && p.target !== 'ORDER')) {
    storage.removeItem(SCAN_HANDOFF_KEY); return null
  }
  if (now - p.at > SCAN_HANDOFF_TTL_MS || p.at - now > 60_000) { storage.removeItem(SCAN_HANDOFF_KEY); return null }
  if (p.target !== target) return null
  storage.removeItem(SCAN_HANDOFF_KEY)
  return p.extraction
}
