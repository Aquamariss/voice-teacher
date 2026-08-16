import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  return (
    <div className="min-h-screen bg-white flex flex-col">

      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🎙</span>
          <span className="font-semibold text-gray-900 text-lg">Голосовой учитель</span>
        </div>
        {user ? (
          <Link href="/dashboard" className="text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors">
            Мои знания →
          </Link>
        ) : (
          <Link href="/login" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">
            Войти
          </Link>
        )}
      </nav>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center text-center px-6 py-16">
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-blue-600 uppercase tracking-wide mb-4">
            Персональный ИИ-учитель
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 leading-tight mb-6">
            Учись слушая —<br />
            <span className="text-blue-600">в дороге, на пробежке,<br className="sm:hidden" /> дома</span>
          </h1>
          <p className="text-lg text-gray-600 mb-4 leading-relaxed">
            Учитель рассказывает материал голосом, может остановиться,
            повторить и ответить на вопросы. Удобно учиться за рулём,
            на прогулке, на пробежке, за домашними делами.
          </p>
          <p className="text-base text-gray-500 mb-10">
            Или переключись в текстовый режим — читай и слушай как удобно.
          </p>
          {user ? (
            <Link href="/dashboard" className="inline-block bg-blue-600 text-white text-base font-semibold px-8 py-3.5 rounded-xl hover:bg-blue-700 transition-colors shadow-sm">
              Перейти к обучению →
            </Link>
          ) : (
            <Link href="/signup" className="inline-block bg-blue-600 text-white text-base font-semibold px-8 py-3.5 rounded-xl hover:bg-blue-700 transition-colors shadow-sm">
              Зарегистрироваться и начать →
            </Link>
          )}
        </div>
      </section>

      {/* Features */}
      <section className="bg-gray-50 px-6 py-14">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-xl font-semibold text-gray-900 text-center mb-10">
            Не просто подкаст — системное обучение
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl p-5 border border-gray-100">
              <div className="text-2xl mb-3">🗺</div>
              <h3 className="font-semibold text-gray-900 mb-1">Программа под ваш запрос</h3>
              <p className="text-sm text-gray-500">
                Опишите что хотите изучить — получите структурированный трек.
                Разобраться в дисциплине, продвинуться на работе, сменить сферу.
              </p>
            </div>
            <div className="bg-white rounded-xl p-5 border border-gray-100">
              <div className="text-2xl mb-3">🧠</div>
              <h3 className="font-semibold text-gray-900 mb-1">Тесты на усвоение</h3>
              <p className="text-sm text-gray-500">
                После каждого занятия — вопросы на воспроизведение и на критическое
                мышление. Проверяйте что действительно осталось в памяти.
              </p>
            </div>
            <div className="bg-white rounded-xl p-5 border border-gray-100">
              <div className="text-2xl mb-3">📁</div>
              <h3 className="font-semibold text-gray-900 mb-1">Практические проекты</h3>
              <p className="text-sm text-gray-500">
                После прохождения темы — практические задания для закрепления
                знаний в реальных сценариях.
              </p>
            </div>
            <div className="bg-white rounded-xl p-5 border border-gray-100">
              <div className="text-2xl mb-3">🎯</div>
              <h3 className="font-semibold text-gray-900 mb-1">Системный трек, не разговор</h3>
              <p className="text-sm text-gray-500">
                Это не поверхностный чат, а выстроенная программа с модулями,
                занятиями и прогрессом по каждой теме.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA bottom */}
      <section className="px-6 py-14 text-center">
        <h2 className="text-2xl font-semibold text-gray-900 mb-4">
          Начните прямо сейчас
        </h2>
        <p className="text-gray-500 mb-8">Бесплатно. Без установки приложения.</p>
        {user ? (
          <Link href="/dashboard" className="inline-block bg-blue-600 text-white text-base font-semibold px-8 py-3.5 rounded-xl hover:bg-blue-700 transition-colors shadow-sm">
            Перейти к обучению →
          </Link>
        ) : (
          <Link href="/signup" className="inline-block bg-blue-600 text-white text-base font-semibold px-8 py-3.5 rounded-xl hover:bg-blue-700 transition-colors shadow-sm">
            Зарегистрироваться и начать →
          </Link>
        )}
      </section>

      {/* Disclaimers */}
      <footer className="border-t border-gray-100 px-6 py-8">
        <div className="max-w-2xl mx-auto space-y-2 text-xs text-gray-400">
          <p>
            Голосовой учитель не выдаёт сертификаты. Подтверждение результатов
            обучения остаётся за пользователем.
          </p>
          <p>
            Сервис предназначен для физических, точных и гуманитарных наук.
            Не применяется для обучения в сфере эзотерики, медикаментозной медицины
            (кроме базовой анатомии и физиологии), психологии и психотерапии как практики.
          </p>
          <p>
            Учебный контент основан на открытых данных, доступных языковым моделям.
          </p>
        </div>
      </footer>

    </div>
  )
}
