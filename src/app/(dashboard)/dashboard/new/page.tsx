'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Эта страница больше не используется напрямую.
// Прямой переход по URL или из истории браузера — открываем панель и уходим на /dashboard.
export default function NewDisciplineRedirectPage() {
  const router = useRouter()

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('assistant:new-discipline'))
    router.replace('/dashboard')
  }, [router])

  return null
}
