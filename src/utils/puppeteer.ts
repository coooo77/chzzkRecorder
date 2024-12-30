'use strict'
import puppeteer from 'puppeteer-extra'

import Model from './model.js'

import type { Channel } from 'chzzk'
import type { Browser, Page } from 'puppeteer'
import type { PuppeteerSetting, VideoWithIsAdult } from '../interfaces/index.js'

interface PuppeteerParam {
  model: Model
}

export default class Puppeteer {
  isInit = false

  model: Model

  page?: Page

  browser?: Browser

  constructor({ model }: PuppeteerParam) {
    this.model = model
  }

  async init(settings: PuppeteerSetting) {
    this.browser = await puppeteer.default.launch(settings)

    this.page = await this.browser.newPage()

    await this.page.goto('https://chzzk.naver.com/')

    this.isInit = true
  }

  async close() {
    this.browser?.close()
  }

  private getReqChannelUrl(channelId: string) {
    return `https://api.chzzk.naver.com/service/v1/channels/${channelId}`
  }

  private getReqVodUrl(vodNum: number) {
    return `https://api.chzzk.naver.com/service/v2/videos/${vodNum}`
  }

  private async checkInit() {
    if (this.isInit) return

    if (!this.model.appSetting.puppeteerSettings) throw Error('puppeteer settings required')

    await this.init(this.model.appSetting.puppeteerSettings)
  }

  private checkPageInst(): asserts this is this & { page: Page } {
    if (!this.page) throw Error('no page instance found.')
  }

  private async puppeteerFetch<T>(reqUrl: string): Promise<T> {
    await this.checkInit()

    this.checkPageInst()

    const res = await this.page.evaluate(async (url: string) => {
      const res = await fetch(url)
      const { content } = (await res.json()) as { content: T }
      return content
    }, reqUrl)

    return res
  }

  async getChannel(channelId: string): Promise<Channel> {
    const url = this.getReqChannelUrl(channelId)
    const res = await this.puppeteerFetch<Channel>(url)
    return res
  }

  async getVodData(vodNum: number) {
    const url = this.getReqVodUrl(vodNum)
    const res = await this.puppeteerFetch<VideoWithIsAdult>(url)
    return res
  }
}
