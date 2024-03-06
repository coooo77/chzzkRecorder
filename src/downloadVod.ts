'use strict'

import path from 'path'
import cp from 'child_process'
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

const getCmd = (item: VodDownloadItem) => `streamlink ${item.vodUrl} best -o ${getFilePath(item)}`

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
        vodDownloadList[item.vodNum].finish = true

        const fileDuration = await getMediaDuration(getFilePath(item), true)
        vodDownloadList[item.vodNum].isSuccess = item.duration - fileDuration <= 60 * 2
        fileSys.saveJSONFile(vodDownloadListPath, vodDownloadList)

        if (!vodDownloadList[item.vodNum].isSuccess) {
          helper.msg(`Failed to download vod ${item.vodNum}`)
        }

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

type GetMediaDuration4Result<T extends boolean> = T extends true ? number : string
const getMediaDuration = <T extends boolean = true>(videoPath: string, showInSeconds: T): GetMediaDuration4Result<T> => {
  let command = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1`
  if (!showInSeconds) {
    command += ` -sexagesimal`
  }
  command += ` ${videoPath}`

  const stdout = cp.execSync(command).toString()

  return showInSeconds ? (parseFloat(stdout) as GetMediaDuration4Result<T>) : (stdout as GetMediaDuration4Result<T>)
}

const reduceGetVodItems = (vodList: number[]) =>
  vodList.reduce((acc, vodId) => acc.then(() => getVodItem(vodId)), Promise.resolve() as Promise<unknown>) as Promise<(VodDownloadItem | null)[]>

const main = async () => {
  helper.msg('Start DownloadVod')

  vodDownloadList = fileSys.getJSONFile(vodDownloadListPath) || {}
  const items = Object.values(vodDownloadList)
  const vodItems = items.length !== 0 ? items : await reduceGetVodItems(vodList)
  const downloadItems = vodItems.filter((v): v is VodDownloadItem => Boolean(v))

  await downloadItems.reduce((acc, item) => acc.then(() => recordVod(item)), Promise.resolve())

  const failList = Object.values(vodDownloadList).filter((i) => !i.isSuccess)
  if (failList.length) {
    failList.forEach((i) => helper.msg(`Failed to download vod ${i.vodNum}`))
  } else {
    helper.msg('Download Vod Successfully', 'success')
  }
}

main()
