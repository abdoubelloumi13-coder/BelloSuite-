/**
 * Garde-fou i18n : chaque clé littérale utilisée via useTranslations/getTranslations('Namespace') existe
 * dans messages/fr.json, et fr / en / ar ont exactement les mêmes clés.
 */
import fs from 'fs'
import path from 'path'

type Dict = { [k: string]: string | Dict }
const load = (l: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), 'messages', `${l}.json`), 'utf8')) as Dict
const flat = (d: Dict, p = ''): string[] =>
  Object.entries(d).flatMap(([k, v]) => (typeof v === 'object' && v !== null ? flat(v, `${p}${k}.`) : [`${p}${k}`]))
const has = (d: Dict, key: string) => {
  let cur: string | Dict | undefined = d
  for (const part of key.split('.')) {
    if (!cur || typeof cur !== 'object' || !(part in cur)) return false
    cur = cur[part]
  }
  return true
}
const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? walk(p) : /\.tsx?$/.test(e.name) ? [p] : []
  })

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

describe('i18n', () => {
  const fr = load('fr')

  it('les clés littérales utilisées dans src existent dans fr.json', () => {
    const decl = /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:['"]([\w.]+)['"])?\s*\)/g
    const missing: string[] = []
    for (const file of walk(path.join(process.cwd(), 'src'))) {
      const src = fs.readFileSync(file, 'utf8')
      for (const m of src.matchAll(decl)) {
        const [, v, ns = ''] = m
        const call = new RegExp(`(?<![\\w.])${esc(v)}(?:\\.(?:rich|raw|markup))?\\(\\s*['"]([\\w.-]+)['"]`, 'g')
        for (const c of src.matchAll(call)) {
          const key = (ns ? `${ns}.` : '') + c[1]
          if (!has(fr, key)) missing.push(`${key} (${path.relative(process.cwd(), file)})`)
        }
      }
    }
    expect([...new Set(missing)]).toEqual([])
  })

  it('fr, en et ar ont les mêmes clés', () => {
    const frKeys = new Set(flat(fr))
    for (const l of ['en', 'ar']) {
      const keys = new Set(flat(load(l)))
      expect({ lang: l, missing: [...frKeys].filter(k => !keys.has(k)) }).toEqual({ lang: l, missing: [] })
    }
  })
})
