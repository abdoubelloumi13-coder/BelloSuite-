#!/usr/bin/env node
// Vérifie que messages/{fr,en,ar}.json sont des JSON valides et ont exactement le même jeu de clés.
// Usage : node scripts/check-i18n-keys.mjs   (code de sortie 1 en cas d'écart)
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const locales = ['fr', 'en', 'ar']

function flatten(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out)
    else out.set(key, v)
  }
  return out
}

let ok = true
const maps = {}
for (const l of locales) {
  try {
    maps[l] = flatten(JSON.parse(readFileSync(path.join(root, 'messages', `${l}.json`), 'utf8')))
  } catch (e) {
    console.error(`✗ messages/${l}.json : JSON invalide — ${e.message}`)
    process.exit(1)
  }
}

const all = new Set(locales.flatMap(l => [...maps[l].keys()]))
for (const l of locales) {
  const missing = [...all].filter(k => !maps[l].has(k))
  const empty = [...maps[l]].filter(([, v]) => typeof v === 'string' && v.trim() === '').map(([k]) => k)
  if (missing.length) {
    ok = false
    console.error(`✗ ${l}.json : ${missing.length} clé(s) manquante(s)`)
    for (const k of missing) console.error(`    - ${k}`)
  }
  if (empty.length) {
    ok = false
    console.error(`✗ ${l}.json : ${empty.length} valeur(s) vide(s)`)
    for (const k of empty) console.error(`    - ${k}`)
  }
}

// Les variables ICU ({name}) doivent être les mêmes dans les trois langues
const vars = s => new Set([...String(s).matchAll(/\{\s*(\w+)\s*[,}]/g)].map(m => m[1]))
for (const k of maps.fr.keys()) {
  const ref = [...vars(maps.fr.get(k))].sort().join(',')
  for (const l of ['en', 'ar']) {
    if (!maps[l].has(k)) continue
    const got = [...vars(maps[l].get(k))].sort().join(',')
    if (got !== ref) {
      ok = false
      console.error(`✗ ${l}.json : variables différentes pour « ${k} » (fr: {${ref}} / ${l}: {${got}})`)
    }
  }
}


// Clés utilisées dans le code (t('...') avec un namespace littéral) absentes des messages
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx?|jsx?)$/.test(f)) out.push(p)
  }
  return out
}
const hookRe = /const\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:['"]([\w.]*)['"])?\s*\)/g
for (const file of walk(path.join(root, 'src'))) {
  const src = readFileSync(file, 'utf8')
  const hooks = [...src.matchAll(hookRe)]
  if (!hooks.length) continue
  const nsByVar = new Map()
  for (const h of hooks) {
    const prev = nsByVar.get(h[1])
    if (prev !== undefined && prev !== (h[2] || '')) nsByVar.set(h[1], null) // ambigu : ignoré
    else nsByVar.set(h[1], h[2] || '')
  }
  for (const [v, ns] of nsByVar) {
    if (ns === null) continue
    const callRe = new RegExp(`(?<![\\w.])${v}(?:\\.(?:rich|raw|markup))?\\(\\s*['"]([\\w.]+)['"]`, 'g')
    for (const m of src.matchAll(callRe)) {
      const key = ns ? `${ns}.${m[1]}` : m[1]
      const isObj = [...maps.fr.keys()].some(k => k.startsWith(key + '.'))
      for (const l of locales) {
        if (!maps[l].has(key) && !isObj) {
          ok = false
          console.error(`✗ ${path.relative(root, file)} : clé « ${key} » absente de ${l}.json`)
        }
      }
    }
  }
}

if (ok) console.log(`✓ i18n : ${all.size} clés identiques dans ${locales.join(', ')}`)
process.exit(ok ? 0 : 1)
