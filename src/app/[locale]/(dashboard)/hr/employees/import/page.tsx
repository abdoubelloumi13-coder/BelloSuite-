'use client'

import { useState, useRef } from 'react'
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle, X, Download, Table } from 'lucide-react'
import { useSession } from '@/hooks/useSession'
import { useTranslations } from 'next-intl'

const TEMPLATE_FIELDS = [
  'employeeNumber', 'firstName', 'lastName', 'hireDate',
  'email', 'phone', 'cin', 'birthDate', 'birthPlace', 'nationality',
  'genre', 'etatCivil', 'enfantsCharge', 'situationFamiliale',
  'address', 'city', 'departement', 'poste', 'qualificationCode',
  'typeContrat', 'salary', 'modePaie', 'banque', 'compteBancaire',
  'cnssNumber', 'cnrpsNumber', 'amoNumber',
]

const SAMPLE = {
  employeeNumber: 'EMP-001',
  firstName: 'Ahmed',
  lastName: 'Ben Salah',
  hireDate: '2024-01-15',
  email: 'ahmed.bensalah@email.tn',
  phone: '+216 20 123 456',
  cin: '01234567',
  birthDate: '1990-05-20',
  birthPlace: 'Tunis',
  nationality: 'Tunisienne',
  genre: 'MALE',
  etatCivil: 'MARIE',
  enfantsCharge: '2',
  situationFamiliale: 'CHEF_FAMILLE',
  address: '12 Rue de la Liberté',
  city: 'Tunis',
  departement: 'Commercial',
  poste: 'Vendeur',
  qualificationCode: 'V1',
  typeContrat: 'CDI',
  salary: '1200.000',
  modePaie: 'VIREMENT',
  banque: 'STB',
  compteBancaire: '0123456789012',
  cnssNumber: 'CNSS123456',
  cnrpsNumber: '',
  amoNumber: 'AMO789012',
}

