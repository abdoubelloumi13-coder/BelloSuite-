/**
 * @jest-environment node
 */
/* Garde-fou (audit C1) : toute Server Action ('use server') est un endpoint POST public.
   Chaque fichier qui en déclare doit vérifier la session côté serveur. */
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(f)) out.push(p)
  }
  return out
}

test('aucune Server Action sans contrôle de session', () => {
  const offenders = walk(join(__dirname, '..', 'src')).filter(p => {
    const src = readFileSync(p, 'utf8')
    if (!/^\s*['"]use server['"]/m.test(src)) return false
    return !/(getLiveSession|requireSession|requireSuperAdmin|requireTenant|getApiContext)\s*\(/.test(src)
  })
  expect(offenders).toEqual([])
})

test('les anciennes Server Actions super-admin ont disparu', () => {
  const all = walk(join(__dirname, '..', 'src'))
  expect(all.filter(p => /lib[\\/]actions[\\/]super-admin/.test(p))).toEqual([])
})
