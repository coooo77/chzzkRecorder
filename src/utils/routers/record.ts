'use strict'
import { Router } from 'express'
import RecordController from '../controllers/record.js'

export const recordRouter = (controller: RecordController) => {
  const router = Router()

  router.post('/recordLives', controller.recordLives)

  return router
}