export default function ImportEmployeesPage() {
  const ti = useTranslations('Import')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<any[]>([])
  const [results, setResults] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const { tenantId } = useSession()


  const handleFile = (f: File) => {
    setFile(f)
    setResults(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer)
        import('xlsx').then(XLSX => {
          const wb = XLSX.read(data, { type: 'array' })
          const ws = wb.Sheets[wb.SheetNames[0]]
          const json = XLSX.utils.sheet_to_json(ws, { defval: '' })
          setPreview(json.slice(0, 10))
        })
      } catch { alert(ti('unreadable')) }
    }
    reader.readAsArrayBuffer(f)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  const handleSubmit = async () => {
    if (!file || !tenantId) return
    setLoading(true)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await fetch('/api/hr/employees/import', { method: 'POST', body: fd })
      const data = await res.json()
      setResults(data)
    } catch (e: any) {
      setResults({ error: e.message })
    }
    setLoading(false)
  }

  const downloadTemplate = () => {
    import('xlsx').then(XLSX => {
      const sampleRow = TEMPLATE_FIELDS.map(f => SAMPLE[f as keyof typeof SAMPLE] ?? '')
      const ws = XLSX.utils.aoa_to_sheet([[...TEMPLATE_FIELDS], sampleRow])
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Employees')
      XLSX.writeFile(wb, 'template_import_employes.xlsx')
    })
  }

  return (
    <div className="p-8 space-y-8 max-w-5xl mx-auto min-h-screen bg-transparent pt-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-white tracking-tight">{ti('employees.title')}</h1>
          <p className="text-zinc-500 font-medium text-sm mt-1">{ti('employees.subtitle')}</p>
        </div>
        <button
          onClick={downloadTemplate}
          className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl font-bold text-sm"
        >
          <Download className="w-4 h-4" /> {ti('template')}
        </button>
      </div>

      {/* Drop Zone */}
      <div
        className={`border-2 border-dashed rounded-[2rem] p-12 text-center transition-all cursor-pointer ${
          dragOver ? 'border-teal-500 bg-teal-500/5' : 'border-zinc-700 hover:border-zinc-500'
        }`}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
      >
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
          onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
        {file ? (
          <div className="flex items-center justify-center gap-3">
            <FileSpreadsheet className="w-8 h-8 text-teal-400" />
            <div className="text-start">
              <p className="font-bold text-white">{file.name}</p>
              <p className="text-xs text-zinc-500">{(file.size / 1024).toFixed(1)} KB</p>
            </div>
            <button onClick={e => { e.stopPropagation(); setFile(null); setPreview([]) }} className="ms-4 p-2 hover:bg-zinc-700 rounded-lg">
              <X className="w-4 h-4 text-zinc-400" />
            </button>
          </div>
        ) : (
          <>
            <Upload className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
            <p className="text-zinc-400 font-medium">{ti('employees.drop_here')}</p>
            <p className="text-zinc-600 text-xs mt-2">{ti('employees.browse')}</p>
          </>
        )}
      </div>

      {/* Preview */}
      {preview.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Table className="w-4 h-4 text-zinc-500" />
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">{ti('preview_first_rows', { count: preview.length })}</p>
          </div>
          <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-[1.5rem] overflow-x-auto">
            <table className="w-full text-start text-xs">
              <thead>
                <tr className="border-b border-zinc-800/50 bg-zinc-800/20">
                  {Object.keys(preview[0]).map(h => (
                    <th key={h} className="px-4 py-3 text-zinc-500 font-black uppercase tracking-widest">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, i) => (
                  <tr key={i} className="border-b border-zinc-800/30">
                    {Object.values(row).map((v, j) => (
                      <td key={j} className="px-4 py-3 text-zinc-300 font-mono truncate max-w-[150px]">{String(v)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Submit */}
      {file && (
        <button
          onClick={handleSubmit}
          disabled={loading || !tenantId}
          className="w-full py-4 bg-teal-600 hover:bg-teal-500 disabled:bg-zinc-700 text-white rounded-2xl font-black text-base transition-all flex items-center justify-center gap-3"
        >
          {loading ? (
            <><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> {ti('importing')}</>
          ) : (
            <><Upload className="w-5 h-5" /> {ti('employees.import_n', { count: preview.length })}</>
          )}
        </button>
      )}

      {/* Results */}
      {results && (
        <div className="space-y-4">
          {results.error ? (
            <div className="bg-red-500/10 border border-red-500/20 rounded-[1.5rem] p-6">
              <div className="flex items-center gap-3 text-red-400 font-bold mb-2">
                <AlertCircle className="w-5 h-5" /> {ti('error')}
              </div>
              <p className="text-red-300 text-sm font-mono">{results.error}</p>
            </div>
          ) : (
            <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-[1.5rem] p-8 space-y-6">
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-emerald-500/10 rounded-2xl p-5 text-center">
                  <p className="text-3xl font-black text-emerald-400">{results.imported}</p>
                  <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mt-1">{ti('imported')}</p>
                </div>
                <div className="bg-red-500/10 rounded-2xl p-5 text-center">
                  <p className="text-3xl font-black text-red-400">{results.failed}</p>
                  <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mt-1">{ti('failures')}</p>
                </div>
                <div className="bg-zinc-800/50 rounded-2xl p-5 text-center">
                  <p className="text-3xl font-black text-zinc-400">{results.total}</p>
                  <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mt-1">{ti('total')}</p>
                </div>
              </div>

              {results.log?.length > 0 && (
                <div>
                  <p className="text-xs font-black text-emerald-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                    <CheckCircle className="w-3 h-3" /> {ti('employees.created')}
                  </p>
                  <div className="space-y-1">
                    {results.log.slice(0, 20).map((l: any, i: number) => (
                      <div key={i} className="flex items-center gap-3 text-xs font-mono text-zinc-400 bg-zinc-800/30 rounded-lg px-3 py-2">
                        <span className="text-zinc-600">#{l.row}</span>
                        <span className="text-teal-400">{l.employeeNumber}</span>
                        <span className="text-zinc-500 truncate">{l.name}</span>
                      </div>
                    ))}
                    {results.log.length > 20 && <p className="text-zinc-600 text-xs text-center">{ti('and_more', { count: results.log.length - 20 })}</p>}
                  </div>
                </div>
              )}

              {results.errors?.length > 0 && (
                <div>
                  <p className="text-xs font-black text-red-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                    <AlertCircle className="w-3 h-3" /> {ti('errors')}
                  </p>
                  <div className="space-y-1">
                    {results.errors.map((e: any, i: number) => (
                      <div key={i} className="flex items-center gap-3 text-xs font-mono text-red-300 bg-red-500/5 rounded-lg px-3 py-2">
                        <span className="text-zinc-600">#{e.row}</span>
                        {e.employeeNumber && <span className="text-red-400">{e.employeeNumber}</span>}
                        <span>{e.error}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}