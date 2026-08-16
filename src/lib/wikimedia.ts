import type { LessonImage } from '@/types/db'

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'
const USER_AGENT = 'VoiceTeacherApp/1.0 (educational; contact: aquamariss@gmail.com)'

interface CommonsSearchResult {
  pageid: number
  title: string
}

interface CommonsImageInfo {
  url: string
  thumburl: string
  thumbwidth: number
  thumbheight: number
  extmetadata: {
    Artist?: { value: string }
    LicenseShortName?: { value: string }
    ImageDescription?: { value: string }
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  })
  if (!res.ok) throw new Error(`Commons API HTTP ${res.status}`)
  return res.json()
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim()
}

export async function searchCommonsImages(
  query: string,
  limit = 2
): Promise<LessonImage[]> {
  // Step 1: search for files
  const searchUrl =
    `${COMMONS_API}?action=query&format=json&list=search` +
    `&srnamespace=6&srsearch=${encodeURIComponent(query)}&srlimit=${limit * 3}&origin=*`

  const searchData = (await fetchJson(searchUrl)) as {
    query?: { search?: CommonsSearchResult[] }
  }

  const hits = searchData.query?.search ?? []
  if (hits.length === 0) return []

  // Step 2: get imageinfo for each candidate
  const titles = hits.slice(0, limit * 3).map(h => h.title).join('|')
  const infoUrl =
    `${COMMONS_API}?action=query&format=json&titles=${encodeURIComponent(titles)}` +
    `&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=400&origin=*`

  const infoData = (await fetchJson(infoUrl)) as {
    query?: { pages?: Record<string, { title: string; imageinfo?: CommonsImageInfo[] }> }
  }

  const pages = Object.values(infoData.query?.pages ?? {})
  const results: LessonImage[] = []

  for (const page of pages) {
    if (results.length >= limit) break
    const info = page.imageinfo?.[0]
    if (!info?.url) continue

    // Skip SVGs that are not diagrams and non-image formats
    const lowerUrl = info.url.toLowerCase()
    if (lowerUrl.endsWith('.ogg') || lowerUrl.endsWith('.webm') || lowerUrl.endsWith('.ogv')) continue

    const rawAuthor = info.extmetadata?.Artist?.value ?? 'Unknown'
    const author = stripHtml(rawAuthor).slice(0, 120)
    const license = info.extmetadata?.LicenseShortName?.value ?? 'Unknown'

    // Build source page URL from title
    const titleEncoded = encodeURIComponent(page.title.replace(/ /g, '_'))
    const sourcePage = `https://commons.wikimedia.org/wiki/${titleEncoded}`

    results.push({
      query,
      title: page.title.replace(/^File:/, ''),
      thumbnail_url: info.thumburl ?? info.url,
      full_url: info.url,
      author,
      license,
      source_page_url: sourcePage,
    })
  }

  return results
}
