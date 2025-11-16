'use strict'

import fs from 'fs'
import path from 'path'
import fsPromise from 'fs/promises'

import helper from './common.js'

import type { AuthCookie } from '../interfaces/cookie.js'
import type { UsersList, AppSettings, RecordingList, VodCheckList, VodDownloadList, LastVodIdList } from '../interfaces/index.js'

const fileSysOri = {
  //#region 檔案路徑
  appConfigPath: path.join('./config.json'),

  cookiePath: path.join('./model/cookie.txt'),

  usersListPath: path.join('./model/users.json'),

  recordingListPath: path.join('./model/model.json'),

  vodCheckListPath: path.join('./model/vodCheckList.json'),

  lastVodIdListPath: path.join('./model/lastVodIdList.json'),

  vodDownloadListPath: path.join('./model/vodDownloadList.json'),
  //#endregion

  //#region 實況相關資料
  async getModel<T>(filePath: string, defaultValue: T, init?: boolean) {
    const model = await this.getOrDefaultValue<T>(filePath, defaultValue)
    if (init) await this.saveJSONFile(filePath, model)
    return model
  },

  async getRecordingList(options?: { init: boolean }) {
    return await this.getModel<RecordingList>(this.recordingListPath, {}, options?.init)
  },

  async getVodCheckList(options?: { init: boolean }) {
    return await this.getModel<VodCheckList>(this.vodCheckListPath, {}, options?.init)
  },

  async getVodDownloadList(options?: { init: boolean }) {
    return await this.getModel<VodDownloadList>(this.vodDownloadListPath, {}, options?.init)
  },

  async getLastVodIdList(options?: { init: boolean }) {
    return await this.getModel<LastVodIdList>(this.lastVodIdListPath, {}, options?.init)
  },
  //#endregion

  //#region 通用資料
  async getUsersList() {
    const model = await this.getOrDefaultValue<UsersList>(this.usersListPath, {})
    return model
  },

  async getCookie(options?: { init: boolean }) {
    const cookie: AuthCookie = { auth: '', session: '' }

    const cookieString = await this.getTxtFile(this.cookiePath)

    if (cookieString && cookieString.length) {
      const [auth, session] = cookieString.split('\r\n')
      if (auth && session) {
        cookie.auth = auth
        cookie.session = session
      }
    }

    if (options?.init) {
      const { auth, session } = cookie
      const saveCookieString = auth && session ? `${cookie.auth}\r\n${cookie.session}` : ''
      await this.saveTxtFile(this.cookiePath, saveCookieString)
    }

    return cookie
  },

  async getAppSetting() {
    const setting = await this.getJSONFile<AppSettings>(this.appConfigPath)
    if (!setting) throw Error('AppSetting file not found')

    return setting
  },

  getAppSettingSync() {
    if (!fs.existsSync(this.appConfigPath)) throw Error('AppSetting file not found')

    const result = fs.readFileSync(this.appConfigPath, 'utf8')
    return JSON.parse(result) as AppSettings
  },
  //#endregion

  //#region 通用
  async getTxtFile(filePath: string) {
    if (!filePath) throw Error(`fail to get file due to empty path`)
    if (!fs.existsSync(filePath)) return null

    try {
      const result = await fsPromise.readFile(filePath, 'utf8')
      return result
    } catch (error) {
      return null
    }
  },

  async saveTxtFile(filePath: string, data: string) {
    if (!filePath) throw Error(`fail to get file due to empty path`)

    try {
      const { dir } = path.parse(filePath)

      await this.makeDirIfNotExist(dir)

      await fsPromise.writeFile(filePath, data, 'utf8')
    } catch (error) {
      helper.msg(`fail to save txt file: ${filePath}`, 'error')
    }
  },

  async getOrDefaultValue<T>(filePath: string, defaultValue: T) {
    const model = await this.getJSONFile<T>(filePath)
    return model || defaultValue
  },

  async getJSONFile<T>(filePath: string): Promise<T | null> {
    if (!fs.existsSync(filePath)) return null

    try {
      const result = await fsPromise.readFile(filePath, 'utf8')

      return JSON.parse(result)
    } catch (error) {
      console.error(error)
      return null
    }
  },

  makeDirIfNotExist(fileLocation: string, options?: { sync?: boolean }) {
    if (fs.existsSync(fileLocation) || !fileLocation) return

    if (options?.sync) {
      fs.mkdirSync(fileLocation, { recursive: true })
    } else {
      return fsPromise.mkdir(fileLocation, { recursive: true })
    }
  },

  async saveJSONFile(filePath: string, data: any) {
    if (filePath.length === 0) throw new Error('no file path provided')

    const { dir } = path.parse(filePath)

    await this.makeDirIfNotExist(dir)

    await fsPromise.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8')
  },

  async errorHandler(error: any, triggerFnName: string = '', errorLogPath = path.join('error')) {
    await this.makeDirIfNotExist(errorLogPath)

    const log = JSON.parse(JSON.stringify(error || {}))

    log.date = new Date().toLocaleString()

    log.message = error?.message || 'no error message'

    log.triggerFnName = triggerFnName

    const errFilePath = path.join(errorLogPath, `${new Date().getTime()}.json`)

    await this.saveJSONFile(errFilePath, log)
  },
  //#endregion
}

type FileSysOri = typeof fileSysOri

interface FileSysOverload extends FileSysOri {
  makeDirIfNotExist(fileLocation: string): Promise<string | undefined>
  makeDirIfNotExist(fileLocation: string, options: { sync: true }): void
}

export default fileSysOri as FileSysOverload
