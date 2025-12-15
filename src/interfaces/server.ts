'use strict'

export interface ServerResponseParams<T> {
  data?: T | null
  result?: boolean
  message?: string | null
}

export class ServerResponse<T> {
  data
  result
  message

  constructor({ data = null, result = true, message = null }: ServerResponseParams<T> = {}) {
    this.data = data
    this.result = result
    this.message = message
  }
}
