'use strict'
import cookie from 'cookie'
import { ChzzkClient } from 'chzzk'

import helper from './common.js'

import Model from './model.js'

import type { Live } from 'chzzk'
import type { UserSetting } from '../interfaces/setting.js'
import type { VideoWithIsAdult } from '../interfaces/common.js'

interface ErrorItem {
  cause?: Error
  message?: string
}

const failMsg = ['ENOTFOUND', 'fetch failed']

const searchTag = ['라이브 아트', '아트']

interface ApiParams {
  model: Model
  chzzkParams?: ConstructorParameters<typeof ChzzkClient>
}

export default class Api {
  model: Model

  chzzk: ChzzkClient

  apiBaseUrl = 'https://api.chzzk.naver.com'

  gameBaseUrl = 'https://comm-api.game.naver.com/nng_main'

  userAgent = 'Mozilla/5.0 (Windows NT 6.3; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/37.0.2049.0 Safari/537.36'

  get headers() {
    return {
      'User-Agent': this.userAgent,
    }
  }

  get headerWithAuth() {
    if (!this.model.cookieIsAvailable) throw new Error('No auth cookie')

    const { auth, session } = this.model.authCookie
    return {
      'User-Agent': this.userAgent,
      Cookie: `NID_SES=${session};NID_AUT=${auth}`,
    }
  }

  constructor({ model, chzzkParams = [] }: ApiParams) {
    this.model = model
    this.chzzk = new ChzzkClient(...chzzkParams)
  }

  getSourceUrl(channelId: string) {
    return `https://chzzk.naver.com/live/${channelId}`
  }

  //#region 其他
  async getOnlineUserByTag(tag: string) {
    const size = 50

    let offset = 0
    let errorCount = 0
    let isOngoing = true

    const liveStreams: Live[] = []
    do {
      try {
        const resp = await this.chzzk.search.lives(tag, { size, offset })

        liveStreams.push(...resp.lives)

        offset += size
        isOngoing = resp.size !== 0

        await helper.wait(10)
      } catch (error) {
        const err = error as ErrorItem

        if (++errorCount === 5) {
          isOngoing = false
          return []
        }

        const errors = [err?.message, err.cause?.message].filter((e): e is string => Boolean(e))
        if (errors.some((err) => failMsg.includes(err))) {
          errorCount++
          continue
        }

        console.error(error)
      }
    } while (isOngoing)

    return liveStreams
  }

  async searchLives() {
    const livesArray = await Promise.all(searchTag.map((tag) => this.getOnlineUserByTag(tag)))

    const liveMap = livesArray.flat().reduce((map, live) => {
      map.set(live.channelId, live)
      return map
    }, new Map<UserSetting['channelId'], Live>())

    return Array.from(liveMap.values())
  }

  async getLiveDetail(channelId: string) {
    const res = await this.chzzk.live.detail(channelId)

    return res
  }

  async getVod(vodNum: number) {
    const res = await fetch(`https://api.chzzk.naver.com/service/v2/videos/${vodNum}`, { headers: this.headers })
    const json = (await res.json()) as { content?: VideoWithIsAdult }
    const vod = json['content'] ?? null
    return vod
  }

  async getVideos(channelId: string) {
    const res = await fetch(`https://api.chzzk.naver.com/service/v1/channels/${channelId}/videos`, { headers: this.headers })
    const json = (await res.json()) as { content?: { data: VideoWithIsAdult[] } }
    const vod = json['content']?.data || null
    return vod
  }
  //#endregion

  //#region Authentication
  hasAuthAndSession() {
    const { auth, session } = this.model.authCookie
    if (!session) helper.msg('No session available to get status of user', 'warn')
    if (!auth) helper.msg('No authentication available to get status of user', 'warn')

    return !!auth && !!session
  }

  async refreshSession() {
    if (this.model.isDisableRefreshAuth) {
      helper.msg('Reach refresh auth cookie limit', 'warn')
      return null
    }

    if (!this.hasAuthAndSession()) return null

    const res = await fetch(`${this.gameBaseUrl}/v1/user/getUserStatus`, {
      headers: this.headerWithAuth,
    })

    const setCookie = res.headers.get('set-cookie')
    if (!setCookie) {
      this.model.refreshAuthFailCount++
      throw Error('no set-cookie header available in response of getUserStatus')
    }

    const { NID_SES } = cookie.parse(setCookie)
    if (!NID_SES) {
      this.model.refreshAuthFailCount++
      throw Error('no session in response of getUserStatus')
    }

    return NID_SES
  }

  async getFollowingLiveChannel() {
    if (!this.hasAuthAndSession()) throw new Error('no auth and session available')

    await fetch(`${this.apiBaseUrl}/service/v1/channels/followings/live`, {
      headers: this.headerWithAuth,
    })
  }

  async isAuthenticated() {
    try {
      await this.getFollowingLiveChannel()
      return true
    } catch (error) {
      return false
    }
  }

  async isAbleToRecordAdult() {
    if (!this.hasAuthAndSession()) return false

    if (await this.isAuthenticated()) return true

    const session = await this.refreshSession()
    if (!session) return false

    await this.model.setSession(session)
    return true
  }
  //#endregion
}
