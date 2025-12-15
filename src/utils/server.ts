'use strict'
import express from 'express'

import helper from './common.js'

import VodController from './controllers/vod.js'
import RecordController from './controllers/record.js'
import { recordRouter, vodRouter } from './routers/index.js'

import { ServerResponse } from '../interfaces/index.js'
import type { Server } from 'http'
import type { Request, Response, NextFunction } from 'express'

export default class CrawlerServer {
  app

  port = 3000

  server?: Server

  // #region 初始化
  constructor(private recordController: RecordController, private vodController: VodController) {
    this.app = express()
    this.app.use(express.json())
    this.app.use(this.errorHandler)
  }

  init() {
    this.app.use('/vod', vodRouter(this.vodController))
    this.app.use('/record', recordRouter(this.recordController))

    this.server = this.app.listen(this.port, () => {
      helper.msg(`Express is running on http://localhost:${this.port}`)
    })
  }
  // #endregion

  // #region 方法
  errorHandler(error: Error, req: Request, res: Response, next: NextFunction) {
    if (error instanceof SyntaxError && 'body' in error) {
      const message = `fail parsing JSON, message: ${error.message}`
      helper.msg(message, 'error')

      return res.status(400).json(
        new ServerResponse({
          message,
          result: false,
        })
      )
    }

    if (res.headersSent) {
      return next(error)
    }

    return res.status(500).json(
      new ServerResponse({
        result: false,
        message: 'Uncaught Internal Server Error',
      })
    )
  }

  checkVod() {}

  recordLiveStream(req: Request, res: Response) {
    try {
      const { channelIds } = req.body

      if (!channelIds || !Array.isArray(channelIds) || channelIds.length === 0) {
        const message = 'fail recording live stream due to channel id list is required'
        helper.msg(message, 'warn')

        return res.status(400).json(
          new ServerResponse({
            message,
            result: false,
          })
        )
      }

      return res.status(200).json(
        new ServerResponse({
          message: 'success',
          result: true,
        })
      )
    } catch (error) {
      // **捕獲 recordLiveStream 內部的所有非同步錯誤**
      const errorMessage = error instanceof Error ? error.message : String(error)

      const message = `an error occurred during record live stream: ${errorMessage}`
      helper.msg(message, 'error')

      // 向客戶端回傳 500 內部伺服器錯誤
      return res.status(500).json({
        message,
        success: false,
      })
    }
  }
  // #endregion
}
