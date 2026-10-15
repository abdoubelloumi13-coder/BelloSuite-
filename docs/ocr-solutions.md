# OCR Factures — Problèmes et Solutions

## État actuel

### 1. OCR Local (Tesseract.js + pdfjs-dist) ✅
- **Fonctionne** : 100% dans le navigateur, gratuit, sans clé API
- **Limites** : qualité variable sur scans bruités, photos mal éclairées
- **Modèles** : `fra+ara+eng` (français, arabe, anglais)

### 2. Affinage IA (optionnel) ⚠️
**Configuration actuelle** :
- **Gemini** : `GEMINI_API_KEY` configurée sur Vercel
  - Modèle par défaut : `gemini-3.5-flash-lite` (GRATUIT)
  - Fallback : `gemini-2.0-flash` (GRATUIT)
- **Groq** : `GROQ_API_KEY` NON configurée
  - Ancien modèle gratuit `qwen/qwen3.8-27b` → **DÉPRÉCIÉ**
  - Nouveaux modèles vision (Llama 4 Scout, Qwen 3.6) → **PAYANTS**

## Problèmes identifiés

1. **Groq a déprécié son modèle vision gratuit** (`qwen/qwen3.8-27b`)
2. **Les modèles vision Groq sont maintenant payants** ($0.11/1M tokens input)
3. **Gemini fonctionne toujours** mais peut avoir des limites de quota

## Solutions gratuites sans carte de crédit

### Option 1 : ParseFlow API (Recommandé) ⭐
- **Endpoint** : `POST https://parseflow.dev/api/v1/extract`
- **Gratuit** : 100 documents/mois, sans carte de crédit
- **Spécialisé factures** : extraction structurée (lignes, totaux, TVA, MF)
- **Format** : multipart/form-data (fichier PDF/image)
- **Exemple curl** :
```bash
curl -X POST https://parseflow.dev/api/v1/extract \
  -H "X-API-Key: dm_live_your_key" \
  -F "file=@invoice.pdf" \
  -F "document_type=invoice"
```

**Intégration** :
- Remplacer l'appel Gemini/Groq par ParseFlow
- Retourne JSON structuré directement (pas besoin de parsing)
- Fallback sur OCR local si quota dépassé

### Option 2 : StructOCR
- **Gratuit** : 200 crédits (~66 factures) sans carte
- **Endpoint** : `POST https://api.structocr.com/v1/invoice`
- **Spécialisé factures** avec lignes détaillées

### Option 3 : Invofox
- **Gratuit** : 500 pages/mois sans carte
- **Endpoint** : `POST https://www.invofox.com/en/ocr-api/`
- **Polyvalent** : factures, IDs, documents divers

### Option 4 : Azure Document Intelligence (F0)
- **Gratuit** : 500 pages/mois (F0 tier)
- **Requiert** : création compte Azure (gratuit, pas de carte pour F0)
- **Endpoint** : `POST https://{region}.api.cognitive.microsoft.com/formrecognizer/v2.1/prebuilt/invoice/analyze`

### Option 5 : Améliorer OCR local
- **Ajouter prétraitement image** : seuillage, débruitage, redressement
- **Utiliser Tesseract 5** (meilleure précision)
- **Ajouter post-processing** : regex pour montants, dates, MF

## Recommandation

**Court terme** : Tester ParseFlow (100 docs/mois gratuits)
- Simple à intégrer (1 endpoint HTTP)
- Spécialisé factures tunisiennes
- Pas de carte de crédit

**Moyen terme** : Multi-provider avec fallback
1. ParseFlow (100 docs/mois)
2. StructOCR (66 docs/mois)
3. OCR local (illimité, qualité variable)

**Long terme** : Entraîner un modèle spécialisé factures tunisiennes
- Dataset : factures réelles anonymisées
- Modèle : Donut / Nougat (open source)
- Hébergement : Hugging Face Spaces (gratuit)

## Code d'intégration ParseFlow

```typescript
// src/lib/parseflow.ts
const PARSEFLOW_API_KEY = process.env.PARSEFLOW_API_KEY
const PARSEFLOW_URL = 'https://parseflow.dev/api/v1/extract'

export async function extractInvoiceParseFlow(file: File): Promise<any> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('document_type', 'invoice')
  
  const res = await fetch(PARSEFLOW_URL, {
    method: 'POST',
    headers: { 'X-API-Key': PARSEFLOW_API_KEY! },
    body: formData,
  })
  
  if (!res.ok) throw new Error(`ParseFlow error: ${res.status}`)
  return res.json()
}
```

## Prochaines étapes

1. **Créer compte ParseFlow** → obtenir API key
2. **Ajouter `PARSEFLOW_API_KEY`** dans Vercel
3. **Tester avec 5-10 factures** réelles
4. **Ajouter fallback** : ParseFlow → StructOCR → OCR local
5. **Monitorer quota** : alerte à 80% du quota mensuel

## Notes

- **Ne jamais stocker** les factures (RGPD, confidentialité)
- **Toujours garder** l'OCR local comme fallback ultime
- **Journaliser uniquement** : statut HTTP, temps de réponse (jamais le contenu)
