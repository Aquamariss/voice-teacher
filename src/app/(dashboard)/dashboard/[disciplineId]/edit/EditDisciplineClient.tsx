'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { type Discipline, type Topic } from '@/types/db'

export default function EditDisciplineClient({
  discipline,
  topics,
}: {
  discipline: Discipline
  topics: Topic[]
}) {
  const router = useRouter()

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('assistant:edit-discipline', { detail: { discipline, topics } })
    )
    router.replace(`/dashboard/${discipline.id}`)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}
