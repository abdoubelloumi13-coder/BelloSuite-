'use client'

import { useState } from 'react'
import { useRouter, Link } from '@/i18n/routing'
import { useTranslations } from 'next-intl'
import { Eye, EyeOff, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'

export default function RegisterPage() {
  const t = useTranslations('Auth')
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const handleRegister = async () => {
    if (!email) { setErrorMsg(t('errors.email_required')); return }
    if (password.length < 6) { setErrorMsg(t('errors.password_min')); return }
    if (password !== confirmPassword) { setErrorMsg(t('errors.password_mismatch')); return }
    setErrorMsg('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (res.ok) {
        setSuccess(true)
      } else {
        setErrorMsg(data.error || t('errors.generic_error'))
      }
    } catch (err: any) {
      setErrorMsg(err.message || t('errors.connection_error'))
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleRegister()
  }

  const handleGoogleLogin = async () => {
    const { supabase } = await import('@/lib/supabase/client')
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback?next=/dashboard`,
      },
    })
  }

  // ── Success State ────────────────────────────────────────────
  if (success) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4 font-sans">
        <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl p-8 shadow-2xl text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center mx-auto mb-6 shadow-lg shadow-teal-500/20">
            <span className="text-white font-black text-2xl">B</span>
          </div>

          <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-10 h-10 text-emerald-400" />
          </div>

          <h1 className="text-2xl font-black text-white mb-2">{t('success_title')}</h1>
          <p className="text-zinc-400 text-sm mb-6 leading-relaxed">
            {t('success_description')}<br />
            <strong className="text-teal-400">{email}</strong>
          </p>

          <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-2xl p-5 mb-6 text-start space-y-3">
            <p className="text-xs font-black text-zinc-400 uppercase tracking-widest">{t('next_step')}</p>
            <div className="space-y-2.5">
              {[
                t('step_1'),
                t('step_2'),
                t('step_3'),
              ].map((step, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className="w-5 h-5 rounded-full bg-teal-500/20 text-teal-400 text-xs font-black flex-shrink-0 flex items-center justify-center mt-0.5">{i + 1}</span>
                  <p className="text-zinc-300 text-xs leading-relaxed" dangerouslySetInnerHTML={{ __html: step }} />
                </div>
              ))}
            </div>
            <div className="pt-3 border-t border-zinc-700/50">
              <p className="text-zinc-500 text-xs">
                💡 {t('not_received')}{' '}
                <button onClick={() => { setSuccess(false); setEmail(''); setPassword(''); setConfirmPassword('') }}
                  className="text-teal-400 hover:underline font-medium">
                  {t('retry')}
                </button>
              </p>
            </div>
          </div>

          <Link href="/login"
            className="block w-full py-3 bg-teal-600 hover:bg-teal-500 text-white rounded-xl font-bold text-center transition-all">
            {t('login_link')}
          </Link>

          <p className="text-center text-zinc-600 text-xs mt-4">
            {t('activation_note')}
          </p>
        </div>
      </div>
    )
  }

  // ── Form State ───────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4 font-sans">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl p-8 shadow-2xl">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-teal-500/20">
            <span className="text-white font-black text-2xl">B</span>
          </div>
          <h1 className="text-3xl font-black text-white">BelloSuite</h1>
          <p className="text-zinc-500 mt-1 font-medium">{t('register_title')}</p>
        </div>

        {errorMsg && (
          <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-xl p-3 mb-4">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <p className="text-red-400 text-sm font-medium">{errorMsg}</p>
          </div>
        )}

        <div className="space-y-4 text-start" onKeyDown={handleKeyDown}>
          <button
            onClick={handleGoogleLogin}
            className="w-full py-3.5 bg-white hover:bg-zinc-100 text-zinc-950 rounded-xl font-bold transition-all flex items-center justify-center gap-3 shadow-lg"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="currentColor"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="currentColor"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
              />
              <path
                fill="currentColor"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            {t('google_login')}
          </button>

          <div className="flex items-center gap-4 my-2">
            <div className="h-px bg-zinc-800 flex-1"></div>
            <span className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">{t('or_separator')}</span>
            <div className="h-px bg-zinc-800 flex-1"></div>
          </div>

          <div>
            <label className="block text-zinc-400 text-xs font-black uppercase tracking-widest mb-1.5 px-1">{t('email')}</label>
            <input type="email" placeholder="votre@email.com" autoComplete="email"
              className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white outline-none focus:border-teal-500 transition-colors placeholder:text-zinc-600"
              value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="block text-zinc-400 text-xs font-black uppercase tracking-widest mb-1.5 px-1">{t('password')}</label>
            <div className="relative">
              <input type={showPassword ? 'text' : 'password'} placeholder="••••••••" autoComplete="new-password"
                className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white outline-none focus:border-teal-500 transition-colors placeholder:text-zinc-600"
                value={password} onChange={e => setPassword(e.target.value)} />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-inline-end-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors p-1">
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-zinc-400 text-xs font-black uppercase tracking-widest mb-1.5 px-1">{t('confirm_password')}</label>
            <input type={showPassword ? 'text' : 'password'} placeholder="••••••••" autoComplete="new-password"
              className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white outline-none focus:border-teal-500 transition-colors placeholder:text-zinc-600"
              value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
          </div>

          <button onClick={handleRegister} disabled={loading}
            className="w-full py-4 bg-teal-600 hover:bg-teal-500 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-teal-500/20">
            {loading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> {t('creating_account')}</>
            ) : t('create_account_button')}
          </button>
        </div>

        <p className="text-center text-zinc-500 text-sm mt-8">
          {t('already_have_account')}{' '}
          <Link href="/login" className="text-teal-400 hover:text-teal-300 font-bold transition-colors">
            {t('login_link')}
          </Link>
        </p>

        <p className="text-center text-zinc-600 text-[10px] mt-6 leading-relaxed">
          {t('terms_note')}{' '}
          <Link href="/terms" className="text-zinc-500 hover:text-teal-400 underline">{t('terms')}</Link>
          {' '}{t('and')}{' '}
          <Link href="/privacy" className="text-zinc-500 hover:text-teal-400 underline">{t('privacy')}</Link>
        </p>
      </div>
    </div>
  )
}
