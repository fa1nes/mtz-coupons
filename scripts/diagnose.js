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

  const jsUrls = text.match(/https:\/\/[^"']*?\.js/g) || []

  console.log('[template] js urls:', [...new Set(jsUrls)].slice(0, 20))

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

  if (!tmplData.appJs) return

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

  for (const conf of [mainActConf, ...gundamActConfs]) {
    try {
      await diagnose(cookie, conf.gid, guard)
    } catch (e) {
      console.log(`[${conf.gid}] 诊断异常:`, e?.message || e)
    }
  }
}

main()
