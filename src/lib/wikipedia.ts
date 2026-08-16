import type { LessonImage } from '@/types/db'

const WP_API = 'https://en.wikipedia.org/w/api.php'
const WP_REST = 'https://en.wikipedia.org/api/rest_v1'
const USER_AGENT = 'VoiceTeacherApp/1.0 (educational; contact: aquamariss@gmail.com)'

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`Wikipedia API HTTP ${res.status}: ${url}`)
  return res.json()
}

async function resolvePageTitle(query: string): Promise<string | null> {
  const url = `${WP_API}?action=query&format=json&list=search&srsearch=${encodeURIComponent(query)}&srlimit=1&origin=*`
  const data = (await fetchJson(url)) as { query?: { search?: { title: string }[] } }
  return data.query?.search?.[0]?.title ?? null
}

interface MediaItem {
  title?: string
  type?: string
  showInGallery?: boolean
  caption?: { text?: string }
}

function cleanCaption(raw: string): string | undefined {
  // Drop everything from CSS legend blocks or inline formula whitespace
  let text = raw
    .replace(/\.mw-parser-output[\s\S]*/g, '')  // CSS legend garbage
    .replace(/\n\s{2,}[\s\S]*/g, '')            // formula HTML (lots of leading whitespace)
    .replace(/\s+/g, ' ')
    .trim()

  // Drop trailing incomplete sentence (no ending punctuation)
  const sentences = text.split(/(?<=[.!?])\s+/)
  const complete = sentences.filter(s => /[.!?]$/.test(s))
  text = complete.length > 0 ? complete.join(' ') : text

  return text.length > 20 ? text : undefined
}

// Get article caption for an image from the media-list endpoint
async function getMediaCaption(pageTitle: string, imageFilename: string): Promise<string | undefined> {
  try {
    const encoded = encodeURIComponent(pageTitle.replace(/ /g, '_'))
    const data = (await fetchJson(`${WP_REST}/page/media-list/${encoded}`)) as { items?: MediaItem[] }
    const items = (data.items ?? []).filter(i => i.type === 'image')

    const normalise = (s: string) => s.replace(/^File:/i, '').replace(/_/g, ' ').toLowerCase()
    const targetName = normalise(imageFilename)

    const match =
      items.find(i => normalise(i.title ?? '') === targetName) ??
      items.find(i => i.showInGallery)

    const raw = match?.caption?.text?.trim()
    return raw ? cleanCaption(raw) : undefined
  } catch {
    return undefined
  }
}

async function getArticleImage(pageTitle: string): Promise<LessonImage | null> {
  const encoded = encodeURIComponent(pageTitle.replace(/ /g, '_'))

  const data = (await fetchJson(`${WP_REST}/page/summary/${encoded}`)) as {
    description?: string
    extract?: string
    thumbnail?: { source: string }
    originalimage?: { source: string }
    content_urls?: { desktop?: { page?: string } }
  }

  const thumbnail = data.thumbnail?.source
  const fullUrl = data.originalimage?.source ?? thumbnail
  if (!thumbnail || !fullUrl) return null

  const articleUrl = data.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encoded}`
  const rawFilename = decodeURIComponent(fullUrl.split('/').pop() ?? '').replace(/_/g, ' ')

  // Prefer full article caption, fall back to Wikidata description or first extract sentence
  const description =
    (await getMediaCaption(pageTitle, rawFilename)) ??
    data.description ??
    data.extract?.split(/(?<=[.!?])\s/)[0]?.trim()

  return {
    query: pageTitle,
    title: rawFilename,
    thumbnail_url: thumbnail,
    full_url: fullUrl,
    author: 'Wikipedia contributors',
    license: 'CC BY-SA',
    source_page_url: articleUrl,
    description,
  }
}

export interface WikiSearchResult {
  title: string
  url: string
  description: string | null
  thumbnail: string | null
}

export async function searchWikipediaArticles(
  query: string,
  lang = 'ru',
  limit = 4,
): Promise<WikiSearchResult[]> {
  try {
    const url = `https://${lang}.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=${limit}`
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return []

    const data = await res.json() as {
      pages: Array<{
        key: string
        title: string
        description?: string
        excerpt?: string
        thumbnail?: { url: string }
      }>
    }

    return (data.pages ?? []).map(p => ({
      title: p.title,
      url: `https://${lang}.wikipedia.org/wiki/${p.key}`,
      description: p.description ?? p.excerpt?.replace(/<[^>]+>/g, '') ?? null,
      thumbnail: p.thumbnail?.url ? `https:${p.thumbnail.url}` : null,
    }))
  } catch {
    return []
  }
}

export async function fetchWikipediaImages(
  wikipediaTitle: string,
  limit = 1
): Promise<LessonImage[]> {
  try {
    const directImg = await getArticleImage(wikipediaTitle).catch(() => null)
    if (directImg) return [directImg]

    const resolved = await resolvePageTitle(wikipediaTitle)
    if (!resolved) return []

    const img = await getArticleImage(resolved)
    if (!img) return []

    return [img].slice(0, limit)
  } catch (e) {
    console.warn('[wikipedia] fetchWikipediaImages error:', e)
    return []
  }
}
