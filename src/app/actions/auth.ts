'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ensureLearnerProfile } from '@/lib/context/assembleContext'

type AuthState =
  | { errors?: { email?: string; password?: string }; message?: string }
  | undefined

export async function login(state: AuthState, formData: FormData): Promise<AuthState> {
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  if (!email) return { errors: { email: 'Введите email' } }
  if (!password) return { errors: { password: 'Введите пароль' } }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return { message: 'Неверный email или пароль' }
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (user) await ensureLearnerProfile(user.id)

  redirect('/dashboard')
}

export async function signup(state: AuthState, formData: FormData): Promise<AuthState> {
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  if (!email) return { errors: { email: 'Введите email' } }
  if (!password || password.length < 6) {
    return { errors: { password: 'Пароль — минимум 6 символов' } }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signUp({ email, password })

  if (error) {
    return { message: error.message }
  }

  redirect('/dashboard')
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
