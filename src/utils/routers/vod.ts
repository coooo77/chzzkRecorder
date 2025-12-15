'use strict'
import { Router } from 'express'
import VodController from '../controllers/vod.js'

export const vodRouter = (controller: VodController) => {
  const router = Router()

  router.post('/addList', controller.addList)

  return router
}
