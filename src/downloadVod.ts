'use strict'

import fs from 'fs'
import path from 'path'
import cp from 'child_process'
import { fileURLToPath } from 'node:url'

import helper from './utils/common.js'
import fileSys from './utils/fileSys.js'
import Puppeteer from './utils/puppeteer.js'

import type { Video } from 'chzzk'
import type { VodDownloadItem } from './interfaces/index.js'

const MAX_RETRY_COUNT = 3
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const vodListPath = path.resolve(__dirname, '..', 'vodList.json')
const vodList = fileSys.getJSONFile<number[]>(vodListPath)

if (!vodList) {
  helper.msg('No vod list found, process close')
  process.exit(0)
}

const puppeteer = new Puppeteer()

const userList = fileSys.getUsersList()
const appSetting = fileSys.getAppSetting()

const vodDownloadListPath = path.resolve(__dirname, '..', 'vodDownloadList.json')
let vodDownloadList: Record<number, VodDownloadItem> = {}

const getFilename = (item: VodDownloadItem, targetTime: Date) => {
  const { username, channelId, vodNum, duration } = item

  return helper
    .formatDate(appSetting.filenameVodTemplate, targetTime)
    .replace('{duration}', helper.formatDuration(duration))
    .replace('{vodNum}', `${vodNum}`)
    .replace('{username}', username)
    .replace('{id}', channelId)
}

const getFilePath = (item: VodDownloadItem) => {
  const fileName = getFilename(item, new Date(item.publishDate))
  const filePath = path.join(appSetting.saveDirectory, `${fileName}.ts`)
  return filePath
}

const getCmd = (item: VodDownloadItem) => `streamlink ${item.vodUrl} best -f -o ${getFilePath(item)}`

const recordVod = (item: VodDownloadItem) =>
  new Promise<void>((res, rej) => {
    try {
      const cmd = getCmd(item)

      let task: null | cp.ChildProcess = cp.spawn(cmd, [], {
        detached: true,
        shell: true,
      })

      const spawnFn = () => {
        helper.msg(`start to download vod ${item.vodUrl}`)

        item.pid = task?.pid
        vodDownloadList[item.vodNum] = item
        fileSys.saveJSONFile(vodDownloadListPath, vodDownloadList)
      }

      const closeFn = async () => {
        helper.msg(`vod ${item.vodUrl} downloaded`)

        const vod = vodDownloadList[item.vodNum]
        vod.tryCount++
        vod.finish = vod.tryCount >= MAX_RETRY_COUNT

        const filePath = getFilePath(item)
        if (!fs.existsSync(filePath)) {
          helper.msg(`can not find vod ${item.vodUrl} to check duration!`, 'error')
          vod.finish = true
        } else {
          const fileDuration = await getMediaDuration(filePath, true)
          const isSuccess = item.duration - fileDuration <= 60 * 2
          vod.finish = isSuccess
          vod.isSuccess = isSuccess
        }

        if (!vod.isSuccess) {
          helper.msg(`Failed to download vod ${item.vodNum}`)
        }

        fileSys.saveJSONFile(vodDownloadListPath, vodDownloadList)

        task?.off('spawn', spawnFn)
        task?.off('close', closeFn)
        task = null

        res()
      }

      task.on('spawn', spawnFn)
      task.on('close', closeFn)
    } catch (error) {
      console.error(error)
      rej()
    }
  })

const getVod = async (vodNum: number) => {
  const res = await fetch(`https://api.chzzk.naver.com/service/v2/videos/${vodNum}`)
  const json = (await res.json()) as { content?: Video }
  const vod = json['content'] ?? null
  return vod
}

const fetchFn = appSetting.usePuppeteer ? puppeteer.getVodData.bind(puppeteer) : getVod

const getVodItem = async (vodNum: number): Promise<VodDownloadItem | null> => {
  try {
    const vod = await fetchFn(vodNum)
    if (!vod) return null

    const userSetting = userList[vod.channel.channelId]
    if (!userSetting) throw Error(`Can not find user by vod id ${vodNum}`)

    return {
      vodNum,
      tryCount: 0,
      finish: false,
      isSuccess: false,
      duration: vod.duration,
      publishDate: vod.publishDate,
      username: userSetting.username,
      channelId: vod.channel.channelId,
      vodUrl: `https://chzzk.naver.com/video/${vodNum}`,
    }
  } catch (error) {
    helper.msg(`fetch failed, vodNum: ${vodNum}`, 'fail')
    console.error(error)
    return null
  }
}

function getMediaDuration(videoPath: string, showInSeconds: true): number
function getMediaDuration(videoPath: string, showInSeconds: false): string
function getMediaDuration(videoPath: string, showInSeconds: boolean) {
  let command = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1`
  if (!showInSeconds) {
    command += ` -sexagesimal`
  }
  command += ` ${videoPath}`

  const stdout = cp.execSync(command).toString()

  return showInSeconds ? parseFloat(stdout) : stdout
}

const reduceGetVodItems = async (vodList: number[]) => {
  const result = []

  for (const vodId of vodList) {
    const res = await getVodItem(vodId)
    if (res) result.push(res)
  }

  return result
}

const main = async () => {
  helper.msg('Start DownloadVod')

  const vodItems = await reduceGetVodItems(vodList)

  if (puppeteer.isInit) puppeteer.close()

  for (const item of vodItems) {
    let isProcessing = true

    do {
      await recordVod(item)
      isProcessing = !vodDownloadList[item.vodNum].finish
    } while (isProcessing)
  }

  const failList = Object.values(vodDownloadList).filter((i) => !i.isSuccess)
  if (failList.length) {
    failList.forEach((i) => helper.msg(`Failed to download vod ${i.vodNum}`))
  } else {
    helper.msg('Download Vod Successfully', 'success')
  }
}

main()
