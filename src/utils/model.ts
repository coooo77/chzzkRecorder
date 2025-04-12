'use strict'
import path from 'path'
import chokidar from 'chokidar'
import EventEmitter from 'events'
import { keyBy, pickBy } from 'lodash-es'

import { RecordEvent } from './recorder.js'

import helper from './common.js'
import fileSys from './fileSys.js'

import type { Live } from 'chzzk'
import type {
  UsersList,
  AuthCookie,
  AppSettings,
  UserSetting,
  RecordingList,
  VodCheckList,
  VodCheckInfo,
  VodDownloadList,
  VodDownloadItem,
} from '../interfaces/index.js'

export enum ModelEvent {
  ADD_RECORD_LIST = 'model-add-record-list',
  REMOVE_RECORD_LIST = 'model-delete-record-list',
}

type Pid = number | undefined

/**
 * @see https://www.youtube.com/watch?v=Pl7pDjWd830
 * @see https://blog.makerx.com.au/a-type-safe-event-emitter-in-node-js/
 * @see https://stackoverflow.com/questions/67243592/typescript-adding-types-to-eventemitter
 */
export interface ModelEventMap {
  [RecordEvent.RECORD_LIVE_START]: [Live]
  [ModelEvent.ADD_RECORD_LIST]: [UserSetting, Pid]
  [ModelEvent.REMOVE_RECORD_LIST]: [UserSetting['channelId']]
}

export default class Model extends EventEmitter<ModelEventMap> {
  isWatchOn = false

  mutex = Promise.resolve()

  appSetting: AppSettings

  userList: UsersList = {}

  vodCheckList: VodCheckList = {}

  recordingList: RecordingList = {}

  vodDownloadList: VodDownloadList = {}

  MAX_REFRESH_COUNT = 2

  refreshAuthFailCount = 0

  authCookie: AuthCookie = { auth: '', session: '' }

  constructor(...args: ConstructorParameters<typeof EventEmitter>) {
    super(...args)

    this.appSetting = fileSys.getAppSettingSync()

    this.on(ModelEvent.ADD_RECORD_LIST, this.addRecordList)
    this.on(ModelEvent.REMOVE_RECORD_LIST, this.removeRecordList)
  }

  get isDisableRefreshAuth() {
    return this.refreshAuthFailCount > this.MAX_REFRESH_COUNT
  }

  // #region User Vod

  setVodCheckList(items: VodCheckInfo[]) {
    return this.addPromiseQueue(async () => {
      const newList = keyBy(items, 'checkTime')
      this.vodCheckList = Object.assign(this.vodCheckList, newList)
      await fileSys.saveJSONFile(fileSys.vodCheckListPath, this.vodCheckList)
    })
  }

  removeVodCheckList(checkTimes: number[]) {
    return this.addPromiseQueue(async () => {
      this.vodCheckList = pickBy(this.vodCheckList, (i) => !checkTimes.includes(i.checkTime))
      await fileSys.saveJSONFile(fileSys.vodCheckListPath, this.vodCheckList)
    })
  }

  setVodDownloadList(items: VodDownloadItem[]) {
    return this.addPromiseQueue(async () => {
      const newList = keyBy(items, 'vodNum')
      this.vodDownloadList = Object.assign(this.vodDownloadList, newList)
      await fileSys.saveJSONFile(fileSys.vodDownloadListPath, this.vodDownloadList)
    })
  }

  removeVodDownloadList(vodNum: number) {
    return this.addPromiseQueue(async () => {
      this.vodDownloadList = pickBy(this.vodDownloadList, (i) => i.vodNum !== vodNum)
      await fileSys.saveJSONFile(fileSys.vodDownloadListPath, this.vodDownloadList)
    })
  }
  // #endregion

  //#region Record List
  async getRecordingList() {
    this.recordingList = await fileSys.getRecordingList()
  }

