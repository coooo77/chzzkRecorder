'use strict'

import fs from 'fs'
import path from 'path'
import chalk from 'chalk'
import fsPromises from 'fs/promises'

/** types */
import { LogMsgType } from '../interfaces/common.js'

export default {
  async saveErrorLog(error: unknown, extraInfo?: any) {
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? error.stack : null
    const time = new Date().toLocaleString()
    await fsPromises.writeFile(path.join(`./error-log-${Date.now()}.json`), JSON.stringify({ message, stack, extraInfo, time }, undefined, 2))
  },

  checkFileExists(filePath?: string): boolean {
    if (!filePath) return false
    try {
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath)
        return stats.size > 0
      }
    } catch (error) {
      // ignore
    }
    return false
  },

  msg(msg: string, msgType: LogMsgType = 'info') {
    const { log } = console

    const type = ` ${msgType.toUpperCase()} `

    switch (msgType) {
      case 'warn':
        log(chalk.bgYellow(type), chalk.yellow(msg))
        break
      case 'info':
        log(chalk.bgBlue(type), chalk.blue(msg))
        break
      case 'success':
        log(chalk.bgGreen(type), chalk.green(msg))
        break
      case 'fail':
        log(chalk.bgRed(type), chalk.red(msg))
        break
      case 'error':
        log(chalk.bgRed(type), chalk.bgRed.yellow(msg))
        break
      case 'title':
        log(chalk.bgMagenta(type), chalk.white(msg))
        break
      default:
        log(msg)
        break
    }
  },

  wait: (seconds: number) => new Promise((resolve) => setTimeout(resolve, seconds * 1000)),

  isProcessRunning(pid?: number) {
    if (typeof pid === 'undefined') return false

    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  },

  formatDate(templateString: string, targetTime = new Date()) {
    return templateString
      .replace('{year}', String(targetTime.getFullYear()).padStart(2, '0'))
      .replace('{month}', String(targetTime.getMonth() + 1).padStart(2, '0'))
      .replace('{day}', String(targetTime.getDate()).padStart(2, '0'))
      .replace('{hr}', String(targetTime.getHours()).padStart(2, '0'))
      .replace('{min}', String(targetTime.getMinutes()).padStart(2, '0'))
      .replace('{sec}', String(targetTime.getSeconds()).padStart(2, '0'))
  },

  formatDuration(seconds: number) {
    const hour = Math.floor(seconds / 3600)
    const minute = Math.floor((seconds % 3600) / 60)
    const second = seconds % 60

    const formattedHour = hour.toString().padStart(2, '0')
    const formattedMinute = minute.toString().padStart(2, '0')
    const formattedSecond = second.toString().padStart(2, '0')

    return `${formattedHour}h${formattedMinute}m${formattedSecond}s`
  },
}
