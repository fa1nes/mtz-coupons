import request from '../request.js'
import ShadowGuard from '../shadow/index.js'
import { createMTCookie, getUserInfo } from '../user.js'
import { mainActConf, gundamActConfs, wxfwhActConfs, ECODE } from './const.js'
import gundam from './gundam.js'
import wxfwh from './wxfwh.js'

async function runTask(cookie, guard) {
  try {
    // 优先检测登录状态
    const userInfo = await getUserInfo(cookie)

    // 主线任务，失败时降级执行支线任务（登录过期直接抛出）
    let mainError = null
    const results = await gundam
      .grabCoupon(cookie, mainActConf.gid, guard)
      .catch((e) => {
        if (e?.code == ECODE.AUTH) throw e

        mainError = e
        console.log(`[${mainActConf.name}] 领取失败:`, e?.message || e)

        return []
      })

    // 支线任务，并行执行提升效率
    const asyncResults = await Promise.all([
      ...gundamActConfs.map((conf) =>
        gundam.grabCoupon(cookie, conf.gid, guard).catch(() => [])
      )
      // 微信服务号活动
      // ...wxfwhActConfs.map((conf) =>
      //   wxfwh.grabCoupon(cookie, conf.gid, guard).catch(() => [])
      // )
    ])

    results.push(...asyncResults.flat())

    // 全部活动都没领到时，按主线异常处理
    if (mainError && !results.length) throw mainError

    return {
      code: ECODE.SUCC,
      data: {
        userInfo,
        coupons: results
      },
      msg: '成功'
    }
  } catch (e) {
    let code, msg

    // console.log('grabCoupon error', e)

    switch (e.code) {
      case ECODE.AUTH:
        code = ECODE.AUTH
        msg = '登录过期'
        break
      case request.ECODE.FETCH:
        code = ECODE.API
        msg = '接口异常'
        break
      case request.ECODE.TIMEOUT:
      case request.ECODE.NETWOEK:
        code = ECODE.NETWOEK
        msg = '网络异常'
        break
      default:
        code = ECODE.RUNTIME
        msg = '程序异常'
    }

    return { code, msg, error: e }
  }
}

/**
 * 领取优惠券
 * @param  {String} token 用户 token
 * @param  {Number} maxRetry  最大重试次数
 * @return {Promise(<Object>)} 结果
 */
async function grabCoupons(token, { maxRetry = 0, proxy }) {
  if (!token) {
    return {
      code: ECODE.RUNTIME,
      msg: '请设置 token',
      error: ''
    }
  }

  // 优先设置代理
  if (proxy) {
    request.setProxyAgent(proxy)
  }

  const cookieJar = createMTCookie(token)

  // 复用 guard
  const guard = await new ShadowGuard().init(gundam.getActUrl(mainActConf.gid))

  async function main(retryTimes = 0) {
    const result = await runTask(cookieJar, guard)
    const needRetry = [ECODE.NETWOEK, ECODE.API].includes(result.code)

    // 标记重试次数
    result['retryTimes'] = retryTimes

    if (!needRetry || retryTimes >= maxRetry) return result

    return main(++retryTimes)
  }

  return main()
}

export { grabCoupons, ECODE }
