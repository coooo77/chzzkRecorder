'use strict'

import path from 'path'
import cp from 'child_process'
import { ChzzkClient } from 'chzzk'
import { fileURLToPath } from 'node:url'

import helper from './utils/common.js'
import fileSys from './utils/fileSys.js'

import type { Video } from 'chzzk'
import type { VodDownloadItem } from './interfaces/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const vodListPath = path.resolve(__dirname, '..', 'vodList.json')
const vodList = fileSys.getJSONFile<number[]>(vodListPath)

if (!vodList) {
  helper.msg('No vod list found, process close')
  process.exit(0)
}

const userList = fileSys.getUsersList()
const appSetting = fileSys.getAppSetting()

const vodDownloadListPath = path.resolve(__dirname, '..', 'vodDownloadList.json')
const vodDownloadList: Record<number, VodDownloadItem> = {}

const getFilename = (item: VodDownloadItem, targetTime: Date) => {
  const { username, channelId, vodNum, duration } = item

  return helper
    .formatDate(appSetting.filenameVodTemplate, targetTime)
    .replace('{duration}', helper.formatDuration(duration))
    .replace('{vodNum}', `${vodNum}`)
    .replace('{username}', username)
    .replace('{id}', channelId)
}

const getCmd = (item: VodDownloadItem) => {
  const fileName = getFilename(item, new Date(item.publishDate))
  const filePath = path.join(appSetting.saveDirectory, `${fileName}.ts`)
  return `streamlink ${item.vodUrl} best -o ${filePath}`
}

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

      const closeFn = () => {
        helper.msg(`vod ${item.vodUrl} downloaded successfully`, 'success')

        vodDownloadList[item.vodNum].finish = true
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

const getVodItem = async (vodNum: number): Promise<VodDownloadItem | null> => {
  try {
    const res = await fetch(`https://api.chzzk.naver.com/service/v2/videos/${vodNum}`)
    const json = (await res.json()) as { content?: Video }
    const vod = json['content'] ?? null

    if (!vod) return null

    const userSetting = userList[vod.channel.channelId]
    if (!userSetting) throw Error(`Can not find user by vod id ${vodNum}`)

    return {
      vodNum,
      finish: false,
      duration: vod.duration,
      publishDate: vod.publishDate,
      username: userSetting.username,
      channelId: vod.channel.channelId,
      vodUrl: `https://chzzk.naver.com/video/${vodNum}`,
    }
  } catch (error) {
    helper.msg(`fetch failed, vodNum: ${vodNum}`, 'fail')
    return null
  }
}

const main = async () => {
  helper.msg('Start DownloadVod')

  for (const vodNum of vodList) {
    const item = await getVodItem(vodNum)

    if (!item) {
      helper.msg(`Can not find vod by vod id ${vodNum}`, 'warn')
      continue
    }

    await recordVod(item)
  }

  helper.msg('Download Vod Successfully', 'success')
}

main()
