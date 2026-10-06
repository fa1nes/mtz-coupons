// 临时诊断脚本：打印活动页模板与前端 JS 中的模块结构，不输出 token 和用户信息
import ShadowGuard from '../src/shadow/index.js'
import gundam from '../src/coupons/gundam.js'
import request from '../src/request.js'
import { createMTCookie, parseToken } from '../src/user.js'
import { mainActConf, gundamActConfs } from '../src/coupons/const.js'

const CTX = 400

function around(text, idx, before = 120, after = CTX) {
  return text
    .slice(Math.max(0, idx - before), idx + after)
    .replace(/\s+/g, ' ')
}

function findAll(text, needle, limit = 3) {
  const res = []
  let idx = text.indexOf(needle)

  while (idx !== -1 && res.length < limit) {
    res.push(idx)
    idx = text.indexOf(needle, idx + needle.length)
  }

  return res
}

async function diagnose(cookie, gid, guard) {
  console.log(`\n==================== ${gid} ====================`)

  const tmplUrl = `https://market.waimai.meituan.com/api/template/get?env=current&el_biz=waimai&el_page=gundam.loader&gundam_id=${gid}`
  const rep = await request(tmplUrl)
  const text = await rep.text()

  console.log('[template] status:', rep.status, 'finalUrl:', rep.url)
  console.log('[template] length:', text.length)

  const matchGlobal = text.match(/globalData: ({.+})/)

  if (!matchGlobal) {
    console.log('[template] 未找到 globalData，前 800 字符:')
    console.log(text.slice(0, 800))
    return
  }

  const globalData = JSON.parse(matchGlobal[1])

  console.log('[globalData] keys:', Object.keys(globalData).join(','))
  console.log('[globalData] gdId/pageId/gundamViewId/title:', {
    gdId: globalData.gdId,
    pageId: globalData.pageId,
    gundamViewId: globalData.gundamViewId,
    title: globalData.pageInfo?.title
  })

  const ri = globalData.renderInfo

  console.log('[renderInfo] status:', ri?.status)
  if (ri?.componentRenderInfos) {
    console.log(
      '[renderInfo] components:',
      Object.entries(ri.componentRenderInfos)
        .map(([k, v]) => `${k}:${v.render}`)
        .join(', ')
    )
  }

  if (ri?.componentRenderInfos) {
    for (const [k, v] of Object.entries(ri.componentRenderInfos)) {
      if (v.render) console.log('[renderInfo]', k, JSON.stringify(v).slice(0, 1500))
    }
  }

  // 模板 HTML 中与渲染组件相关的上下文
  for (const kw of ['16970942475030.86692166477736240', 'componentList', 'compList', 'serverData']) {
    const hits = findAll(text, kw, 2)

    console.log(`[templateHtml] "${kw}" 命中 ${hits.length} 处`)
    hits.forEach((i) => console.log('  ...', around(text, i, 300, 1200), '...'))
  }

  const jsUrls = text.match(/https:\/\/[^"']*?\.js/g) || []

  console.log('[template] js urls:', [...new Set(jsUrls)].slice(0, 20))

  const KWS = [
    'red-envelope',
    'netunion',
    'expandCouponIds',
    'priorityCouponIds',
    'isStopTJCoupon',
    'gundamGrab'
  ]
  const dump = (label, body) => {
    console.log(`\n[${label}] length:`, body.length)
    for (const kw of KWS) {
      const hits = findAll(body, kw, 2)

      console.log(`[${label}] "${kw}" 命中 ${hits.length} 处`)
      hits.forEach((i) => console.log('  ...', around(body, i, 300, 600), '...'))
    }
  }

  // renderTree 中的组件名
  const names = []
  const walk = (n) => {
    if (!n || typeof n != 'object') return
    if (n.name && (n.instanceID || n.id)) names.push(`${n.name}#${n.instanceID || n.id}`)
    Object.values(n).forEach(walk)
  }

  walk(globalData.renderTree)
  console.log('[renderTree] components:', [...new Set(names)].slice(0, 120).join('\n  '))
  dump('renderTree', JSON.stringify(globalData.renderTree || {}))
  dump('instanceProps', JSON.stringify(globalData.instanceProps || {}))
  console.log('[pageConfigJsonUrl]', globalData.pageConfigJsonUrl)

  if (globalData.pageConfigJsonUrl) {
    try {
      const cfgUrl = globalData.pageConfigJsonUrl.startsWith('//')
        ? 'https:' + globalData.pageConfigJsonUrl
        : globalData.pageConfigJsonUrl
      const cfgText = await request(cfgUrl).then((r) => r.text())

      dump('pageConfig', cfgText)
    } catch (e) {
      console.log('[pageConfig] 获取失败', e?.message || e)
    }
  }

  for (const u of [...new Set(jsUrls)].filter((u) => u.includes('gundam-component') && false)) {
    try {
      const body = await request(u).then((r) => r.text())
      const hits = KWS.filter((kw) => body.includes(kw))
      const apis = [
        ...new Set(
          (body.match(new RegExp("(?:https?:)?//[a-z.]*meituan\\.com/[\\w/.-]{3,120}|[\"']/[\\w-]+/[\\w/.-]{3,100}[\"']", 'g')) || [])
        )
      ].slice(0, 40)
      const nameMatch = body.match(/gdc-[a-z0-9-]+/g) || []

      console.log('[component]', u.split('/').slice(-2)[0], body.length, hits)
      console.log('  names:', [...new Set(nameMatch)].slice(0, 10).join(','))
      console.log('  apis:', apis.join(' '))
      for (const kw of ['/component/instanceProps', '/gundam/data', '/gd/zc/', 'renderinfo']) {
        findAll(body, kw, 2).forEach((i) =>
          console.log(`  [ctx ${kw}] ...`, around(body, i, 1200, 1500), '...')
        )
      }
    } catch (e) {
      console.log('[component] 获取失败', u, e?.message || e)
    }
  }

  let tmplData

  try {
    const { getTemplateData } = await import('../src/template.js')

    tmplData = await getTemplateData(cookie, gid, guard)
    console.log('[tmplData] appJs:', tmplData.appJs)
    console.log('[tmplData] renderList:', tmplData.renderList)
  } catch (e) {
    console.log('[tmplData] 失败:', e?.message || e)
    return
  }

  // 新版：运行时拉取组件配置，多种请求方式对比
  const ipUrl = 'https://market.waimai.meituan.com/component/instanceProps'
  const ids = tmplData.renderList
  const base = { pageId: globalData.pageId, tenantId: 'gundam', instanceIds: ids }
  const hdr = {
    Origin: 'https://market.waimai.meituan.com',
    Referer: gundam.getActUrl(gid).toString()
  }
  const variants = {
    json: () => request.post(ipUrl, base, { cookie, headers: hdr }),
    jsonGuard: () =>
      request.post(ipUrl, base, { cookie, headers: hdr, guard }),
    form: () =>
      request.post(
        ipUrl,
        { ...base, instanceIds: JSON.stringify(ids) },
        { cookie, headers: hdr, type: 'form' }
      ),
    formCsv: () =>
      request.post(
        ipUrl,
        { ...base, instanceIds: ids.join(',') },
        { cookie, headers: hdr, type: 'form', guard }
      ),
    gdIdJson: () =>
      request.post(ipUrl, { ...base, gdId: globalData.gdId }, { cookie, headers: hdr, guard })
  }

  for (const [name, fn] of Object.entries(variants)) {
    try {
      const res = await fn()
      const str = JSON.stringify(res)

      console.log(`\n[instanceProps ${name}] len=${str.length} head:`, str.slice(0, 600))
      if (str.length > 200) dump(`instanceProps ${name}`, str)
    } catch (e) {
      console.log(`[instanceProps ${name}] 失败:`, JSON.stringify(e)?.slice(0, 300))
    }
  }

  return

  const jsText = await request(tmplData.appJs).then((r) => r.text())

  console.log('[appJs] length:', jsText.length)

  for (const kw of [
    'red-envelope',
    'netunion',
    'expandCouponIds',
    'priorityCouponIds',
    'isStopTJCoupon'
  ]) {
    const hits = findAll(jsText, kw)

    console.log(`\n[appJs] "${kw}" 命中 ${hits.length} 处`)
    hits.forEach((i) => console.log('  ...', around(jsText, i), '...'))
  }

  for (const id of tmplData.renderList) {
    const hits = findAll(jsText, id, 2)

    console.log(`\n[appJs] instanceId ${id} 命中 ${hits.length} 处`)
    hits.forEach((i) => console.log('  ...', around(jsText, i, 200, 300), '...'))
  }
}

async function main() {
  const [account] = parseToken(process.env.TOKEN)
  const cookie = createMTCookie(account.token)
  const guard = await new ShadowGuard().init(gundam.getActUrl(mainActConf.gid))

  console.log('[guard] h5fp ok:', !!guard.h5fp, 'dfpId ok:', !!guard.context.dfpId)

  for (const conf of [mainActConf]) {
    try {
      await diagnose(cookie, conf.gid, guard)
    } catch (e) {
      console.log(`[${conf.gid}] 诊断异常:`, e?.message || e)
    }
  }
}

main()