  setRecordList(list: RecordingList) {
    return this.addPromiseQueue(async () => {
      this.recordingList = list
      await fileSys.saveJSONFile(fileSys.recordingListPath, this.recordingList)
    })
  }

  removeRecordList(channelId: string) {
    return this.addPromiseQueue(async () => {
      delete this.recordingList[channelId]
      await this.setRecordList(this.recordingList)
    })
  }

  async addRecordList(setting: UserSetting, pid?: number) {
    return this.addPromiseQueue(async () => {
      this.recordingList[setting.channelId] = {
        pid,
        controllable: true,
        username: setting.username,
        startAt: new Date().toJSON(),
        channelName: setting.channelName,
      }

      await this.setRecordList(this.recordingList)
    })
  }
  //#endregion

  // #region 資料同步
  async init() {
    await Promise.all([this.updateCookie(), this.updateUserList(), this.getRecordingList(), fileSys.makeDirIfNotExist(this.appSetting.saveDirectory)])
  }

  async syncModel() {
    const [userList, appSetting, authCookie] = await Promise.all([fileSys.getUsersList(), fileSys.getAppSetting(), fileSys.getCookie()])

    this.userList = userList
    this.authCookie = authCookie
    this.appSetting = appSetting
  }

  /** 精读《如何利用 Nodejs 监听文件夹》 @see https://tinyurl.com/n9r7p3mk */
  watchModel() {
    const { cookiePath, appConfigPath, usersListPath, vodCheckListPath, vodDownloadListPath } = fileSys
    const watchList = [cookiePath, appConfigPath, usersListPath, vodCheckListPath, vodDownloadListPath]
    const nameMap = Object.fromEntries(watchList.map((p) => [p, path.basename(p)]))

    const method = {
      [nameMap[cookiePath]]: () => {
        helper.msg('Cookie updated')
        this.updateCookie()
      },
      [nameMap[usersListPath]]: () => {
        helper.msg('User List updated')
        this.updateUserList()
      },
      [nameMap[appConfigPath]]: () => {
        helper.msg('App Setting updated')
        this.updateAppSetting()
      },
      [nameMap[vodCheckListPath]]: () => {
        helper.msg('Vod Check List updated')
        this.updateVodCheckList()
      },
      [nameMap[vodDownloadListPath]]: () => {
        helper.msg('Vod Download List updated')
        this.updateVodDownloadList()
      },
    }

    chokidar.watch(watchList).on('change', (p) => {
      const name = nameMap[p]
      if (name in method) method[name as keyof typeof method]()
    })
  }

  async updateAppSetting() {
    this.appSetting = await fileSys.getAppSetting()
  }

  async updateUserList() {
    this.userList = await fileSys.getUsersList()
  }

  async updateVodCheckList() {
    this.vodCheckList = await fileSys.getVodCheckList()
  }

  async updateVodDownloadList() {
    this.vodDownloadList = await fileSys.getVodDownloadList()
  }
  // #endregion

  //#region Cookie
  get cookieIsAvailable() {
    const { auth, session } = this.authCookie
    return !!auth && !!session
  }

  async updateCookie() {
    const cookie = await fileSys.getCookie()
    if (cookie.auth && cookie.session) {
      this.authCookie = cookie
    } else {
      helper.msg('no cookie available', 'warn')
    }
  }

  async setSession(session: string) {
    this.authCookie.session = session
    const { auth } = this.authCookie
    const cookieString = `${auth}\r\n${session}`
    await fileSys.saveTxtFile(fileSys.cookiePath, cookieString)
  }
  //#endregion

  //#region 其他
  async addPromiseQueue<F extends (...arg: any[]) => any>(cb: F) {
    this.mutex
      .then(async () => {
        const res = await cb()
        return res
      })
      .catch(console.error)

    return this.mutex as Promise<ReturnType<F>>
  }

  async getAppSetting() {
    if (this.appSetting) return this.appSetting

    this.appSetting = await fileSys.getAppSetting()

    return this.appSetting
  }

  //#endregion
}
