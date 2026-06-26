'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { signup } from '@/app/actions/auth'

export default function SignupPage() {
  const [state, action, pending] = useActionState(signup, undefined)

  return (
    <div className="bg-white shadow-sm rounded-xl p-8">
      <h1 className="text-2xl font-semibold mb-1">Создать аккаунт</h1>
      <p className="text-sm text-gray-500 mb-6">
        Уже есть аккаунт?{' '}
        <Link href="/login" className="text-blue-600 hover:underline">
          Войти
        </Link>
      </p>

      <form action={action} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {state?.errors?.email && (
            <p className="text-red-500 text-xs mt-1">{state.errors.email}</p>
          )}
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
            Пароль
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {state?.errors?.password && (
            <p className="text-red-500 text-xs mt-1">{state.errors.password}</p>
          )}
        </div>

        {state?.message && (
          <p className="text-red-500 text-sm">{state.message}</p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {pending ? 'Создаём...' : 'Зарегистрироваться'}
        </button>
      </form>
    </div>
  )
}
