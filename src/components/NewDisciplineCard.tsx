'use client'

export default function NewDisciplineCard() {
  return (
    <button
      onClick={() => window.dispatchEvent(new CustomEvent('assistant:new-discipline'))}
      className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:border-blue-400 hover:bg-blue-50 transition-colors group w-full"
    >
      <div className="text-3xl mb-2 text-gray-400 group-hover:text-blue-500">+</div>
      <div className="text-sm font-medium text-gray-500 group-hover:text-blue-600">
        Новая дисциплина
      </div>
    </button>
  )
}
