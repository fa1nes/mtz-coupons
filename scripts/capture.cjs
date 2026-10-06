// 临时抓包脚本：无头浏览器打开活动页，记录美团接口请求（不输出 Cookie）
const pw = require(require.resolve('playwright', { paths: [process.cwd()] }))

const GID = process.env.GID || '2KAWnD'
const ACT_URL = `https://market.waimai.meituan.com/gd/single.html?el_biz=waimai&el_page=gundam.loader&gundam_id=${GID}`
const NOISE = /plx\.meituan|portal-portm|pr\.map\.qq|lbsapi|catfront|dreport|lx\.meituan|msp\.meituan/
const STATIC = /\.(js|css|png|jpe?g|gif|webp|svg|woff2?|ttf|ico)(\?|$)/i
const INTEREST = /grab|coupon|instanceProps|gundam|lottery|fetch|renderinfo|\/data|login|redbag|envelope|union|cps|draw|receive/i

function readToken() {
  let t = (process.env.TOKEN || '').trim()

  if (t.startsWith('{') || t.startsWith('[')) {
    const v = [].concat(JSON.parse(t))[0]

    t = typeof v == 'string' ? v : v.token
  }

  return t.replace(/^token=/, '')
}

function redact(s) {
  if (!s) return s
  return String(s)
    .replace(/(token|userToken|uuid|openId|cookie)(["']?\s*[:=]\s*["']?)[^"'&,;}\s]+/gi, '$1$2<redacted>')
    .replace(/1[3-9]\d{9}/g, '<phone>')
}

const cut = (s, n) => (s && s.length > n ? s.slice(0, n) + `...(+${s.length - n})` : s)

;(async () => {
  const token = readToken()
  const browser = await pw.chromium.launch()
  const context = await browser.newContext({
    ...pw.devices['iPhone 13'],
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    geolocation: { latitude: 31.2304, longitude: 121.4737 },
    permissions: ['geolocation']
  })

  await context.addCookies(
    ['token', 'mt_c_token', 'oops', 'userToken'].map((name) => ({
      name,
      value: token,
      domain: '.meituan.com',
      path: '/'
    }))
  )

  const page = await context.newPage()
  let n = 0

  page.on('request', (req) => {
    const url = req.url()

    if (!/meituan\.com|sankuai\.com/.test(url) || STATIC.test(url) || NOISE.test(url)) return
    console.log(`\n>>> [${++n}] ${req.method()} ${cut(redact(url), 600)}`)
    const h = req.headers()

    console.log('    headers:', Object.keys(h).filter((k) => k != 'cookie').join(','), h.mtgsig ? '(有 mtgsig)' : '')
    if (req.postData()) console.log('    body:', cut(redact(req.postData()), 2500))
  })

  page.on('response', async (res) => {
    const url = res.url()

    if (!/meituan\.com|sankuai\.com/.test(url) || STATIC.test(url) || NOISE.test(url)) return
    if (!INTEREST.test(url)) {
      console.log(`<<< ${res.status()} ${cut(url.split('?')[0], 200)}`)
      return
    }
    try {
      const body = await res.text()

      console.log(`<<< ${res.status()} ${cut(redact(url), 300)}\n    resp: ${cut(redact(body), 2500)}`)
    } catch (e) {
      console.log(`<<< ${res.status()} ${url} (body 不可读)`)
    }
  })

  page.on('console', (m) => {
    const t = m.text()

    if (/error|fail|领|券/i.test(t)) console.log('[page console]', cut(redact(t), 300))
  })

  console.log('打开活动页:', ACT_URL)
  await page.goto(ACT_URL, { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => console.log('goto:', e.message))
  await page.waitForTimeout(8000)

  const bodyText = await page.locator('body').innerText().catch(() => '')

  console.log('\n页面文字:', redact(bodyText.replace(/\s+/g, ' ').slice(0, 1500)))
  console.log('\n页面标题:', await page.title(), '最终 URL:', cut(page.url(), 200))
  const texts = await page
    .locator('text=/领|抢|券|收下|登录/')
    .allInnerTexts()
    .catch(() => [])

  console.log('可点击文案:', texts.slice(0, 20).map((t) => t.replace(/\s+/g, ' ').slice(0, 30)))

  const btn = page.locator('text=/一键领|立即领|领取|开心收下|收下/').locator('visible=true').first()

  if (await btn.count()) {
    console.log('\n点击:', (await btn.innerText()).slice(0, 30))
    await btn.click({ timeout: 5000 }).catch((e) => console.log('click:', e.message))
    await page.waitForTimeout(8000)
  }

  await browser.close()
})().catch((e) => {
  console.log('capture 异常:', e)
  process.exitCode = 1
})
