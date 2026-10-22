/**
 * Règles de conversion des documents de vente (chaîne commerciale tunisienne) :
 *   Devis (QUOTE)            → Bon de commande (ORDER) ou Facture (INVOICE)
 *   Bon de commande (ORDER)  → Bon de livraison (DELIVERY_NOTE) ou Facture
 *   Bon de livraison         → Facture
 *   Facture                  → Avoir (CREDIT_NOTE), lié par originalInvoiceId
 * Une chaîne (devis → BC → BL → facture) ne peut donner qu'UNE facture active, et un document
 * ne peut être converti qu'une fois vers un même type (pas de double conversion).
 */

export const ALLOWED_CONVERSIONS: Record<string, string[]> = {
  QUOTE: ['ORDER', 'INVOICE'],
  ORDER: ['DELIVERY_NOTE', 'INVOICE'],
  DELIVERY_NOTE: ['INVOICE'],
  INVOICE: ['CREDIT_NOTE'],
  INVOICE_SERVICE: ['CREDIT_NOTE'],
  INVOICE_HONORARY: ['CREDIT_NOTE'],
}

/** Cible par défaut quand le client n'en précise pas (compatibilité : devis → BC, BC → facture). */
const DEFAULT_TARGET: Record<string, string> = {
  QUOTE: 'ORDER',
  ORDER: 'INVOICE',
  DELIVERY_NOTE: 'INVOICE',
  INVOICE: 'CREDIT_NOTE',
  INVOICE_SERVICE: 'CREDIT_NOTE',
  INVOICE_HONORARY: 'CREDIT_NOTE',
}

export type ConversionCheck = { ok: true; target: string } | { ok: false; message: string }

export function resolveConversionTarget(sourceType: string, requested?: string | null): ConversionCheck {
  const allowed = ALLOWED_CONVERSIONS[sourceType]
  if (!allowed) return { ok: false, message: `Ce type de document (${sourceType}) ne peut pas être converti` }
  const target = requested && requested.trim() ? requested.trim().toUpperCase() : DEFAULT_TARGET[sourceType]
  if (!allowed.includes(target)) {
    return { ok: false, message: `Conversion ${sourceType} → ${target} non autorisée (possible : ${allowed.join(', ')})` }
  }
  return { ok: true, target }
}

export type ChainDoc = {
  id: string
  type: string
  status: string
  number: string
  convertedFromId: string | null
  originalInvoiceId?: string | null
}

const INVOICE_TYPES = ['INVOICE', 'INVOICE_SERVICE', 'INVOICE_HONORARY']
const isActive = (d: ChainDoc) => d.status !== 'CANCELLED' && d.status !== 'REJECTED'

/**
 * Document déjà issu de la même conversion (→ refus 409), ou null.
 * `docs` : tous les documents de la chaîne du source (ancêtres et descendants), source inclus.
 */
export function findConversionConflict(source: ChainDoc, target: string, docs: ChainDoc[]): ChainDoc | null {
  if (target === 'CREDIT_NOTE') {
    return docs.find(d => d.type === 'CREDIT_NOTE' && isActive(d) && (d.originalInvoiceId === source.id || d.convertedFromId === source.id)) ?? null
  }
  if (INVOICE_TYPES.includes(target)) {
    // une seule facture active pour toute la chaîne devis → BC → BL
    return docs.find(d => d.id !== source.id && INVOICE_TYPES.includes(d.type) && isActive(d)) ?? null
  }
  return docs.find(d => d.convertedFromId === source.id && d.type === target && isActive(d)) ?? null
}

/** Ids de la chaîne : remonte aux ancêtres puis descend tous les descendants (graphe en mémoire). */
export function collectChain(sourceId: string, all: ChainDoc[]): ChainDoc[] {
  const byId = new Map(all.map(d => [d.id, d]))
  let root = byId.get(sourceId)
  const seen = new Set<string>()
  while (root?.convertedFromId && byId.has(root.convertedFromId) && !seen.has(root.id)) {
    seen.add(root.id)
    root = byId.get(root.convertedFromId)
  }
  if (!root) return []
  const out: ChainDoc[] = []
  const queue = [root.id]
  const visited = new Set<string>()
  while (queue.length) {
    const id = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)
    const d = byId.get(id)
    if (d) out.push(d)
    for (const c of all) if ((c.convertedFromId === id || c.originalInvoiceId === id) && !visited.has(c.id)) queue.push(c.id)
  }
  return out
}
